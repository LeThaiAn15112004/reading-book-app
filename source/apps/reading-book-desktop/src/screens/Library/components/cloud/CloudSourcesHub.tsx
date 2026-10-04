import { useState } from 'react'
import {
  getProviderDisplayName,
  type ExternalCatalogEntry,
  type ExternalLibraryInfo,
  type ExternalLibraryProvider,
} from '@reading-book/book-reader-sdk'
import { formatFileSizeMb, type LibraryBook } from '@reading-book/book-reader-sdk'

const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  mobi: 'MOBI',
  azw3: 'AZW3',
  fb2: 'FB2',
  cbz: 'CBZ',
  txt: 'Plain text',
  md: 'Markdown',
  docx: 'DOCX',
  doc: 'DOC',
}

const GOOGLE_DRIVE_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'txt', 'md'] as const
const DROPBOX_FORMATS = ['epub', 'pdf', 'txt', 'md', 'docx', 'doc'] as const
const ONEDRIVE_FORMATS = [
  'epub',
  'pdf',
  'txt',
  'mobi',
  'md',
  'docx',
  'doc',
  'azw3',
  'fb2',
  'cbz',
] as const

const PROVIDER_FORMATS: Record<ExternalLibraryProvider, readonly string[]> = {
  google_drive: GOOGLE_DRIVE_FORMATS,
  dropbox: DROPBOX_FORMATS,
  onedrive: ONEDRIVE_FORMATS,
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z"
      />
    </svg>
  )
}

/**
 * Determinate ring inside the "Downloading…" button — the filled arc always
 * reflects the real bytes-received/total ratio (0% while the total isn't
 * known yet). No spinning/indeterminate animation.
 */
function DownloadRing({ percent, className }: { percent: number | null; className?: string }) {
  const size = 14
  const strokeWidth = 2
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const isIndeterminate = percent == null || !Number.isFinite(percent)
  const clamped = Math.min(100, Math.max(0, percent ?? 0))
  const dashOffset = circumference * (1 - clamped / 100)
  const svgClassName = [className, isIndeterminate ? 'animate-spin' : null]
    .filter(Boolean)
    .join(' ')

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={svgClassName} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={isIndeterminate ? `${circumference * 0.35} ${circumference}` : circumference}
        strokeDashoffset={isIndeterminate ? 0 : dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={isIndeterminate ? undefined : { transition: 'stroke-dashoffset 150ms ease-out' }}
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function statusLabel(status: ExternalLibraryInfo['status']): string {
  switch (status) {
    case 'linked':
      return 'Connected'
    case 'syncing':
      return 'Syncing…'
    case 'error':
      return 'Connection error'
    case 'disabled':
      return 'Disabled'
    case 'unlinked':
    default:
      return 'Not connected'
  }
}

function statusPillClass(status: ExternalLibraryInfo['status']): string {
  if (status === 'linked') return 'bg-lib-accent-soft text-lib-accent'
  if (status === 'error') return 'bg-red-500/10 text-red-400'
  return 'bg-lib-chip text-lib-muted'
}

export type CloudSourcesHubProps = {
  /** Which provider this dedicated screen manages — set by the Cloud Sources dropdown. */
  provider: ExternalLibraryProvider
  info: ExternalLibraryInfo
  entries: ExternalCatalogEntry[]
  folderPath: string
  onFolderPathChange: (value: string) => void
  isConnecting: boolean
  isSyncing: boolean
  downloadingId: string | null
  /** Byte progress for `downloadingId`'s in-flight download, or null when unknown/idle. */
  downloadProgress?: { receivedBytes: number; totalBytes: number | null } | null
  onConnect: () => void
  onDisconnect: () => void
  onSync: () => void
  onDownload: (entry: ExternalCatalogEntry) => void
  /** Abort the in-flight download of `entry`. */
  onCancelDownload: (entry: ExternalCatalogEntry) => void
  /** Local library, used to tell which catalog entries are already downloaded. */
  books: LibraryBook[]
  onOpenBook: (bookId: string) => void
}

/** Dedicated per-provider Cloud Sources screen — connect, point at a folder, lazily download. */
export function CloudSourcesHub({
  provider,
  info,
  entries,
  folderPath,
  onFolderPathChange,
  isConnecting,
  isSyncing,
  downloadingId,
  downloadProgress,
  onConnect,
  onDisconnect,
  onSync,
  onDownload,
  onCancelDownload,
  books,
  onOpenBook,
}: CloudSourcesHubProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState('all')
  const downloadedByExternalId = new Map<string, string>(
    books
      .filter((b) => b.sourceProvider && b.externalId)
      .map((b) => [`${b.sourceProvider}:${b.externalId}`, b.id]),
  )
  const isLinked = info.status === 'linked'
  const providerName = getProviderDisplayName(provider)
  const providerFormats = PROVIDER_FORMATS[provider]
  const visibleEntries = entries.filter((entry) => {
    const format = entry.formatHint?.replace(/^\./, '').toLowerCase() ?? ''
    if (!providerFormats.includes(format)) {
      return false
    }
    if (formatFilter !== 'all' && format !== formatFilter) {
      return false
    }
    return entry.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
  })

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="region"
      aria-label={`${providerName} Cloud Source`}
    >
      <header className="app-titlebar flex h-16 shrink-0 items-center justify-between gap-4 border-b border-lib-border-soft bg-lib-topbar pl-7 pr-7 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[22px] leading-tight font-semibold tracking-tight text-lib-text-strong">
            {providerName}
          </h1>
          <p className="m-0 mt-0.5 text-[13px] text-lib-muted">
            Connect, point at a folder, and download books only when you open them
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-7 py-7">
        <div className="mx-auto w-full max-w-[900px] rounded-xl border border-lib-border-soft bg-lib-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-lib-chip text-lib-muted">
                <CloudIcon className="size-5" />
              </div>
              <div>
                <h2 className="m-0 text-[15px] font-semibold text-lib-text-strong">
                  {providerName}
                </h2>
                <span
                  className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${statusPillClass(info.status)}`}
                >
                  {statusLabel(info.status)}
                </span>
                {info.lastError ? (
                  <p className="m-0 mt-1 text-[11px] text-red-400">{info.lastError}</p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className={
                isLinked
                  ? 'inline-flex h-9 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-3.5 text-[13px] font-semibold text-lib-muted transition-colors hover:bg-white/5 hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-60'
                  : 'inline-flex h-9 cursor-pointer items-center rounded-lg border-none bg-lib-accent px-3.5 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover disabled:cursor-not-allowed disabled:opacity-60'
              }
              disabled={isConnecting}
              onClick={() => (isLinked ? onDisconnect() : onConnect())}
            >
              {isConnecting ? 'Connecting…' : isLinked ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {isLinked ? (
            <div className="mt-4 border-t border-lib-border-soft pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-lib-muted">
                  <span className="shrink-0">Folder</span>
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => onFolderPathChange(e.target.value)}
                    placeholder={
                      provider === 'google_drive' ? 'Leave empty for your whole Drive' : '/Ebooks'
                    }
                    className="h-8 min-w-0 flex-1 rounded-md border border-lib-border bg-lib-bg-deep px-2.5 text-[12px] text-lib-text-strong outline-none focus:border-lib-accent-ring"
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md border border-lib-border bg-transparent px-3 text-[12px] font-semibold text-lib-text-strong transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSyncing}
                  onClick={() => onSync()}
                >
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
              {provider === 'google_drive' ? (
                <p className="m-0 mt-1.5 text-[11px] text-lib-faint">
                  Google Drive needs a folder <strong>ID</strong> (the string after{' '}
                  <code>/folders/</code> in the folder&apos;s Drive URL), not a path — leave empty to
                  search your entire Drive.
                </p>
              ) : null}
            </div>
          ) : null}

          {isLinked ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <label className="min-w-[180px] flex-1">
                <span className="sr-only">Search {providerName} files</span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search files by title"
                  className="h-9 w-full rounded-md border border-lib-border bg-lib-bg-deep px-3 text-[12px] text-lib-text-strong outline-none placeholder:text-lib-faint focus:border-lib-accent-ring"
                />
              </label>
              <label className="flex min-w-[150px] items-center">
                <span className="sr-only">Filter {providerName} files by format</span>
                <select
                  value={formatFilter}
                  onChange={(e) => setFormatFilter(e.target.value)}
                  className="h-9 w-full rounded-md border border-lib-border bg-lib-bg-deep px-2.5 text-[12px] text-lib-text-strong outline-none focus:border-lib-accent-ring"
                >
                  <option value="all">All formats</option>
                  {providerFormats.map((value) => (
                    <option key={value} value={value}>
                      {FORMAT_LABELS[value] ?? value.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {isLinked && visibleEntries.length > 0 ? (
            <div className="mt-3 max-h-[min(55vh,520px)] overflow-y-auto pr-1">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {visibleEntries.map((entry) => {
                const key = `${entry.sourceProvider}:${entry.externalId}`
                const downloadedBookId = downloadedByExternalId.get(key)
                const size = formatFileSizeMb(entry.fileSizeBytes)
                const isDownloading = downloadingId === entry.externalId
                const progressTotal = downloadProgress?.totalBytes
                const progressPercent =
                  isDownloading && progressTotal && progressTotal > 0
                    ? (downloadProgress.receivedBytes / progressTotal) * 100
                    : null
                const receivedLabel =
                  isDownloading && downloadProgress
                    ? formatFileSizeMb(downloadProgress.receivedBytes)
                    : undefined
                return (
                  <li
                    key={entry.externalId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-lib-border-soft bg-lib-bg-deep/40 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[13px] font-medium text-lib-text-strong">
                        {entry.title}
                      </p>
                      <p className="m-0 truncate text-[11px] text-lib-faint">
                        {[entry.formatHint?.toUpperCase(), size].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {downloadedBookId ? (
                      <button
                        type="button"
                        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none bg-lib-accent-soft px-2.5 text-[11px] font-semibold text-lib-accent"
                        onClick={() => onOpenBook(downloadedBookId)}
                      >
                        <CheckIcon className="size-3.5" />
                        Read
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-lib-border bg-transparent px-2.5 text-[11px] font-semibold text-lib-muted transition-colors hover:bg-white/5 hover:text-lib-text-strong disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isDownloading || downloadingId !== null}
                          onClick={() => onDownload(entry)}
                        >
                          {isDownloading ? (
                            <>
                              <DownloadRing percent={progressPercent} />
                              {receivedLabel ? `Downloading... (${receivedLabel})` : 'Downloading...'}
                            </>
                          ) : (
                            <>
                              <CloudIcon className="size-3.5" />
                              Download
                            </>
                          )}
                        </button>
                        {isDownloading ? (
                          <button
                            type="button"
                            className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md border-none bg-transparent px-2 text-[11px] font-semibold text-lib-faint transition-colors hover:bg-white/5 hover:text-lib-text-strong"
                            aria-label={`Cancel downloading ${entry.title}`}
                            onClick={() => onCancelDownload(entry)}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    )}
                  </li>
                )
              })}
              </ul>
            </div>
          ) : null}

          {isLinked && visibleEntries.length === 0 ? (
            <p className="m-0 mt-3 text-[12px] text-lib-faint">
              {entries.length === 0
                ? 'No files synced yet — press “Sync now” to fetch this folder’s metadata.'
                : 'No files match the current search and format filters.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
