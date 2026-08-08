import type { CSSProperties, ReactNode } from 'react'
import { readerChromeTopInset } from './readerChromeLayout'

export type ReaderShellProps = {
  themeClassName: string
  style?: CSSProperties
  topbar: ReactNode
  footer: ReactNode
  edges?: ReactNode
  /** Absolute/fixed session UI (sidebar, dialogs, toast) — after chrome in DOM. */
  overlays?: ReactNode
  children: ReactNode
  /** Left inset reserved for icon rail (+ sidebar panel when open). */
  contentInsetLeft?: number
  /** When false, reserve top space for the tools chrome bar. */
  chromeHidden?: boolean
  /** Disable padding transition while dragging the sidebar resize handle. */
  contentInsetResizing?: boolean
  /** Optional debug / content-status attrs on the root. */
  dataAttrs?: Record<string, string>
}

/**
 * Shared SCR-03 frame: content slot + Invisible UI chrome (hidden by default).
 * Mounted in App content tier (below titlebar + menubar). Left sidebar / edge
 * controls should use absolute coords against this relative box — not viewport
 * fixed — so they stay under the global menubar.
 */
export function ReaderShell({
  themeClassName,
  style,
  topbar,
  footer,
  edges,
  overlays,
  children,
  contentInsetLeft = 0,
  chromeHidden = true,
  contentInsetResizing = false,
  dataAttrs,
}: ReaderShellProps) {
  const chromeTopInset = readerChromeTopInset(chromeHidden)

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] antialiased select-none ${themeClassName}`}
      style={style}
      {...dataAttrs}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            contentInsetResizing
              ? ''
              : 'transition-[padding-left,padding-top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
          }`}
          style={{
            paddingLeft: contentInsetLeft,
            paddingTop: chromeTopInset,
          }}
        >
          {children}
        </div>

        {topbar}

        {footer}
      </div>

      {edges}
      {overlays}
    </div>
  )
}
