import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { flushRegisteredSession } from '../screens/Reader/logic'
import { SHORTCUTS, type ShortcutContext, type ShortcutId } from './shortcutDefinitions'
import { queueShortcutAction, runShortcutAction } from './shortcutActions'
import { shortcutKeysFromEvent, shortcutKeysId } from './shortcutKeys'
import { effectiveShortcutKeys, useShortcutsStore } from './shortcutsStore'

function contextOf(pathname: string): ShortcutContext | null {
  if (pathname.startsWith('/library')) return 'library'
  if (pathname.startsWith('/reader')) return 'reader'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

/**
 * App-level keyboard shortcuts: one capture-phase `keydown` listener that fires the action whose
 * effective keys match and whose contexts include the current screen. Navigation actions are done
 * here; screen actions (Open Book, searches) run the handler the mounted screen registered with
 * `useShortcutAction`.
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
        case 'general.searchLibrary':
        case 'general.searchBook':
          return runShortcutAction(id)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      const state = useShortcutsStore.getState()
      if (state.recordingId) return
      const pressed = shortcutKeysFromEvent(event)
      if (!pressed) return
      const combo = shortcutKeysId(pressed)
      const keys = effectiveShortcutKeys(state.overrides)
      const match = SHORTCUTS.find(
        (s) => s.contexts.includes(context!) && shortcutKeysId(keys[s.id]) === combo,
      )
      if (match && perform(match.id)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [navigate, pathname])

  return null
}
