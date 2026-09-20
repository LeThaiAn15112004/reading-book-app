import type { ReactNode } from 'react'
import type { ShelfId } from '@reading-book/book-reader-sdk'

export type { ShelfId }

function DragHandleIcon({ className }: { className?: string }) {
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
        d="M3.75 9h16.5m-16.5 6h16.5"
      />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
      />
    </svg>
  )
}

export type ShelfSectionProps = {
  id: ShelfId | 'favorites'
  title: string
  /** Defaults to 0 — empty data OK for T1.5. */
  fileCount?: number
  /** Horizontal rail cards; omit → empty-section copy. */
  children?: ReactNode
  onOpen?: (id: ShelfId | 'favorites') => void
  viewMode?: 'grid' | 'list'
  /** Enables drag-to-reorder via the section's drag handle. */
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onSectionDragStart?: () => void
  onSectionDragOver?: () => void
  onSectionDrop?: () => void
  onSectionDragEnd?: () => void
}

/** One SCR-01 shelf: header (= · title · N files · ›) + horizontal rail (empty OK). */
export function ShelfSection({
  id,
  title,
  fileCount = 0,
  children,
  onOpen,
  viewMode = 'grid',
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
}: ShelfSectionProps) {
  const titleId = `shelf-${id}`
  const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`
  const hasRailContent = children != null

  return (
    <section
      className={`mb-8 rounded-lg transition-[opacity,outline-color] ${isDragging ? 'opacity-50' : ''} ${
        isDragOver ? 'outline outline-2 outline-offset-4 outline-lib-accent' : ''
      }`}
      data-shelf={id}
      aria-labelledby={titleId}
      onDragOver={(event) => {
        if (!draggable) return
        event.preventDefault()
        onSectionDragOver?.()
      }}
      onDrop={(event) => {
        if (!draggable) return
        event.preventDefault()
        onSectionDrop?.()
      }}
    >
      <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
        <div className="flex min-h-10 min-w-0 items-center gap-2">
          <button
            type="button"
            draggable={draggable}
            onDragStart={(event) => {
              if (!draggable) return
              event.dataTransfer.effectAllowed = 'move'
              onSectionDragStart?.()
            }}
            onDragEnd={() => {
              if (!draggable) return
              onSectionDragEnd?.()
            }}
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-[color,background-color,transform] select-none hover:bg-white/5 hover:text-lib-accent focus-visible:bg-white/5 focus-visible:text-lib-accent focus-visible:outline-none active:scale-110 active:text-lib-accent ${
              draggable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default'
            }`}
            aria-label={`Drag to reorder ${title} section`}
            title="Drag to reorder"
          >
            <DragHandleIcon className="size-5" />
          </button>
          <h2
            id={titleId}
            className="m-0 text-lg leading-none font-semibold tracking-tight text-lib-text-strong"
          >
            {title}
          </h2>
        </div>

        <div className="flex min-h-10 shrink-0 items-center gap-3">
          <span className="text-[13px] leading-none font-medium text-lib-faint">
            {fileLabel}
          </span>
          <button
            type="button"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-[color,background-color,transform] hover:translate-x-0.5 hover:bg-white/5 hover:text-lib-accent focus-visible:bg-white/5 focus-visible:text-lib-accent focus-visible:outline-none"
            aria-label={`View ${title} list`}
            title="View list"
            onClick={() => onOpen?.(id)}
          >
            <ChevronIcon className="size-5" />
          </button>
        </div>
      </div>

      {hasRailContent ? (
        viewMode === 'list' ? (
          <ul
            className="flex w-full list-none flex-col gap-2.5 p-0 m-0"
            role="list"
          >
            {children}
          </ul>
        ) : (
          <div
            className="flex gap-[18px] overflow-x-auto overflow-y-hidden pb-1"
            role="list"
          >
            {children}
          </div>
        )
      ) : (
        <p className="m-0 text-[13px] text-lib-faint">No files in this section.</p>
      )}
    </section>
  )
}
