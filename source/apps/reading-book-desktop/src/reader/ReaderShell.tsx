import type { CSSProperties, ReactNode } from 'react'

export type ReaderShellProps = {
  themeClassName: string
  style?: CSSProperties
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
      {edges}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}

        {topbar}

        {footer}
      </div>

      {overlays}
    </div>
  )
}
