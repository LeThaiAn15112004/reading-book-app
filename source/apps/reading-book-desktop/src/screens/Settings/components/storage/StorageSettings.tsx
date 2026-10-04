import { useEffect, useState } from 'react'
import { ConfirmBookActionDialog } from '../../../Library/components/book/ConfirmBookActionDialog'
import { useStorageStore } from '../../logic/storageStore'
import { SettingsCard } from '../layout/SettingsCard'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const secondaryButton =
  'inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60'

/** Usage segments in display order; colors are theme tokens / neutral swatches. */
const SEGMENTS = [
  { key: 'books', label: 'Books', color: 'var(--lib-accent)' },
  { key: 'cache', label: 'Cache', color: '#38bdf8' },
  { key: 'models', label: 'Translation Models', color: '#a78bfa' },
  { key: 'other', label: 'Other', color: 'var(--lib-faint)' },
] as const

/**
 * SCR-06 Settings → Storage: where managed books live, what Clear Cache removes, downloaded
 * translation models and a usage breakdown. Not a place to manage books (that is the Library).
 */
export function StorageSettings() {
  const usage = useStorageStore((s) => s.usage)
  const loading = useStorageStore((s) => s.loading)
  const loadError = useStorageStore((s) => s.loadError)
  const clearing = useStorageStore((s) => s.clearing)
  const removingModelId = useStorageStore((s) => s.removingModelId)
  const notice = useStorageStore((s) => s.notice)
  const load = useStorageStore((s) => s.load)
  const clearCache = useStorageStore((s) => s.clearCache)
  const removeTranslationModel = useStorageStore((s) => s.removeTranslationModel)
  const openBooksFolder = useStorageStore((s) => s.openBooksFolder)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRemoveModel, setConfirmRemoveModel] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const sizes = {
    books: usage?.booksBytes ?? 0,
    cache: usage?.cacheBytes ?? 0,
    models: usage?.translationModelsBytes ?? 0,
    other: usage?.otherBytes ?? 0,
  }
  const total = usage?.totalBytes ?? 0

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {notice ? (
        <p
          role="status"
          className={`m-0 rounded-lg border px-3 py-2 text-[13px] ${
            notice.tone === 'success'
              ? 'border-lib-accent-ring bg-lib-accent-soft text-lib-text-strong'
              : 'border-red-400/40 bg-red-500/10 text-red-400'
          }`}
        >
          {notice.text}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="m-0 text-[13px] text-red-400">
          {loadError}
        </p>
      ) : null}

      <SettingsCard
        title="Book Storage"
        description="Books downloaded from a URL or a cloud source are kept here. Books you add from your own folders stay where they are and are not copied."
      >
        <p className="m-0 text-[12px] font-semibold text-lib-muted">Book Storage Location</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <code
            className="min-w-0 flex-1 truncate rounded-md border border-lib-border-soft bg-lib-input px-2.5 py-2 font-mono text-[12px] text-lib-text-strong select-text"
            title={usage?.booksFolderPath}
          >
            {usage?.booksFolderPath ?? (loading ? 'Loading…' : '—')}
          </code>
          <button type="button" className={secondaryButton} onClick={() => void openBooksFolder()}>
            Open Folder
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Cache"
        description="Temporary data the app can rebuild: the in-book search index and the browser cache. Clearing it never deletes books, annotations, reading progress, collections, metadata or translation models."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="m-0 text-[13px] text-lib-muted">Used</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums">
              {usage ? formatBytes(usage.cacheBytes) : loading ? 'Loading…' : '—'}
            </p>
            {usage ? (
              <p className="m-0 mt-1 text-[11px] text-lib-faint tabular-nums">
                Search index {formatBytes(usage.searchIndexBytes)} · Browser cache{' '}
                {formatBytes(usage.browserCacheBytes)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={clearing || !usage}
            onClick={() => setConfirmClear(true)}
          >
            {clearing ? 'Clearing…' : 'Clear Cache'}
          </button>
        </div>
        <p className="m-0 mt-3 text-[12px] text-lib-faint">
          After clearing, search and word count rebuild a book&apos;s index the next time you open
          it.
        </p>
      </SettingsCard>

      <SettingsCard
        title="Translation Models"
        description="Offline translation models downloaded by the Translate tool. They are not cache: remove one to free space; it downloads again the next time you translate that language pair."
      >
        {usage && usage.translationModels.length > 0 ? (
          <ul className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0">
            {usage.translationModels.map((model) => (
              <li
                key={model.id}
                className="flex min-h-[var(--ui-density-row)] items-center justify-between gap-3 px-3 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-[12px] text-lib-text-strong">
                  {model.id}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[12px] text-lib-muted tabular-nums">
                    {formatBytes(model.bytes)}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center rounded-md border border-lib-border bg-transparent px-2.5 text-[12px] font-semibold text-lib-muted transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Remove ${model.id}`}
                    disabled={removingModelId !== null}
                    onClick={() => setConfirmRemoveModel(model.id)}
                  >
                    {removingModelId === model.id ? 'Removing…' : 'Remove'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-lib-faint">
            {usage ? 'No translation models downloaded.' : loading ? 'Loading…' : '—'}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Storage Usage" description="Space used by Readmate Reader's own data.">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-lib-chip"
          role="img"
          aria-label={`Total ${formatBytes(total)}`}
        >
          {total > 0
            ? SEGMENTS.map((segment) => {
                const share = (sizes[segment.key] / total) * 100
                return share > 0 ? (
                  <span
                    key={segment.key}
                    style={{ width: `${share}%`, background: segment.color }}
                    title={`${segment.label} ${formatBytes(sizes[segment.key])}`}
                  />
                ) : null
              })
            : null}
        </div>
        <dl className="m-0 mt-4 flex flex-col gap-2 text-[13px]">
          {SEGMENTS.map((segment) => (
            <div key={segment.key} className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-lib-muted">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: segment.color }}
                  aria-hidden
                />
                {segment.label}
              </dt>
              <dd className="m-0 text-lib-text-strong tabular-nums">
                {usage ? formatBytes(sizes[segment.key]) : '—'}
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-lib-border-soft pt-2">
            <dt className="font-semibold text-lib-text-strong">Total</dt>
            <dd className="m-0 font-semibold text-lib-text-strong tabular-nums">
              {usage ? formatBytes(total) : '—'}
            </dd>
          </div>
        </dl>
        <p className="m-0 mt-3 text-[12px] text-lib-faint">
          Other includes the library database (books, notes, progress), covers and app settings.
        </p>
      </SettingsCard>

      {confirmClear ? (
        <ConfirmBookActionDialog
          title="Clear Cache?"
          message="This will remove temporary cached data (search index and browser cache). Your books and reading progress will not be deleted."
          confirmLabel="Clear Cache"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false)
            void clearCache()
          }}
        />
      ) : null}

      {confirmRemoveModel ? (
        <ConfirmBookActionDialog
          title="Remove translation model?"
          message={`${confirmRemoveModel} will be deleted from this device. It downloads again the next time you translate this language pair.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setConfirmRemoveModel(null)}
          onConfirm={() => {
            const id = confirmRemoveModel
            setConfirmRemoveModel(null)
            void removeTranslationModel(id)
          }}
        />
      ) : null}
    </div>
  )
}
