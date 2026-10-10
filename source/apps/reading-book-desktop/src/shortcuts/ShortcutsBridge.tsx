import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { flushRegisteredSession } from '../screens/Reader/logic'
import { SHORTCUTS, type ShortcutContext, type ShortcutId } from './shortcutDefinitions'
import { queueShortcutAction, runShortcutAction } from './shortcutActions'
import { shortcutComboIds } from './shortcutConflicts'
import { isInteractiveTarget, isTypingTarget, listenKeydownInIframes } from './iframeKeydown'
import { isPlainShortcut, shortcutKeysFromEvent, shortcutKeysId } from './shortcutKeys'
import { effectiveShortcutKeys, useShortcutsStore } from './shortcutsStore'

function contextOf(pathname: string): ShortcutContext | null {
  if (pathname.startsWith('/library')) return 'library'
  if (pathname.startsWith('/reader')) return 'reader'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

/** A modal dialog is open — plain keys belong to it, not to the reader behind it. */
function hasOpenModal(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/**
 * App-level keyboard shortcuts: one capture-phase `keydown` listener (on the window, and on the EPUB
 * iframes while in the Reader) that fires the action whose effective keys *or fixed aliases* match
 * and whose contexts include the current screen. Navigation actions are done here; screen actions
 * run the handler the mounted screen registered with `useShortcutAction` — a handler that declines
 * (returns false) leaves the key press alone.
 *
 * Guards: keys without Ctrl/Alt are ignored while typing in a field, over a modal dialog or during
 * IME composition; Enter / Space are left to a focused button or link; auto-repeat only repeats
 * actions flagged `allowRepeat`.
 */
export function ShortcutsBridge() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    const context = contextOf(pathname)
    if (!context) return

    function leaveReaderThen(run: () => void) {
      void (async () => {
        if (context === 'reader') await flushRegisteredSession()
        run()
      })()
    }

    function perform(id: ShortcutId): boolean {
      switch (id) {
        case 'general.openSettings':
          leaveReaderThen(() => navigate('/settings'))
          return true
        case 'general.backToLibrary':
          leaveReaderThen(() => navigate('/library'))
          return true
        case 'general.openBook':
          if (runShortcutAction(id)) return true
          queueShortcutAction(id)
          leaveReaderThen(() => navigate('/library'))
          return true
        default:
          return runShortcutAction(id)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return
      const state = useShortcutsStore.getState()
      if (state.recordingId) return
      const pressed = shortcutKeysFromEvent(event)
      if (!pressed) return
      if (isPlainShortcut(pressed)) {
        if (isTypingTarget(event.target) || hasOpenModal()) return
        const main = pressed[pressed.length - 1]
        if ((main === 'Enter' || main === 'Space') && isInteractiveTarget(event.target)) return
      }
      const combo = shortcutKeysId(pressed)
      const keys = effectiveShortcutKeys(state.overrides)
      const matches = SHORTCUTS.filter(
        (s) =>
          !s.displayOnly &&
          s.contexts.includes(context!) &&
          (!event.repeat || s.allowRepeat) &&
          shortcutComboIds(s, keys).includes(combo),
      )
      for (const match of matches) {
        if (!perform(match.id)) continue
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    // The EPUB iframes only exist in the Reader; elsewhere the window is the only source of keys.
    if (context === 'reader') return listenKeydownInIframes(onKeyDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [navigate, pathname])

  return null
}
