import { useState } from 'react'

const COVER_GRADS = [
  'linear-gradient(135deg, #1e3a8a, #3b82f6)',
  'linear-gradient(135deg, #064e3b, #10b981)',
  'linear-gradient(135deg, #7c2d12, #f97316)',
  'linear-gradient(135deg, #581c87, #8b5cf6)',
  'linear-gradient(135deg, #831843, #ec4899)',
] as const

export function coverGradForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % 5
  return COVER_GRADS[hash % 5]
}

export type BookCoverProps = {
  bookId: string
  title: string
  /** Renderer-safe cover URL; omit → gradient placeholder. */
  coverUrl?: string
  format?: string
  isFavorite?: boolean
  className?: string
  /** Title overlay when there is no usable cover image. */
  titleClassName?: string
  /** Favorite / format badge size variant. */
  compact?: boolean
}

/**
 * Cover face for Library cards — real image when `coverUrl` loads, else hashed gradient.
 */
export function BookCover({
  bookId,
  title,
  coverUrl,
  format,
  isFavorite,
  className = '',
  titleClassName = 'line-clamp-4 text-[11px] leading-snug font-semibold text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]',
  compact = false,
}: BookCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(coverUrl) && failedUrl !== coverUrl
  const formatBadge = format?.trim().toUpperCase()
  const badgePad = compact ? 'top-1 right-1' : 'top-1.5 right-1.5'
  const favPad = compact ? 'top-1 left-1' : 'top-1.5 left-1.5'
  const titlePad = compact ? 'p-1.5' : 'p-2.5'

  return (
    <div
      className={`relative overflow-hidden border border-lib-border bg-[#0f172a] ${className}`}
      style={showImage ? undefined : { background: coverGradForId(bookId) }}
      aria-hidden
    >
      {showImage && coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          draggable={false}
          onError={() => setFailedUrl(coverUrl)}
        />
      ) : null}

      {formatBadge ? (
        <span
          className={`absolute ${badgePad} z-[1] rounded px-1 py-px text-[8px] font-bold tracking-wide text-white/90 bg-black/45`}
        >
          {formatBadge}
        </span>
      ) : null}

      {isFavorite ? (
        <span
          className={`absolute ${favPad} z-[1] text-[11px] text-lib-accent [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]`}
        >
          ★
        </span>
      ) : null}

      {!showImage ? (
        <div className={`relative flex h-full items-end ${titlePad}`}>
          <span className={titleClassName}>{title}</span>
        </div>
      ) : null}
    </div>
  )
}
