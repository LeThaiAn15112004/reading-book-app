import { randomUUID } from 'node:crypto'
import {
  formatTranscriptText,
  isAudioFormat,
  isSupportedTranscriptionLanguage,
  isTranscriptionErrorCode,
  normalisePassageText,
  planWindows,
  resolveDefaultTranscriptionLanguage,
  subtractRanges,
  totalRangeMs,
  trackKey,
  type TimeRange,
  type TranscriptPassage,
  type TranscriptionErrorCode,
} from '@reading-book/book-reader-sdk'
import type {
  OkResult,
  TranscriptPassageDto,
  TranscriptSummaryDto,
  TranscriptionDecoderStatusDto,
  TranscriptionDownloadModelResult,
  TranscriptionFailureDto,
  TranscriptionInfoDto,
  TranscriptionJobDto,
  TranscriptionModelProgressDto,
  TranscriptionPassagesAddedDto,
  TranscriptionPassagesRequestDto,
  TranscriptionScopeDto,
  TranscriptionSearchHitDto,
  TranscriptionStartRequestDto,
  TranscriptionStartResult,
} from '../ipc/api-types'
import type { SqliteTranscriptStore, TranscriptRecord } from '../persistence/sqlite-transcript-store'
import { DECODE_SAMPLE_RATE, type AudioDecoder, type DecoderAvailability } from './audio-decoder'
import type { ModelManager } from './model-manager'
import type { SpeechProcessHost } from './speech-process-host'

/**
 * The transcription service (spec 004, tasks T015 / T016): ONE global queue, one active job, scope resolution, resume
 * (covered intervals are skipped), the decode → speech → commit loop with one transaction per window, throttled progress,
 * cancellation within seconds, and the terminal states. Electron-free: every collaborator is injected, so the Main spike
 * drives it with fakes and a real SQLite database.
 *
 * Failure policy: whatever is committed stays. A job that ends for any reason clears `job_state` (via `endJob`) and records
 * the outcome; it never leaves a transcript `complete` unless its requested scope is covered.
 */

export type TranscriptionStore = Pick<
  SqliteTranscriptStore,
  'get' | 'ensure' | 'commitWindow' | 'getPassages' | 'search' | 'setJobState' | 'setScope' | 'endJob' | 'replace' | 'deleteForBook'
>
export type TranscriptionSpeech = Pick<SpeechProcessHost, 'transcribe' | 'stop' | 'dispose'>
export type TranscriptionModels = Pick<ModelManager, 'list' | 'isInstalled' | 'download' | 'remove' | 'catalog'>
export type TranscriptionDecoder = Pick<AudioDecoder, 'availability' | 'decodeWindow'>

export interface TranscriptionTrackInfo {
  id: string
  title: string
  durationMs: number | null
}

/** What the service needs to know about the library; Main wires the real stores, the spike a fake. */
export interface TranscriptionSource {
  findBook(bookId: string): Promise<{ id: string; format: string } | undefined>
  /** Tracks in playback order of a multi-track audiobook; `[]` for a single-file one. */
  listTracks(bookId: string): TranscriptionTrackInfo[]
  /** A validated absolute path (never from the renderer). */
  resolveFile(bookId: string, trackId?: string): Promise<{ ok: true; path: string } | { ok: false }>
  /** Duration of an audio file in ms, or null when it cannot be read. */
  probeDurationMs(filePath: string): Promise<number | null>
  /** The audiobook's own language tag (a Whisper code or any tag `whisperLanguageForTag` maps), when it can be read; may take a moment. */
  languageTag?(bookId: string): Promise<string | null | undefined> | string | null | undefined
}

export interface TranscriptionEvents {
  progress(job: TranscriptionJobDto): void
  passagesAdded(added: TranscriptionPassagesAddedDto): void
  modelProgress(progress: TranscriptionModelProgressDto): void
}

export interface TranscriptionServiceOptions {
  store: TranscriptionStore
  speech: TranscriptionSpeech
  decoder: TranscriptionDecoder
  models: TranscriptionModels
  source: TranscriptionSource
  events: TranscriptionEvents
  /** At most one progress snapshot per this many ms (contract: ≤ 4/s). Default 250. */
  progressIntervalMs?: number
  now?: () => number
  /**
   * The feature gate: `start` and `downloadModel` answer `FEATURE_DISABLED` while it returns false, before anything is validated,
   * downloaded or queued. Main wires `() => features.audiobookTranscriptionEnabled`; the default (always on) is for the spikes.
   */
  isEnabled?: () => boolean
}

type JobState = TranscriptionJobDto['state']

interface Job {
  id: string
  bookId: string
  scope: TranscriptionScopeDto
  language: string
  modelId: string
  replace: boolean
  /** The transcript row did not exist before this job accepted it. */
  createdTranscript: boolean
  abort: AbortController
  state: JobState
  doneMs: number
  totalMs: number
  trackId?: string
  trackDoneMs?: number
  trackTotalMs?: number
  error?: TranscriptionErrorCode
  passagesAdded: number
  lastEmit: number
  settled: Promise<void>
  markSettled: () => void
}

interface Unit {
  trackId?: string
  key: string
  filePath: string
  requestedMs: number
  todo: TimeRange[]
  coveredMs: number
}

class StartError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StartError'
  }
}

const FEATURE_DISABLED_MESSAGE = 'Audiobook transcription is not available in this version of the app yet.'

function decoderUnavailableMessage(availability: Extract<DecoderAvailability, { available: false }>): string {
  return `The audio decoder is not available on this system (${availability.reason}${availability.detail ? `: ${availability.detail}` : ''})`
}

/** A search box is not a document: longer queries are cut. */
const MAX_SEARCH_QUERY_LENGTH = 200
/** Passages read per page while building an export (the ordinary read cap). */
const EXPORT_PAGE = 2000

/** What `removeModel` returns (the same shape as removing a translation model). */
export type RemoveModelResult = { ok: true } | { ok: false; errorCode: 'busy' | 'not_found' | 'failed'; errorMessage: string }

/** What `buildExport` returns: the whole transcript as text, or why there is nothing to export. */
export type TranscriptExportBuild = { ok: true; text: string; passageCount: number } | TranscriptionFailureDto

const failure = (code: TranscriptionErrorCode, message: string): TranscriptionFailureDto => ({ ok: false, errorCode: code, errorMessage: message })

/** The contract error code of anything thrown by the decoder, the speech host or the model manager. */
function codeOf(error: unknown): TranscriptionErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  return isTranscriptionErrorCode(code) ? code : 'DECODE_FAILED'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createTranscriptionService(options: TranscriptionServiceOptions) {
  const { store, speech, decoder, models, source, events } = options
  const progressIntervalMs = options.progressIntervalMs ?? 250
  /** The release gate (`features.audiobookTranscriptionEnabled`), read at every call so it can change while the app runs. */
  const isEnabled = options.isEnabled ?? ((): boolean => true)

  /** Whether the audio decoder can run here, for the dialog (so it does not offer a model download that could not be used). */
  async function decoderStatus(): Promise<TranscriptionDecoderStatusDto> {
    try {
      const availability = await decoder.availability()
      return availability.available ? { available: true } : { available: false, reason: availability.reason }
    } catch {
      return { available: false, reason: 'UNKNOWN' }
    }
  }
  const now = options.now ?? Date.now

  const queue: Job[] = []
  let active: Job | null = null
  let shuttingDown = false
  const durationCache = new Map<string, number>()

  function toJobDto(job: Job): TranscriptionJobDto {
    const dto: TranscriptionJobDto = { jobId: job.id, bookId: job.bookId, state: job.state, doneMs: Math.round(job.doneMs), totalMs: Math.round(job.totalMs) }
    if (job.trackId !== undefined) {
      dto.trackId = job.trackId
      if (job.trackDoneMs !== undefined) dto.trackDoneMs = Math.round(job.trackDoneMs)
      if (job.trackTotalMs !== undefined) dto.trackTotalMs = Math.round(job.trackTotalMs)
    }
    if (job.error) dto.error = job.error
    return dto
  }

  /** Snapshot to the renderer. `force` for state changes; plain progress is throttled. */
  function emit(job: Job, force: boolean): void {
    const t = now()
    if (!force && t - job.lastEmit < progressIntervalMs) return
    job.lastEmit = t
    try {
      events.progress(toJobDto(job))
    } catch {
      /* a closed window must not stop a job */
    }
  }

  const jobOfBook = (bookId: string): Job | undefined => (active?.bookId === bookId ? active : queue.find((job) => job.bookId === bookId))

  // ------------------------------------------------------------------------------------------------ validation (T016)

  function parseScope(raw: unknown): TranscriptionScopeDto {
    if (!raw || typeof raw !== 'object') throw new StartError('INVALID_ARGUMENT', 'Missing scope')
    const scope = raw as Record<string, unknown>
    if (scope.kind === 'whole') return { kind: 'whole' }
    if (scope.kind === 'track') {
      if (typeof scope.trackId !== 'string' || !scope.trackId) throw new StartError('INVALID_ARGUMENT', 'A track scope needs a trackId')
      return { kind: 'track', trackId: scope.trackId }
    }
    if (scope.kind === 'range') {
      const { startMs, endMs, trackId } = scope
      if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new StartError('INVALID_ARGUMENT', 'A range needs numeric startMs and endMs')
      }
      if (startMs < 0 || startMs >= endMs) throw new StartError('INVALID_ARGUMENT', 'A range needs 0 <= startMs < endMs')
      if (trackId !== undefined && (typeof trackId !== 'string' || !trackId)) throw new StartError('INVALID_ARGUMENT', 'Bad trackId')
      return trackId === undefined ? { kind: 'range', startMs, endMs } : { kind: 'range', trackId: trackId as string, startMs, endMs }
    }
    throw new StartError('INVALID_ARGUMENT', 'Unknown scope kind')
  }

  async function validateStart(raw: unknown): Promise<{ request: TranscriptionStartRequestDto; scope: TranscriptionScopeDto }> {
    if (!raw || typeof raw !== 'object') throw new StartError('INVALID_ARGUMENT', 'Missing request')
    const input = raw as Record<string, unknown>
    if (typeof input.bookId !== 'string' || !input.bookId.trim()) throw new StartError('INVALID_ARGUMENT', 'Missing bookId')
    if (typeof input.modelId !== 'string' || !input.modelId.trim()) throw new StartError('INVALID_ARGUMENT', 'Missing modelId')
    if (typeof input.language !== 'string') throw new StartError('INVALID_ARGUMENT', 'Missing language')
    if (input.replace !== undefined && typeof input.replace !== 'boolean') throw new StartError('INVALID_ARGUMENT', 'Bad replace flag')
    const scope = parseScope(input.scope)
    const bookId = input.bookId.trim()
    const modelId = input.modelId.trim()

    if (!isSupportedTranscriptionLanguage(input.language)) throw new StartError('UNSUPPORTED_LANGUAGE', `Language "${input.language}" is not supported`)

    const book = await source.findBook(bookId)
    if (!book) throw new StartError('INVALID_ARGUMENT', 'Unknown book')
    if (!isAudioFormat(book.format)) throw new StartError('INVALID_ARGUMENT', 'Only audiobooks can be transcribed')

    const tracks = source.listTracks(bookId)
    const multiTrack = tracks.length > 0
    if (scope.kind === 'track') {
      if (!multiTrack) throw new StartError('INVALID_ARGUMENT', 'A trackId was given for a single-file audiobook')
      if (!tracks.some((track) => track.id === scope.trackId)) throw new StartError('INVALID_ARGUMENT', 'The track does not belong to this audiobook')
    }
    if (scope.kind === 'range') {
      if (multiTrack) {
        if (scope.trackId === undefined) throw new StartError('INVALID_ARGUMENT', 'A range of a multi-track audiobook needs a trackId')
        if (!tracks.some((track) => track.id === scope.trackId)) throw new StartError('INVALID_ARGUMENT', 'The track does not belong to this audiobook')
      } else if (scope.trackId !== undefined) {
        throw new StartError('INVALID_ARGUMENT', 'A trackId was given for a single-file audiobook')
      }
    }

    if (jobOfBook(bookId)) throw new StartError('INVALID_ARGUMENT', 'This audiobook already has a transcription queued or running')

    if (!models.catalog.some((model) => model.id === modelId)) throw new StartError('INVALID_ARGUMENT', `Unknown speech model "${modelId}"`)
    // The decoder comes BEFORE the "model not downloaded" answer: nobody is sent off to download a large model when the audio
    // could not be decoded anyway.
    const availability = await decoder.availability()
    if (!availability.available) throw new StartError('DECODE_FAILED', decoderUnavailableMessage(availability))
    if (!(await models.isInstalled(modelId))) throw new StartError('MODEL_MISSING', 'The speech model is not downloaded yet')
    return { request: { bookId, scope, language: input.language, modelId, replace: input.replace === true }, scope }
  }

  // ------------------------------------------------------------------------------------------------ start / cancel

  async function start(raw: unknown): Promise<TranscriptionStartResult> {
    // The feature gate comes first: nothing is validated, persisted, downloaded or queued while transcription is switched off.
    if (!isEnabled()) return failure('FEATURE_DISABLED', FEATURE_DISABLED_MESSAGE)
    if (shuttingDown) return failure('ABORTED', 'The app is closing')
    let validated: Awaited<ReturnType<typeof validateStart>>
    try {
      validated = await validateStart(raw)
    } catch (error) {
      if (error instanceof StartError) return failure(error.code, error.message)
      return failure('INVALID_ARGUMENT', messageOf(error))
    }
    const { request, scope } = validated
    // Another start may have been accepted while we awaited the checks above.
    if (jobOfBook(request.bookId)) return failure('INVALID_ARGUMENT', 'This audiobook already has a transcription queued or running')

    const existed = store.get(request.bookId) !== null
    if (!store.ensure(request.bookId, { language: request.language, modelId: request.modelId })) return failure('INVALID_ARGUMENT', 'Unknown book')
    // The marker that lets startup recovery find a job that died with the process, and the scope Resume will start again.
    store.setJobState(request.bookId, 'queued', null)
    store.setScope(request.bookId, scope)

    let markSettled: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve
    })
    const job: Job = {
      id: randomUUID(),
      bookId: request.bookId,
      scope,
      language: request.language,
      modelId: request.modelId,
      replace: request.replace === true,
      createdTranscript: !existed,
      abort: new AbortController(),
      state: 'queued',
      doneMs: 0,
      totalMs: 0,
      passagesAdded: 0,
      lastEmit: 0,
      settled,
      markSettled,
    }
    queue.push(job)
    emit(job, true)
    void pump()
    return { ok: true, jobId: job.id }
  }

  function cancel(jobId: unknown): OkResult {
    if (typeof jobId !== 'string') return { ok: false }
    const queuedIndex = queue.findIndex((job) => job.id === jobId)
    if (queuedIndex >= 0) {
      const [job] = queue.splice(queuedIndex, 1) as [Job]
      finishQueuedCancel(job)
      return { ok: true }
    }
    if (active?.id === jobId) {
      active.abort.abort()
      return { ok: true }
    }
    return { ok: false }
  }

  /** A job that never started: leave the transcript as it was (or remove the row this job created). */
  function finishQueuedCancel(job: Job): void {
    job.state = 'cancelled'
    try {
      if (job.createdTranscript) store.deleteForBook(job.bookId)
      else store.setJobState(job.bookId, null)
    } catch {
      /* the next start / recovery repairs the marker */
    }
    emit(job, true)
    job.markSettled()
  }

  async function pump(): Promise<void> {
    if (active || shuttingDown) return
    const next = queue.shift()
    if (!next) return
    active = next
    try {
      await run(next)
    } finally {
      active = null
      next.markSettled()
      void pump()
    }
  }

  // ------------------------------------------------------------------------------------------------ the job

  async function durationOf(trackDurationMs: number | null, filePath: string): Promise<number> {
    if (trackDurationMs !== null && trackDurationMs > 0) return Math.round(trackDurationMs)
    const probed = await source.probeDurationMs(filePath)
    if (probed === null || !Number.isFinite(probed) || probed <= 0) throw new StartError('DECODE_FAILED', 'The length of the audio file could not be read')
    return Math.round(probed)
  }

  async function buildPlan(job: Job): Promise<Unit[]> {
    const tracks = source.listTracks(job.bookId)
    const record = store.get(job.bookId)
    const { scope } = job
    const targets: Array<{ trackId?: string; info?: TranscriptionTrackInfo }> =
      scope.kind === 'whole'
        ? tracks.length > 0
          ? tracks.map((info) => ({ trackId: info.id, info }))
          : [{}]
        : [{ trackId: scope.trackId, info: tracks.find((t) => t.id === scope.trackId) }]

    const units: Unit[] = []
    for (const target of targets) {
      const file = await source.resolveFile(job.bookId, target.trackId)
      if (!file.ok) throw new StartError('FILE_MISSING', 'The audio file is missing or cannot be read')
      const duration = await durationOf(target.info?.durationMs ?? null, file.path)
      const requested: TimeRange =
        job.scope.kind === 'range' ? [job.scope.startMs, Math.min(job.scope.endMs, duration)] : [0, duration]
      if (requested[0] >= requested[1]) continue
      const key = trackKey(target.trackId)
      const covered = record?.covered[key] ?? []
      const todo = subtractRanges([requested], covered)
      const requestedMs = requested[1] - requested[0]
      units.push({ trackId: target.trackId, key, filePath: file.path, requestedMs, todo, coveredMs: requestedMs - totalRangeMs(todo) })
    }
    return units
  }

  async function run(job: Job): Promise<void> {
    const { signal } = job.abort
    try {
      job.state = 'preparing'
      emit(job, true)
      store.setJobState(job.bookId, 'running')
      if (job.replace) store.replace(job.bookId)
      if (signal.aborted) throw Object.assign(new Error('Transcription aborted'), { code: 'ABORTED' })

      const units = await buildPlan(job)
      if (units.length === 0) throw new StartError('INVALID_ARGUMENT', 'Nothing to transcribe in the requested range')
      job.totalMs = units.reduce((sum, unit) => sum + unit.requestedMs, 0)
      job.doneMs = units.reduce((sum, unit) => sum + unit.coveredMs, 0)
      const first = units[0] as Unit
      if (first.trackId !== undefined) {
        // multi-track: even the first snapshot says which track is current and how far it is
        job.trackId = first.trackId
        job.trackTotalMs = first.requestedMs
        job.trackDoneMs = first.coveredMs
      }
      job.state = 'running'
      emit(job, true)

      for (let index = 0; index < units.length; index += 1) {
        const unit = units[index] as Unit
        // Whole-job progress = units already finished (their full length) + this unit's own progress + what later units already have.
        const finishedBefore = units.slice(0, index).reduce((sum, u) => sum + u.requestedMs, 0)
        const coveredAfter = units.slice(index + 1).reduce((sum, u) => sum + u.coveredMs, 0)
        const multi = unit.trackId !== undefined
        if (multi) {
          job.trackId = unit.trackId
          job.trackTotalMs = unit.requestedMs
          job.trackDoneMs = unit.coveredMs
        }
        let finishedInUnit = unit.coveredMs
        for (const range of unit.todo) {
          let rangeDone = 0
          for (const window of planWindows(range)) {
            if (signal.aborted) throw Object.assign(new Error('Transcription aborted'), { code: 'ABORTED' })
            const samples = await decoder.decodeWindow({ filePath: unit.filePath, startMs: window.startMs, lengthMs: window.lengthMs, signal })
            if (samples.length === 0) break // at or past the end of the audio: nothing more in this range
            const actualMs = Math.min(window.lengthMs, Math.round((samples.length * 1000) / DECODE_SAMPLE_RATE))
            const intervalEnd = window.startMs + actualMs
            const result = await speech.transcribe({ modelId: job.modelId, language: job.language, samples }, { signal })
            if (signal.aborted) throw Object.assign(new Error('Transcription aborted'), { code: 'ABORTED' })

            const passages: TranscriptPassage[] = []
            for (const segment of result.segments) {
              const text = normalisePassageText(segment.text)
              const startMs = Math.max(window.startMs, Math.round(window.startMs + segment.startMs))
              const endMs = Math.min(intervalEnd, Math.round(window.startMs + segment.endMs))
              if (!text || startMs >= endMs) continue
              const passage: TranscriptPassage = { startMs, endMs, text }
              if (unit.trackId !== undefined) passage.trackId = unit.trackId
              passages.push(passage)
            }
            const committed = store.commitWindow(job.bookId, passages, { trackId: unit.trackId, startMs: window.startMs, endMs: intervalEnd })
            if (!committed) throw new Error('The transcript could not be updated (it was removed or the window was refused)')
            job.passagesAdded += committed.inserted
            try {
              events.passagesAdded({ bookId: job.bookId, ...(unit.trackId !== undefined ? { trackId: unit.trackId } : {}), fromMs: window.startMs, toMs: intervalEnd })
            } catch {
              /* a closed window must not stop a job */
            }

            rangeDone = intervalEnd - range[0]
            const unitDone = Math.min(unit.requestedMs, finishedInUnit + rangeDone)
            job.doneMs = Math.min(job.totalMs, finishedBefore + unitDone + coveredAfter)
            if (multi) job.trackDoneMs = unitDone
            emit(job, false)
            if (actualMs < window.lengthMs) break // the file ended inside this window
          }
          finishedInUnit += Math.min(rangeDone, range[1] - range[0])
        }
        job.doneMs = Math.min(job.totalMs, finishedBefore + unit.requestedMs + coveredAfter)
        if (multi) job.trackDoneMs = unit.requestedMs
      }

      // Finished: the requested scope is covered.
      const record = store.get(job.bookId)
      const noSpeech = (record?.passageCount ?? 0) === 0
      job.state = 'done'
      if (noSpeech) job.error = 'NO_SPEECH'
      store.endJob(job.bookId, 'complete', noSpeech ? 'NO_SPEECH' : null)
      job.doneMs = job.totalMs
      emit(job, true)
    } catch (error) {
      finishFailed(job, error)
    }
  }

  function finishFailed(job: Job, error: unknown): void {
    const code = codeOf(error)
    const cancelled = code === 'ABORTED' || job.abort.signal.aborted
    let record: TranscriptRecord | null = null
    try {
      record = store.get(job.bookId)
    } catch {
      /* ignore: the outcome below still clears the marker */
    }
    try {
      if (cancelled) {
        const empty = !record || (record.coveredMs === 0 && record.passageCount === 0)
        if (job.createdTranscript && empty) store.deleteForBook(job.bookId)
        else store.endJob(job.bookId, 'cancelled', null)
        job.state = 'cancelled'
      } else {
        const hasProgress = !!record && (record.coveredMs > 0 || record.passageCount > 0)
        store.endJob(job.bookId, hasProgress ? 'partial' : 'failed', code)
        job.state = 'failed'
        job.error = code
      }
    } catch {
      job.state = cancelled ? 'cancelled' : 'failed'
      if (!cancelled) job.error = code
    }
    emit(job, true)
  }

  // ------------------------------------------------------------------------------------------------ reads and housekeeping

  async function totalMsOf(bookId: string): Promise<number> {
    const tracks = source.listTracks(bookId)
    if (tracks.length > 0) return tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0)
    const cached = durationCache.get(bookId)
    if (cached !== undefined) return cached
    try {
      const file = await source.resolveFile(bookId)
      if (!file.ok) return 0
      const duration = await source.probeDurationMs(file.path)
      if (duration && duration > 0) {
        durationCache.set(bookId, Math.round(duration))
        return Math.round(duration)
      }
    } catch {
      /* unknown duration is reported as 0 */
    }
    return 0
  }

  async function getInfo(bookId: unknown, appLanguage?: unknown): Promise<TranscriptionInfoDto> {
    let bookTag: string | null | undefined
    try {
      bookTag = typeof bookId === 'string' ? await source.languageTag?.(bookId) : undefined
    } catch {
      bookTag = undefined // an unreadable tag is "no tag": the default falls back to the app language
    }
    const defaultLanguage = resolveDefaultTranscriptionLanguage(bookTag, typeof appLanguage === 'string' ? appLanguage : undefined)
    const modelList = await models.list()
    if (typeof bookId !== 'string' || !bookId.trim()) return { transcript: null, job: null, models: modelList, defaultLanguage, decoder: await decoderStatus() }
    const id = bookId.trim()
    const record = store.get(id)
    let transcript: TranscriptSummaryDto | null = null
    if (record) {
      transcript = {
        status: record.status,
        language: record.language,
        modelId: record.modelId,
        coveredMs: record.coveredMs,
        totalMs: await totalMsOf(id),
        passageCount: record.passageCount,
      }
      if (record.lastError) transcript.lastError = record.lastError
      if (record.scope) transcript.scope = record.scope
    }
    const job = jobOfBook(id)
    return { transcript, job: job ? toJobDto(job) : null, models: modelList, defaultLanguage, decoder: await decoderStatus() }
  }

  function getPassages(raw: unknown): TranscriptPassageDto[] {
    if (!raw || typeof raw !== 'object') return []
    const request = raw as TranscriptionPassagesRequestDto
    if (typeof request.bookId !== 'string' || !request.bookId.trim()) return []
    const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
    return store
      .getPassages(request.bookId.trim(), {
        trackId: typeof request.trackId === 'string' && request.trackId ? request.trackId : undefined,
        fromMs: finite(request.fromMs),
        toMs: finite(request.toMs),
        limit: finite(request.limit),
        offset: finite(request.offset),
      })
      .map((p) => {
        const dto: TranscriptPassageDto = { id: p.id, startMs: p.startMs, endMs: p.endMs, text: p.text }
        if (p.trackId) dto.trackId = p.trackId
        return dto
      })
  }

  /** Full-text search inside one book's transcript (FR-010): hits in playback order, each with the passage's start to jump to. */
  function search(bookId: unknown, query: unknown, limit?: unknown): TranscriptionSearchHitDto[] {
    if (typeof bookId !== 'string' || !bookId.trim() || typeof query !== 'string') return []
    const text = query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH)
    if (!text) return []
    return store
      .search(bookId.trim(), text, typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined)
      .map((hit) => {
        const dto: TranscriptionSearchHitDto = { passageId: hit.passageId, startMs: hit.startMs, snippet: hit.snippet }
        if (hit.trackId) dto.trackId = hit.trackId
        return dto
      })
  }

  /**
   * The transcript as plain text for an export (FR-011): EVERY passage in reading order (the 2000 cap of an ordinary read does
   * not apply), track headings for a multi-track audiobook, optional `[hh:mm:ss]` stamps. Pure text — the save dialog and the
   * file belong to Main's IPC layer (`transcript-export-file.ts`); the renderer never sees a path.
   */
  async function buildExport(bookId: unknown, options?: unknown): Promise<TranscriptExportBuild> {
    if (typeof bookId !== 'string' || !bookId.trim()) return failure('INVALID_ARGUMENT', 'Missing bookId')
    const id = bookId.trim()
    const record = store.get(id)
    if (!record) return failure('INVALID_ARGUMENT', 'This audiobook has no transcript to export')
    if (record.passageCount === 0) return failure('NO_SPEECH', 'The transcript has no text to export')
    const timestamps = !!options && typeof options === 'object' && (options as { timestamps?: unknown }).timestamps === true
    const passages: TranscriptPassage[] = []
    for (;;) {
      const page = store.getPassages(id, { limit: EXPORT_PAGE, offset: passages.length })
      passages.push(...page)
      if (page.length < EXPORT_PAGE) break
    }
    const tracks = source.listTracks(id).map((track) => ({ id: track.id, title: track.title }))
    return { ok: true, text: formatTranscriptText(passages, { tracks: tracks.length > 0 ? tracks : undefined, timestamps }), passageCount: passages.length }
  }

  async function downloadModel(modelId: unknown): Promise<TranscriptionDownloadModelResult> {
    // Nothing is downloaded while transcription is switched off, or while the decoder that would use the model is missing.
    if (!isEnabled()) return failure('FEATURE_DISABLED', FEATURE_DISABLED_MESSAGE)
    if (typeof modelId !== 'string' || !models.catalog.some((model) => model.id === modelId)) return failure('INVALID_ARGUMENT', 'Unknown speech model')
    const availability = await decoder.availability()
    if (!availability.available) return failure('DECODE_FAILED', decoderUnavailableMessage(availability))
    try {
      await models.download(modelId, {
        onProgress: (progress) => {
          try {
            events.modelProgress(progress)
          } catch {
            /* a closed window must not stop a download */
          }
        },
      })
      return { ok: true }
    } catch (error) {
      return failure(codeOf(error), messageOf(error))
    }
  }

  /** A transcription is queued or running (anywhere in the library). */
  const isBusy = (): boolean => active !== null || queue.length > 0

  /**
   * Settings → Storage → remove a downloaded speech model. Refused while any transcription is queued or running (it may be using
   * the model); the speech process is stopped first so a loaded model file is not held open, then the folder is deleted. The model
   * downloads again the next time it is chosen.
   */
  async function removeModel(modelId: unknown): Promise<RemoveModelResult> {
    if (typeof modelId !== 'string' || !models.catalog.some((model) => model.id === modelId)) {
      return { ok: false, errorCode: 'not_found', errorMessage: 'Unknown speech model.' }
    }
    if (isBusy() || !speech.stop()) {
      return { ok: false, errorCode: 'busy', errorMessage: 'A transcription is in progress. Try again when it finishes.' }
    }
    try {
      await models.remove(modelId)
      return { ok: true }
    } catch (error) {
      return { ok: false, errorCode: 'failed', errorMessage: `Could not remove the model: ${messageOf(error)}` }
    }
  }

  /** Delete a book's transcript; a queued or running job of that book is cancelled first and finished before the rows go. */
  async function deleteTranscript(bookId: unknown): Promise<OkResult> {
    if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false }
    const id = bookId.trim()
    const job = jobOfBook(id)
    if (job) {
      cancel(job.id)
      await job.settled
    }
    store.deleteForBook(id)
    durationCache.delete(id)
    return { ok: true }
  }

  /** App quit: stop the queue and the running job, then the speech process. */
  async function shutdown(): Promise<void> {
    shuttingDown = true
    for (const job of [...queue]) cancel(job.id)
    const running = active
    if (running) {
      running.abort.abort()
      await running.settled
    }
    speech.dispose()
  }

  return { start, cancel, getInfo, getPassages, search, buildExport, downloadModel, removeModel, isBusy, delete: deleteTranscript, shutdown, activeJobId: (): string | null => active?.id ?? null }
}

export type TranscriptionService = ReturnType<typeof createTranscriptionService>
