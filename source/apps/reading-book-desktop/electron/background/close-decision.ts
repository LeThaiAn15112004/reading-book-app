/**
 * What the main window's `close` event does — pure, so the close / hide / quit rules can be checked
 * without Electron (spikes/background). main.ts carries the decisions out.
 *
 * - `close`            let the window close now (session already flushed, or a flush is running)
 * - `flush-then-close` T4.2: cancel, ask the renderer to save the reading session, then close
 * - `flush-then-hide`  Run in Background: cancel, save the session, then hide (the app keeps running)
 */
export type CloseDecision = 'close' | 'flush-then-close' | 'flush-then-hide'

export function decideWindowClose(state: {
  /** A flush started by an earlier close is still running. */
  flushing: boolean
  /** The session was flushed for this window's real close already. */
  sessionFlushed: boolean
  /** `shouldHideOnClose()` — tray on, Run in Background on, not quitting. */
  hideOnClose: boolean
}): CloseDecision {
  if (state.flushing) return 'close'
  if (state.hideOnClose) return 'flush-then-hide'
  if (state.sessionFlushed) return 'close'
  return 'flush-then-close'
}

/**
 * After a `flush-then-hide` flush: hide — unless a quit started meanwhile (tray Quit, Cmd+Q, OS
 * shutdown), then close for real and re-enter `app.quit()` so the quit isn't swallowed.
 */
export function afterHideFlush(quitting: boolean): 'hide' | 'close-and-quit' {
  return quitting ? 'close-and-quit' : 'hide'
}
