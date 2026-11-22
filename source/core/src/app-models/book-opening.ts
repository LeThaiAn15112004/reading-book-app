/**
 * Spec 017 (research R1–R4, data-model "Opening"): one attempt to show a book, as a pure state machine.
 *
 * Steps run in a fixed order, forward only: `content` (get the book's bytes) → `prepare` (format engine, first layout)
 * → `position` (only when a saved reading position is used; own 3 s limit, ends in a fallback, never an error) →
 * `firstPage` (showing it). Every step but `position` has a 20 s limit of FOREGROUND time; the caller passes a
 * foreground clock (`now` = foreground milliseconds), so time spent in the background never counts.
 *
 * Pure: no Node / DOM globals, the clock is passed in. Held by the renderer's `readerOpeningStore`.
 */

export type OpeningStep = 'content' | 'prepare' | 'position' | 'firstPage'

export type OpeningOutcome = 'pending' | 'opened' | 'left' | 'failed'

export type OpeningFormat = 'epub' | 'pdf' | 'txt' | 'md' | 'audio'

export const OPENING_CAUSES = [
  'missing_file',
  'unreadable',
  'damaged',
  'protected',
  'too_large',
  'took_too_long',
  'not_available_offline',
  'file_changed',
] as const

export type OpeningCause = (typeof OPENING_CAUSES)[number]

export type OpeningError = { cause: OpeningCause; step: OpeningStep }

export type OpeningAction = 'tryAgain' | 'fromBeginning' | 'locateFile' | 'importAgain' | 'back'

export type OpeningHost = 'desktop' | 'phone'

export type Opening = {
  /** New per attempt: answers carrying an older token are ignored (FR-008). */
  token: string
  bookId: string
  title: string | null
  coverUrl: string | null
  format: OpeningFormat | null
  step: OpeningStep
  /** Foreground ms when the current step began. */
  stepStartedAt: number
  /** Foreground ms when the opening began (indicator after 300 ms, slow note after 5 s). */
  startedAt: number
  usesSavedPosition: boolean
  /** `false` ⇒ the "couldn't return to where you left off" note. */
  positionRestored: boolean | null
  /** The one automatic retry of a passing read failure was used (R3). */
  retried: boolean
  outcome: OpeningOutcome
  error: OpeningError | null
}

/** Default limit of one step, in foreground ms (FR-003). */
export const STEP_LIMIT_MS = 20_000
/** The saved-position step's own limit (FR-005); past it the book opens at the chapter start. */
export const POSITION_LIMIT_MS = 3_000
/** Indicator and step line join the still frame only after this (FR-010). */
export const INDICATOR_DELAY_MS = 300
/** "Large books can take a little longer." after this (FR-011). */
export const SLOW_NOTE_MS = 5_000
/** Wait before the one automatic retry (R3). */
export const RETRY_DELAY_MS = 400

const STEP_ORDER: Record<OpeningStep, number> = { content: 0, prepare: 1, position: 2, firstPage: 3 }

export function startOpening(input: {
  token: string
  bookId: string
  now: number
  title?: string | null
  coverUrl?: string | null
  usesSavedPosition?: boolean
}): Opening {
  return {
    token: input.token,
    bookId: input.bookId,
    title: input.title ?? null,
    coverUrl: input.coverUrl ?? null,
    format: null,
    step: 'content',
    stepStartedAt: input.now,
    startedAt: input.now,
    usesSavedPosition: input.usesSavedPosition ?? false,
    positionRestored: null,
    retried: false,
    outcome: 'pending',
    error: null,
  }
}

const isPending = (o: Opening) => o.outcome === 'pending'

/** Moves to `step` only if it is later than the current one (forward only). */
function advance(o: Opening, step: OpeningStep, now: number): Opening {
  if (!isPending(o) || STEP_ORDER[step] <= STEP_ORDER[o.step]) return o
  return { ...o, step, stepStartedAt: now }
}

function fail(o: Opening, cause: OpeningCause): Opening {
  if (!isPending(o)) return o
  return { ...o, outcome: 'failed', error: { cause, step: o.step } }
}

export function setBookDetails(o: Opening, details: { title?: string | null; coverUrl?: string | null }): Opening {
  return {
    ...o,
    title: details.title !== undefined ? details.title : o.title,
    coverUrl: details.coverUrl !== undefined ? details.coverUrl : o.coverUrl,
  }
}

export function setUsesSavedPosition(o: Opening, usesSavedPosition: boolean): Opening {
  if (!isPending(o)) return o
  return { ...o, usesSavedPosition }
}

export function contentReady(o: Opening, format: string | null | undefined, now: number): Opening {
  if (!isPending(o)) return o
  return { ...advance(o, 'prepare', now), format: toOpeningFormat(format) }
}

export type ContentFailedResult = { opening: Opening; retry: boolean }

/**
 * The content step failed. A passing failure (`retryable`) is retried once — the step and its clock restart —
 * before an error is shown; a missing / refused / too-large file never is (FR-004).
 */
export function contentFailed(
  o: Opening,
  code: string | null | undefined,
  retryable: boolean,
  now: number,
): ContentFailedResult {
  if (!isPending(o)) return { opening: o, retry: false }
  const cause = causeFromOpenErrorCode(code)
  if (retryable && !o.retried && isRetryableCause(cause)) {
    return { opening: { ...o, retried: true, stepStartedAt: now }, retry: true }
  }
  return { opening: fail(o, cause), retry: false }
}

/** The format engine refused the book (`damaged`) or found it protected (`protected`). */
export function prepareFailed(o: Opening, cause: OpeningCause): Opening {
  return fail(o, cause)
}

export function positionStarted(o: Opening, now: number): Opening {
  return advance(o, 'position', now)
}

export function positionDone(o: Opening, ok: boolean, now: number): Opening {
  if (!isPending(o)) return o
  const next = advance(o, 'firstPage', now)
  return ok ? next : { ...next, positionRestored: false }
}

export function firstPageDrawn(o: Opening): Opening {
  if (!isPending(o)) return o
  return { ...o, outcome: 'opened' }
}

/** Ends the step that passed its limit: the position step falls back (FR-005), any other fails (FR-003). */
export function tick(o: Opening, now: number): Opening {
  if (!isPending(o)) return o
  const elapsed = now - o.stepStartedAt
  if (o.step === 'position') return elapsed > POSITION_LIMIT_MS ? positionDone(o, false, now) : o
  return elapsed > STEP_LIMIT_MS ? fail(o, 'took_too_long') : o
}

/** The reader left (Back / Esc / system Back, or another book opened). Any time, idempotent. */
export function leave(o: Opening): Opening {
  if (!isPending(o)) return o
  return { ...o, outcome: 'left' }
}

/** Limit of the current step in ms (for the store's step signal). */
export function stepLimitMs(step: OpeningStep): number {
  return step === 'position' ? POSITION_LIMIT_MS : STEP_LIMIT_MS
}

export function showIndicator(o: Opening, now: number): boolean {
  return isPending(o) && now - o.startedAt >= INDICATOR_DELAY_MS
}

export function showSlowNote(o: Opening, now: number): boolean {
  return isPending(o) && now - o.startedAt >= SLOW_NOTE_MS
}

/** i18n key (under `reader.opening.`) of the step line. */
export function stepLineKey(step: OpeningStep): 'step.content' | 'step.prepare' | 'step.position' {
  if (step === 'content') return 'step.content'
  if (step === 'position') return 'step.position'
  return 'step.prepare'
}

/** Maps an `OpenBookErrorCode` (both hosts) to the cause shown to the reader. */
export function causeFromOpenErrorCode(code: string | null | undefined): OpeningCause {
  switch (code) {
    case 'missing_file':
    case 'not_found':
    case 'path_denied':
      return 'missing_file'
    case 'too_large':
      return 'too_large'
    case 'not_available_offline':
      return 'not_available_offline'
    case 'file_changed':
      return 'file_changed'
    case 'protected':
      return 'protected'
    case 'damaged':
      return 'damaged'
    default:
      return 'unreadable'
  }
}

/** Causes that a second attempt may fix (the automatic retry and Try again). */
export function isRetryableCause(cause: OpeningCause): boolean {
  return cause !== 'missing_file' && cause !== 'protected' && cause !== 'too_large'
}

/**
 * The actions an error offers, in display order (data-model rules, FR-006): Back always; Try again only when a second
 * attempt may help; Open from the beginning when a saved position was used and the cause may pass; Locate file
 * (Desktop) or the "import it again" explanation (phone) for a missing file.
 */
export function actionsFor(
  error: OpeningError,
  options: { host: OpeningHost; usesSavedPosition: boolean },
): OpeningAction[] {
  const actions: OpeningAction[] = []
  if (error.cause === 'missing_file') actions.push(options.host === 'desktop' ? 'locateFile' : 'importAgain')
  if (isRetryableCause(error.cause)) {
    actions.push('tryAgain')
    if (options.usesSavedPosition) actions.push('fromBeginning')
  }
  actions.push('back')
  return actions
}

/** Timing step name of an opening's end (FR-019), `null` while pending. `opened` is `open-first-page`. */
export function outcomeTimingStep(o: Opening): `open-failed-${OpeningCause}` | 'open-left' | 'open-first-page' | null {
  if (o.outcome === 'opened') return 'open-first-page'
  if (o.outcome === 'left') return 'open-left'
  if (o.outcome === 'failed' && o.error) return `open-failed-${o.error.cause}`
  return null
}

function toOpeningFormat(format: string | null | undefined): OpeningFormat | null {
  const f = (format ?? '').toLowerCase()
  if (f === 'epub' || f === 'pdf' || f === 'txt' || f === 'md') return f
  if (!f) return null
  return 'audio'
}

/** EPUB font-obfuscation algorithms (IDPF + Adobe): fonts only, the book itself is readable. */
export const EPUB_FONT_OBFUSCATION_ALGORITHMS: readonly string[] = [
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]

/**
 * Spec 017 (FR-006, edge case "DRM-protected or encrypted book"): `META-INF/encryption.xml` of an EPUB marks the book
 * as protected when ANY `EncryptionMethod` uses an algorithm other than font obfuscation (e.g. Adobe ADEPT, Readium
 * LCP, plain AES on content documents). No algorithm at all (an empty file) is not protection.
 */
export function isProtectedEpubEncryption(encryptionXml: string): boolean {
  const algorithms = [...encryptionXml.matchAll(/EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!.trim())
  return algorithms.some((a) => !EPUB_FONT_OBFUSCATION_ALGORITHMS.includes(a))
}
