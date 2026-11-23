import { useShortcutAction } from '../../../shortcuts'
import { useNoteMenuStore } from './audioNoteMenuStore'
import { selectCanAddNote, useAudioPlayerStore } from './audioPlayerStore'

/** Until the listener can choose them (spec 018 FR-028, T053), the player's fixed skip lengths. */
const SKIP_BACK_SECONDS = 15
const SKIP_FORWARD_SECONDS = 30

function ready(): boolean {
  return useAudioPlayerStore.getState().status === 'ready'
}

/** Same rule as the ⏮ / ⏭ buttons: chapters (single file) or tracks (multi-track). */
function canChangeChapter(direction: 1 | -1): boolean {
  const s = useAudioPlayerStore.getState()
  const multiTrack = s.tracks.length > 0
  if (!multiTrack && s.chapterStatus !== 'ok') return false
  if (direction > 0 && multiTrack && s.trackIndex >= s.tracks.length - 1) return false
  return true
}

/**
 * Spec 018 US2 (contracts/player-shortcuts.md): the player's keyboard shortcuts, registered while the player screen is
 * mounted. Each handler runs the same store action as its button and declines (returns `false`) exactly when that
 * button would be disabled, so the key press is left alone. Reads the store at press time; owns no state.
 */
export function useAudioPlayerShortcuts(): void {
  const store = useAudioPlayerStore.getState

  useShortcutAction('audiobook.playPause', () => {
    if (!ready()) return false
    store().toggle()
    return true
  })
  useShortcutAction('audiobook.skipBack', () => {
    if (!ready()) return false
    store().skipBy(-SKIP_BACK_SECONDS)
    return true
  })
  useShortcutAction('audiobook.skipForward', () => {
    if (!ready()) return false
    store().skipBy(SKIP_FORWARD_SECONDS)
    return true
  })
  useShortcutAction('audiobook.previousChapter', () => {
    if (!ready() || !canChangeChapter(-1)) return false
    store().previousChapter()
    return true
  })
  useShortcutAction('audiobook.nextChapter', () => {
    if (!ready() || !canChangeChapter(1)) return false
    store().nextChapter()
    return true
  })
  useShortcutAction('audiobook.volumeUp', () => {
    store().volumeStep(1)
    return true
  })
  useShortcutAction('audiobook.volumeDown', () => {
    store().volumeStep(-1)
    return true
  })
  useShortcutAction('audiobook.mute', () => {
    store().toggleMute()
    return true
  })
  useShortcutAction('audiobook.speedDown', () => {
    if (!ready()) return false
    store().speedStep(-1)
    return true
  })
  useShortcutAction('audiobook.speedUp', () => {
    if (!ready()) return false
    store().speedStep(1)
    return true
  })
  useShortcutAction('audiobook.addNote', () => {
    if (!selectCanAddNote(store())) return false
    const id = store().addNote()
    if (!id) return false
    // Opens the Note's menu on the "Add note" button, like a click on it.
    const anchor = document.querySelector('[data-audio-add-note]')
    if (anchor) useNoteMenuStore.getState().openFor(id, anchor, 'edit')
    return true
  })
}
