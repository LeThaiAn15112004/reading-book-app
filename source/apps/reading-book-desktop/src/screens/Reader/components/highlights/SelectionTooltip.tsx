import { useEffect, useMemo, useState } from 'react'

import {
  HIGHLIGHT_COLOR_HEX,
  normalizeHighlightColorHex,
  type HighlightHandleRect,
  type PendingSelection,
} from '@reading-book/shared/models'

export type SelectionMenuAnchor = {
  x: number
  y: number
}

/** Edit an existing highlight (color picker + note). */
export type HighlightEditTarget = {
  id: string
  colorHex: string
  selectedText: string
  /** True when the highlight already has a non-empty note. */
  hasNote?: boolean
  rect: HighlightHandleRect
  /** Viewport click point — prefer this for panel placement. */
  click?: { x: number; y: number }
}

type SelectionTooltipProps = {
  selection: PendingSelection | null
  anchor: SelectionMenuAnchor | null
  /** True when selection overlaps an existing in-memory highlight. */
  hasExistingHighlight: boolean
  /** Apply highlight with default / chosen color (right-click menu). */
  onHighlight: (colorHex: string) => void
  onNote: () => void
  onCopy: () => void
  onSearch: () => void
  onAskAi: () => void
  onShare: () => void
  onRemoveHighlight: () => void
  onDismiss: () => void
  /** When set, show compact color-edit panel instead of selection menu. */
  editTarget?: HighlightEditTarget | null
  onChangeHighlightColor?: (highlightId: string, colorHex: string) => void
  onEditNote?: (highlightId: string) => void
  onRemoveEditHighlight?: (highlightId: string) => void
  onDismissEdit?: () => void
}

type MenuItemProps = {
  icon: string
  label: string
  onClick: () => void
  destructive?: boolean
}

function MenuItem({ icon, label, onClick, destructive }: MenuItemProps) {
  return (
    <button
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-none px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
        destructive
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-lib-text-strong hover:bg-lib-bg-deep/40'
      }`}
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <span aria-hidden className="w-5 shrink-0 text-center text-sm">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}

function clampMenuPosition(
  anchor: SelectionMenuAnchor,
  menuWidth: number,
  menuHeight: number,
): { top: number; left: number } {
  const left = Math.min(
    window.innerWidth - menuWidth - 12,
    Math.max(12, anchor.x),
  )
  const top = Math.min(
    window.innerHeight - menuHeight - 12,
    Math.max(12, anchor.y),
  )
  return { top, left }
}

const EDIT_PANEL_WIDTH = 180
const EDIT_PANEL_HEIGHT = 56
const EDIT_PANEL_GAP = 10

/**
 * Place the compact color panel above the highlight when possible,
 * otherwise below — always adjacent to the selection, not the chrome.
 */
function editPanelAnchorFromTarget(
  editTarget: HighlightEditTarget,
): SelectionMenuAnchor {
  const { rect, click } = editTarget
  const start = rect.start
  const end = rect.end

  // Selection center (prefer first-line span when available).
  const centerX =
    rect.width > 0
      ? rect.left + rect.width / 2
      : start.left + (end.left - start.left) / 2

  const aboveY = start.top - EDIT_PANEL_HEIGHT - EDIT_PANEL_GAP
  const belowY = end.top + end.lineHeight + EDIT_PANEL_GAP
  const preferAbove = aboveY >= 12
  let x = centerX - EDIT_PANEL_WIDTH / 2
  let y = preferAbove ? aboveY : belowY

  // Nudge toward click only when the click lands on/near the highlight.
  if (click) {
    const pad = 48
    const near =
      click.x >= rect.left - pad &&
      click.x <= rect.left + Math.max(rect.width, 1) + pad &&
      click.y >= rect.top - pad &&
      click.y <= rect.top + Math.max(rect.height, 1) + pad
    if (near) {
      x = click.x - EDIT_PANEL_WIDTH / 2
      y = preferAbove
        ? Math.min(y, click.y - EDIT_PANEL_HEIGHT - EDIT_PANEL_GAP)
        : Math.max(y, click.y + EDIT_PANEL_GAP)
    }
  }

  return { x, y }
}

/**
 * Selection floating toolbar — opens on right-click over selected text (FR-06).
 * Also hosts the compact highlight color editor (Highlight tool mode).
 */
export function SelectionTooltip({
  selection,
  anchor,
  hasExistingHighlight,
  onHighlight,
  onNote,
  onCopy,
  onSearch,
  onAskAi,
  onShare,
  onRemoveHighlight,
  onDismiss,
  editTarget = null,
  onChangeHighlightColor,
  onEditNote,
  onRemoveEditHighlight,
  onDismissEdit,
}: SelectionTooltipProps) {
  const [pickerHex, setPickerHex] = useState(HIGHLIGHT_COLOR_HEX.yellow)

  const editAnchor = useMemo((): SelectionMenuAnchor | null => {
    if (!editTarget) return null
    return editPanelAnchorFromTarget(editTarget)
  }, [editTarget])

  useEffect(() => {
    if (!editTarget) return
    setPickerHex(
      normalizeHighlightColorHex(editTarget.colorHex) ??
        HIGHLIGHT_COLOR_HEX.yellow,
    )
  }, [editTarget])

  useEffect(() => {
    if (!editTarget) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismissEdit?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editTarget, onDismissEdit])

  // Compact color panel when tool-clicking an existing highlight.
  if (editTarget && editAnchor) {
    const { top, left } = clampMenuPosition(
      editAnchor,
      EDIT_PANEL_WIDTH,
      EDIT_PANEL_HEIGHT,
    )
    return (
      <>
        <div
          className="fixed inset-0 z-[199]"
          aria-hidden
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismissEdit?.()
          }}
        />
        <div
          className="fixed z-[200] flex items-center gap-1.5 rounded-xl border border-lib-border bg-lib-surface-strong px-2 py-1.5 shadow-xl backdrop-blur-md"
          style={{ top, left }}
          role="dialog"
          aria-label="Highlight color"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label
            className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-lib-border shadow-sm transition-transform hover:scale-105"
            title="Pick highlight color"
            aria-label="Pick highlight color"
            style={{ backgroundColor: pickerHex }}
          >
            {/* Conic ring hint that this opens a full color picker */}
            <span
              className="pointer-events-none absolute inset-0 rounded-full opacity-40"
              style={{
                background: `conic-gradient(
                  #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444
                )`,
              }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute inset-[5px] rounded-full border border-white/70"
              style={{ backgroundColor: pickerHex }}
              aria-hidden
            />
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              type="color"
              value={pickerHex}
              onInput={(e) => {
                const next =
                  normalizeHighlightColorHex(
                    (e.target as HTMLInputElement).value,
                  ) ?? pickerHex
                setPickerHex(next)
                onChangeHighlightColor?.(editTarget.id, next)
              }}
              onChange={(e) => {
                const next =
                  normalizeHighlightColorHex(
                    (e.target as HTMLInputElement).value,
                  ) ?? pickerHex
                setPickerHex(next)
                onChangeHighlightColor?.(editTarget.id, next)
              }}
            />
          </label>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-lib-border" aria-hidden />
          <button
            type="button"
            title={editTarget.hasNote ? 'Edit note' : 'Add note'}
            aria-label={editTarget.hasNote ? 'Edit note' : 'Add note'}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-sm text-lib-muted transition-colors hover:bg-lib-bg-deep/40 hover:text-lib-text-strong"
            onClick={(e) => {
              e.stopPropagation()
              onEditNote?.(editTarget.id)
            }}
          >
            📝
          </button>
          <button
            type="button"
            title="Remove highlight"
            aria-label="Remove highlight"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-sm text-red-400 transition-colors hover:bg-red-500/10"
            onClick={(e) => {
              e.stopPropagation()
              onRemoveEditHighlight?.(editTarget.id)
            }}
          >
            🗑️
          </button>
        </div>
      </>
    )
  }

  if (!selection || !anchor) return null

  const menuWidth = 240
  const { top, left } = clampMenuPosition(anchor, menuWidth, 320)

  return (
    <>
      <div
        className="fixed inset-0 z-[199]"
        aria-hidden
        onMouseDown={(e) => {
          // preventDefault keeps the text selection until we explicitly dismiss.
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      />

      <div
        className="fixed z-[200] w-[min(240px,calc(100vw-24px))] rounded-xl border border-lib-border bg-lib-surface-strong py-1.5 shadow-xl backdrop-blur-md"
        style={{ top, left }}
        onMouseDown={(e) => {
          // Keep selection stable while interacting with the toolbar.
          e.preventDefault()
          e.stopPropagation()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        role="menu"
        aria-label="Selection actions"
      >
        <div className="px-1.5">
          <MenuItem
            icon="🖍"
            label="Highlight"
            onClick={() => onHighlight(HIGHLIGHT_COLOR_HEX.yellow)}
          />
          <MenuItem icon="📝" label="Note" onClick={onNote} />
          <MenuItem icon="📋" label="Copy" onClick={onCopy} />
        </div>

        <div className="mx-3 my-1 h-px bg-lib-border" />

        <div className="px-1.5">
          <MenuItem icon="🔍" label="Search / Lookup" onClick={onSearch} />
          <MenuItem icon="🤖" label="Ask AI / Explain" onClick={onAskAi} />
          <MenuItem
            icon="🔗"
            label="Share / Export Snippet"
            onClick={onShare}
          />
        </div>

        {hasExistingHighlight ? (
          <>
            <div className="mx-3 my-1 h-px bg-lib-border" />
            <div className="px-1.5">
              <MenuItem
                icon="🗑️"
                label="Remove Highlight"
                destructive
                onClick={onRemoveHighlight}
              />
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
