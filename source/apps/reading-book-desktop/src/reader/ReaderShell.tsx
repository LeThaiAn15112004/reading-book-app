import type { CSSProperties, ReactNode } from 'react'
import { ChromeRevealButton } from '../screens/Reader/components/ChromeRevealButton'

export type ReaderShellProps = {
  themeClassName: string
  style?: CSSProperties
  chromeHidden: boolean
  onToggleChrome: () => void
  topbar: ReactNode
  footer: ReactNode
  edges?: ReactNode
  /** Absolute/fixed session UI (sidebar, dialogs, toast) — after chrome in DOM. */
  overlays?: ReactNode
  children: ReactNode
  /** Optional debug / content-status attrs on the root. */
  dataAttrs?: Record<string, string>
}

/**
 * Shared SCR-03 frame: content slot + Invisible UI chrome (hidden by default).
 * Chrome visibility is controlled by the parent so session UX can force-show.
 */
export function ReaderShell({
  themeClassName,
  style,
  chromeHidden,
  onToggleChrome,
  topbar,
  footer,
  edges,
  overlays,
  children,
  dataAttrs,
}: ReaderShellProps) {
  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] antialiased select-none ${themeClassName}`}
      style={style}
      {...dataAttrs}
    >
      <ChromeRevealButton
        expanded={!chromeHidden}
        onToggle={onToggleChrome}
      />

      {edges}

      {topbar}

      {children}

      {footer}

      {overlays}
    </div>
  )
}
