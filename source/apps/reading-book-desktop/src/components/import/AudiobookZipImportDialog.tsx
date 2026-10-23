import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildZipTree,
  canConfirmSelection,
  flattenZipTree,
  formatPlaybackTime,
  type ZipImportPreview,
  type ZipPreviewEntry,
} from '@reading-book/book-reader-sdk'
import { useZipImportStore } from '../../hooks/library'

const ROW_HEIGHT = 32
const OVERSCAN = 8

const GHOST_BTN =
  'inline-flex h-[34px] cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3.5 text-[13px] font-medium text-lib-muted transition-colors hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BTN =
  'inline-flex h-[34px] cursor-pointer items-center rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

function iconFor(entry: ZipPreviewEntry): string {
  if (entry.kind === 'audio') return entry.status === 'unsupported' ? '⚠' : '♪'
  if (entry.kind === 'image') return '▣'
  if (entry.kind === 'metadata' || entry.kind === 'document') return '≡'
  if (entry.kind === 'archive') return '▤'
  return '·'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function Shell({ title, labelId, children }: { title: string; labelId: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="flex max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-xl border border-lib-border bg-lib-surface-strong shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
      >
        <h2 id={labelId} className="sr-only">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/** Audiobook ZIP import preview: archive tree, chapters in playback order, cover choice. */
export function AudiobookZipImportDialog() {
  const phase = useZipImportStore((s) => s.phase)
  const archiveName = useZipImportStore((s) => s.archiveName)
  const preview = useZipImportStore((s) => s.preview)
  const error = useZipImportStore((s) => s.error)
  const labelId = useId()

  useEffect(() => {
    if (phase === 'closed') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        void useZipImportStore.getState().cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase])

  if (phase === 'closed') return null

  if (phase === 'inspecting') {
    return (
      <Shell title="Inspecting archive" labelId={labelId}>
        <div className="flex flex-col gap-3 px-6 py-6" role="status" aria-live="polite">
          <p className="m-0 text-base font-semibold text-lib-text-strong">Inspecting archive…</p>
          <p className="m-0 truncate text-[13px] text-lib-muted">{archiveName}</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-lib-accent" />
          </div>
          <div className="flex justify-end">
            <button type="button" className={GHOST_BTN} onClick={() => void useZipImportStore.getState().cancel()}>
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'error' || !preview) {
    return (
      <Shell title="Audiobook ZIP import failed" labelId={labelId}>
        <div className="flex flex-col gap-4 px-6 py-6">
          <p className="m-0 text-base font-semibold text-lib-text-strong">This ZIP could not be imported</p>
          <p className="m-0 text-[13px] text-red-400" role="alert">
            {error?.message ?? 'Something went wrong.'}
          </p>
          <div className="flex justify-end gap-2.5">
            <button type="button" className={GHOST_BTN} onClick={() => void useZipImportStore.getState().cancel()}>
              Close
            </button>
            <button type="button" className={PRIMARY_BTN} onClick={() => void useZipImportStore.getState().start()}>
              Choose another ZIP
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell title={`Import audiobook from ${preview.archiveName}`} labelId={labelId}>
      <PreviewBody preview={preview} busy={phase === 'confirming'} />
    </Shell>
  )
}

function PreviewBody({ preview, busy }: { preview: ZipImportPreview; busy: boolean }) {
  const selection = useZipImportStore((s) => s.selection)
  const collapsed = useZipImportStore((s) => s.collapsed)
  const coverUrls = useZipImportStore((s) => s.coverUrls)
  const error = useZipImportStore((s) => s.error)
  const store = useZipImportStore.getState

  const byId = useMemo(() => new Map(preview.entries.map((e) => [e.id, e])), [preview])
  const rows = useMemo(() => flattenZipTree(buildZipTree(preview.entries), collapsed), [preview, collapsed])
  const selected = useMemo(() => new Set(selection.trackIds), [selection.trackIds])
  const unsupportedCount = preview.entries.filter((e) => e.kind === 'audio' && e.status === 'unsupported').length
  const noAudio = preview.trackOrder.length === 0

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-lib-border-soft px-6 pt-5 pb-3.5">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-lg font-semibold text-lib-text-strong" title={preview.archiveName}>
            {preview.archiveName}
          </h3>
          <p className="m-0 mt-1 text-[13px] text-lib-muted" role="status">
            Archive inspected · {preview.trackOrder.length} audio track{preview.trackOrder.length === 1 ? '' : 's'} detected
            {unsupportedCount > 0 ? ` · ${unsupportedCount} unsupported` : ''}
          </p>
        </div>
        <button
          type="button"
          className={GHOST_BTN}
          disabled={busy}
          onClick={() => void store().cancel()}
        >
          Cancel
        </button>
      </header>

      {noAudio ? (
        <div className="px-6 py-4 text-[13px] text-amber-300" role="alert">
          {unsupportedCount > 0
            ? 'None of the audio files in this archive can be imported. See the warnings in the file list.'
            : 'No audio files were found in this archive.'}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-2 md:overflow-hidden">
        <section className="flex min-h-[240px] min-w-0 flex-col md:min-h-0" aria-label="Archive contents">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="m-0 text-[11px] font-semibold tracking-[0.1em] text-lib-faint uppercase">Archive</h4>
            <div className="flex gap-1.5">
              <button type="button" className={GHOST_BTN + ' !h-7 !px-2.5 !text-xs'} disabled={noAudio || busy} onClick={() => store().selectAll()}>
                Select all
              </button>
              <button type="button" className={GHOST_BTN + ' !h-7 !px-2.5 !text-xs'} disabled={noAudio || busy} onClick={() => store().deselectAll()}>
                Deselect all
              </button>
            </div>
          </div>
          <VirtualTree rows={rows} selected={selected} busy={busy} />
        </section>

        <section className="flex min-w-0 flex-col gap-4 md:min-h-0 md:overflow-y-auto" aria-label="Import settings">
          <div>
            <h4 className="m-0 mb-2 text-[11px] font-semibold tracking-[0.1em] text-lib-faint uppercase">
              Chapters in playback order ({selection.trackIds.length})
            </h4>
            {selection.trackIds.length === 0 ? (
              <p className="m-0 text-[13px] text-lib-muted">No tracks selected.</p>
            ) : (
              <ol className="m-0 flex max-h-[260px] list-none flex-col gap-0.5 overflow-y-auto p-0">
                {selection.trackIds.map((id, i) => {
                  const entry = byId.get(id)
                  if (!entry) return null
                  return (
                    <li key={id} className="flex items-baseline gap-2 text-[13px] text-lib-text" title={entry.path}>
                      <span className="w-7 shrink-0 text-right text-lib-faint tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.durationSeconds ? (
                        <span className="shrink-0 text-xs text-lib-faint tabular-nums">{formatPlaybackTime(entry.durationSeconds)}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            )}
            {preview.warnings
              .filter((w) => w.code !== 'no_cover')
              .map((w) => (
                <p key={w.code} className="m-0 mt-2 text-xs text-amber-300" role="note">
                  {w.message}
                </p>
              ))}
          </div>

          <CoverPicker preview={preview} coverId={selection.coverId} coverUrls={coverUrls} busy={busy} />
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-lib-border-soft px-6 py-3.5">
        <p className="m-0 min-w-0 flex-1 text-[13px] text-red-400" role="alert">
          {error?.message ?? ''}
        </p>
        <div className="flex shrink-0 gap-2.5">
          <button type="button" className={GHOST_BTN} disabled={busy} onClick={() => void store().cancel()}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY_BTN}
            disabled={busy || !canConfirmSelection(selection)}
            onClick={() => void store().confirm()}
          >
            {busy ? 'Importing…' : error ? 'Try again' : `Import ${selection.trackIds.length} chapter${selection.trackIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </footer>
    </>
  )
}

function VirtualTree({
  rows,
  selected,
  busy,
}: {
  rows: ReturnType<typeof flattenZipTree>
  selected: ReadonlySet<string>
  busy: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(320)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight || 320)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const store = useZipImportStore.getState

  return (
    <div
      ref={ref}
      role="tree"
      aria-label="Archive contents"
      className="min-h-0 flex-1 overflow-auto rounded-lg border border-lib-border-soft bg-[rgba(15,23,42,0.35)]"
      style={{ maxHeight: 420 }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative', minWidth: 'max-content' }}>
        {rows.slice(first, last).map((row, i) => {
          const { node, depth, expanded } = row
          const entry = node.entry
          const top = (first + i) * ROW_HEIGHT
          const eligible = entry?.eligible === true
          const dim = entry !== undefined && !eligible && entry.kind !== 'audio'
          return (
            <div
              key={node.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={node.isFolder ? expanded : undefined}
              className={`absolute right-0 left-0 flex items-center gap-2 pr-3 text-[13px] ${dim ? 'text-lib-faint' : 'text-lib-text'}`}
              style={{ top, height: ROW_HEIGHT, paddingLeft: 8 + depth * 16 }}
              title={entry?.reason ? `${node.path} — ${entry.reason}` : node.path}
            >
              {node.isFolder ? (
                <button
                  type="button"
                  className="inline-flex h-6 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left text-lib-text-strong"
                  onClick={() => store().toggleFolder(node.path)}
                >
                  <span className="w-3 text-xs" aria-hidden>
                    {expanded ? '▾' : '▸'}
                  </span>
                  <span aria-hidden>▭</span>
                  <span className="truncate">{node.name}</span>
                </button>
              ) : entry ? (
                <>
                  {entry.kind === 'audio' ? (
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-[var(--color-lib-accent)]"
                      aria-label={`Include ${entry.name}`}
                      checked={selected.has(entry.id)}
                      disabled={!eligible || busy}
                      onChange={() => store().toggleTrack(entry.id)}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span aria-hidden className={entry.status === 'unsupported' ? 'text-amber-300' : ''}>
                    {iconFor(entry)}
                  </span>
                  <span className="truncate">{entry.name}</span>
                  {entry.status === 'unsupported' ? (
                    <span className="shrink-0 text-xs text-amber-300">{entry.reason ?? 'Unsupported'}</span>
                  ) : entry.reason ? (
                    <span className="shrink-0 text-xs text-lib-faint">{entry.reason}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 pl-3 text-xs text-lib-faint tabular-nums">
                    {entry.durationSeconds ? formatPlaybackTime(entry.durationSeconds) : formatSize(entry.size)}
                  </span>
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      {rows.length === 0 ? <p className="m-0 p-3 text-[13px] text-lib-muted">The archive has no files.</p> : null}
    </div>
  )
}

function CoverPicker({
  preview,
  coverId,
  coverUrls,
  busy,
}: {
  preview: ZipImportPreview
  coverId: string | null
  coverUrls: Readonly<Record<string, string | null>>
  busy: boolean
}) {
  const store = useZipImportStore.getState
  const byId = new Map(preview.entries.map((e) => [e.id, e]))
  const current = coverId ? byId.get(coverId) : undefined
  const url = coverId ? coverUrls[coverId] : null
  return (
    <div>
      <h4 className="m-0 mb-2 text-[11px] font-semibold tracking-[0.1em] text-lib-faint uppercase">Cover</h4>
      {preview.coverCandidates.length === 0 ? (
        <p className="m-0 text-[13px] text-lib-muted">No cover image found. The default cover will be used.</p>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-[112px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-lib-border-soft bg-[rgba(15,23,42,0.45)] text-xs text-lib-faint">
            {url ? <img src={url} alt="Selected cover" className="h-full w-full object-cover" /> : current ? 'No preview' : 'No cover'}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label className="text-xs text-lib-muted" htmlFor="zip-cover-select">
              Cover image
            </label>
            <select
              id="zip-cover-select"
              className="h-[34px] w-full rounded-lg border border-lib-border bg-[rgba(15,23,42,0.45)] px-2 text-[13px] text-lib-text-strong"
              value={coverId ?? ''}
              disabled={busy}
              onChange={(e) => store().chooseCover(e.target.value || null)}
            >
              <option value="">No cover</option>
              {preview.coverCandidates.map((id) => (
                <option key={id} value={id}>
                  {byId.get(id)?.path ?? id}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
