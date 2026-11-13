import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AUTO_LANGUAGE, WHISPER_LANGUAGES } from '@core'
import type { TranscriptionScope } from '../../../bridge'
import { useAudioPlayerStore } from '../logic/audioPlayerStore'
import { decoderUnavailableText, formatMegabytes, speechModelLabel, transcriptionErrorText } from '../logic/transcriptionMessages'
import { isActiveJob, useTranscriptStore } from '../logic/transcriptStore'
import { getT, useFormat, useT, useUiLanguage } from '../../../i18n'

const GHOST_BTN =
  'inline-flex h-[34px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3.5 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BTN =
  'inline-flex h-[34px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
const FIELD =
  'h-[34px] w-full rounded-lg border border-lib-border bg-lib-input px-2.5 text-sm text-lib-text outline-none focus:border-lib-accent-ring disabled:opacity-50'
const LABEL = 'text-[11px] font-bold tracking-wide text-lib-faint uppercase'

type ScopeKind = 'whole' | 'track' | 'range'

/** Minutes typed by the person → milliseconds; `null` when it is not a usable number. */
function minutesToMs(text: string): number | null {
  if (!text.trim()) return null
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 60_000) : null
}


/**
 * "Transcribe" (FR-001 / FR-005 / FR-013 / FR-014): what to transcribe (whole audiobook, one track, or a time range), in which
 * language, with which speech model. A model that is not on this device is downloaded only after the person presses the button
 * that says so — the audio itself never leaves the device. Opens from the "Transcribe" entry or the transcript panel.
 */
export function TranscribeDialog({ bookId }: { bookId: string }) {
  const open = useTranscriptStore((s) => s.dialogOpen)
  return open ? <DialogBody key={bookId} /> : null
}

function DialogBody() {
  const t = useT()
  const format = useFormat()
  const uiLanguage = useUiLanguage()
  // Names in the interface language, sorted the way that language sorts (spec 012).
  const languages = useMemo(
    () =>
      WHISPER_LANGUAGES.map((l) => ({ code: l.code, name: format.languageName(l.code, l.name) })).sort((a, b) =>
        a.name.localeCompare(b.name, uiLanguage),
      ),
    [format, uiLanguage],
  )
  const info = useTranscriptStore((s) => s.info)
  const job = useTranscriptStore((s) => s.job)
  const downloading = useTranscriptStore((s) => s.downloading)
  const actionError = useTranscriptStore((s) => s.actionError)
  const start = useTranscriptStore((s) => s.start)
  const downloadModel = useTranscriptStore((s) => s.downloadModel)
  const close = useTranscriptStore((s) => s.closeDialog)
  const tracks = useAudioPlayerStore((s) => s.tracks)
  const titleId = useId()
  const firstField = useRef<HTMLSelectElement | null>(null)

  const models = info?.models ?? []
  const existing = info?.transcript ?? null
  const multiTrack = tracks.length > 0

  const [scopeKind, setScopeKind] = useState<ScopeKind>('whole')
  const [trackId, setTrackId] = useState<string>(tracks[0]?.id ?? '')
  const [startMin, setStartMin] = useState('0')
  const [endMin, setEndMin] = useState('')
  const [language, setLanguage] = useState<string>(existing?.language ?? info?.defaultLanguage ?? AUTO_LANGUAGE)
  const [modelId, setModelId] = useState<string>(() => {
    if (existing && models.some((m) => m.id === existing.modelId)) return existing.modelId
    return (models.find((m) => m.installed) ?? models[0])?.id ?? 'whisper-tiny'
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    firstField.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close])

  const model = models.find((m) => m.id === modelId)
  // The audio decoder decides whether any of this can work: with no decoder nothing is offered for download.
  const decoderMissing = info?.decoder.available === false
  const needsDownload = !!model && !model.installed && !decoderMissing
  const defaultLanguage = info?.defaultLanguage ?? AUTO_LANGUAGE
  const alreadyRunning = isActiveJob(job)

  const range = useMemo(() => {
    if (scopeKind !== 'range') return { ok: true as const, startMs: 0, endMs: 0 }
    const startMs = minutesToMs(startMin)
    const endMs = minutesToMs(endMin)
    if (startMs === null || endMs === null) return { ok: false as const, message: getT()('audiobook.transcription.dialog.rangeInvalid') }
    if (startMs >= endMs) return { ok: false as const, message: getT()('audiobook.transcription.dialog.rangeOrder') }
    return { ok: true as const, startMs, endMs }
  }, [scopeKind, startMin, endMin])
  const trackMissing = (scopeKind === 'track' || (scopeKind === 'range' && multiTrack)) && !trackId
  const canStart = !busy && !alreadyRunning && !decoderMissing && !!model && range.ok && !trackMissing

  const buildScope = (): TranscriptionScope => {
    if (scopeKind === 'track') return { kind: 'track', trackId }
    if (scopeKind === 'range' && range.ok) {
      return multiTrack ? { kind: 'range', trackId, startMs: range.startMs, endMs: range.endMs } : { kind: 'range', startMs: range.startMs, endMs: range.endMs }
    }
    return { kind: 'whole' }
  }

  const submit = async (): Promise<void> => {
    if (!canStart) return
    setBusy(true)
    try {
      // Explicit consent: pressing this button is the consent to download; nothing is fetched before it.
      if (needsDownload && !(await downloadModel(modelId))) return
      if (await start({ scope: buildScope(), language, modelId })) close()
    } finally {
      setBusy(false)
    }
  }

  const progress = downloading && downloading.totalBytes > 0 ? Math.min(100, Math.round((downloading.loadedBytes / downloading.totalBytes) * 100)) : null

  return (
    <div className="app-no-drag fixed inset-0 z-[300] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-transcribe-dialog
        className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-auto rounded-2xl border border-lib-border bg-lib-surface-strong p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2 id={titleId} className="m-0 text-base font-semibold text-lib-text-strong">
          {t('audiobook.transcription.dialog.title')}
        </h2>
        <p className="m-0 text-[13px] leading-relaxed text-lib-muted">
          {t('audiobook.transcription.dialog.intro')}
          {existing ? t('audiobook.transcription.dialog.existing') : ''}
        </p>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${LABEL} mb-1 p-0`}>{t('audiobook.transcription.dialog.what')}</legend>
          <label className="flex items-center gap-2 text-sm text-lib-text">
            <input type="radio" name="transcribe-scope" checked={scopeKind === 'whole'} onChange={() => setScopeKind('whole')} disabled={busy} />
            {multiTrack ? t('audiobook.transcription.dialog.wholeMulti') : t('audiobook.transcription.dialog.whole')}
          </label>
          {multiTrack ? (
            <label className="flex items-center gap-2 text-sm text-lib-text">
              <input type="radio" name="transcribe-scope" checked={scopeKind === 'track'} onChange={() => setScopeKind('track')} disabled={busy} />
              {t('audiobook.transcription.dialog.oneTrack')}
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-lib-text">
            <input type="radio" name="transcribe-scope" checked={scopeKind === 'range'} onChange={() => setScopeKind('range')} disabled={busy} />
            {multiTrack ? t('audiobook.transcription.dialog.rangeMulti') : t('audiobook.transcription.dialog.range')}
          </label>
          {scopeKind === 'track' || (scopeKind === 'range' && multiTrack) ? (
            <select className={FIELD} aria-label={t('audiobook.transcription.dialog.track')} value={trackId} onChange={(event) => setTrackId(event.target.value)} disabled={busy}>
              {tracks.map((track, index) => (
                <option key={track.id} value={track.id}>
                  {String(index + 1).padStart(2, '0')} · {track.title}
                </option>
              ))}
            </select>
          ) : null}
          {scopeKind === 'range' ? (
            <div className="flex items-center gap-2 text-sm text-lib-muted">
              <input className={FIELD} inputMode="decimal" aria-label={t('audiobook.transcription.dialog.start')} value={startMin} onChange={(event) => setStartMin(event.target.value)} disabled={busy} />
              <span aria-hidden>–</span>
              <input className={FIELD} inputMode="decimal" aria-label={t('audiobook.transcription.dialog.end')} value={endMin} onChange={(event) => setEndMin(event.target.value)} disabled={busy} />
              <span>{t('audiobook.transcription.dialog.min')}</span>
            </div>
          ) : null}
          {scopeKind === 'range' && !range.ok ? (
            <p role="alert" className="m-0 text-[12px] text-rose-300">
              {range.message}
            </p>
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t('audiobook.transcription.dialog.language')}</span>
          <select ref={firstField} className={FIELD} value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
            <option value={AUTO_LANGUAGE}>{t('audiobook.transcription.dialog.autoDetect')}{defaultLanguage === AUTO_LANGUAGE ? t('audiobook.transcription.dialog.defaultSuffix') : ''}</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
                {defaultLanguage === l.code ? t('audiobook.transcription.dialog.defaultSuffix') : ''}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${LABEL} mb-1 p-0`}>{t('audiobook.transcription.dialog.model')}</legend>
          {models.length === 0 ? <p className="m-0 text-[13px] text-lib-muted">{t('audiobook.transcription.dialog.modelsUnreadable')}</p> : null}
          {models.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm text-lib-text">
              <input type="radio" name="transcribe-model" checked={modelId === m.id} onChange={() => setModelId(m.id)} disabled={busy} />
              <span className="min-w-0 flex-1 truncate">{speechModelLabel(m.id, m.label)}</span>
              <span className="shrink-0 text-[12px] text-lib-muted">{m.installed ? t('audiobook.transcription.dialog.onDevice') : formatMegabytes(m.sizeBytes)}</span>
            </label>
          ))}
          {needsDownload ? (
            <p className="m-0 text-[12px] leading-relaxed text-lib-muted">
              {t('audiobook.transcription.dialog.needsDownload', { size: formatMegabytes(model?.sizeBytes ?? 0) })}
            </p>
          ) : null}
          {downloading ? (
            <div className="flex flex-col gap-1" role="status">
              <span className="text-[12px] text-lib-muted">{progress !== null ? t('audiobook.transcription.dialog.downloadingModelPercent', { percent: progress }) : t('audiobook.transcription.dialog.downloadingModel')}</span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-lib-border" aria-hidden>
                <span className="block h-full bg-lib-accent" style={{ width: `${progress ?? 0}%` }} />
              </span>
            </div>
          ) : null}
        </fieldset>

        {decoderMissing ? (
          <p role="alert" data-transcribe-decoder-missing className="m-0 text-[13px] leading-relaxed text-rose-300">
            {t('audiobook.transcription.dialog.decoderMissing', { reason: decoderUnavailableText(info?.decoder.reason) })}
          </p>
        ) : null}
        {alreadyRunning ? (
          <p role="status" className="m-0 text-[13px] text-lib-muted">
            {t('audiobook.transcription.dialog.alreadyRunning')}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="m-0 text-[13px] leading-relaxed text-rose-300">
            {transcriptionErrorText(actionError.code, actionError.message)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST_BTN} onClick={close} disabled={busy}>
            {t('common.actions.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BTN} disabled={!canStart}>
            {busy ? (needsDownload && downloading ? t('audiobook.transcription.dialog.downloading') : t('audiobook.transcription.dialog.starting')) : needsDownload ? t('audiobook.transcription.dialog.downloadAndTranscribe') : t('audiobook.transcription.dialog.transcribe')}
          </button>
        </div>
      </form>
    </div>
  )
}
