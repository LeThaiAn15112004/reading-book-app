import { useShortcutAction } from '../../../shortcuts'
import { useNoteMenuStore } from './audioNoteMenuStore'
import { selectCanAddNote, selectCanChangeChapter, useAudioPlayerStore } from './audioPlayerStore'
import { currentSkipLengths } from './skipLengths'

function ready(): boolean {
  return useAudioPlayerStore.getState().status === 'ready'
}

function canChangeChapter(direction: 1 | -1): boolean {
  return selectCanChangeChapter(useAudioPlayerStore.getState(), direction)
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
    store().skipBy(-currentSkipLengths().back)
    return true
  })
  useShortcutAction('audiobook.skipForward', () => {
    if (!ready()) return false
    store().skipBy(currentSkipLengths().forward)
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
