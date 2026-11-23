import { useListeningPrefsStore } from './listeningPrefsStore'

/**
 * Spec 018 (FR-028): the skip-back / skip-forward lengths every surface uses (buttons, shortcuts, mini bar, floating
 * window, system media controls) — the listener's choice, one place, so no surface can disagree.
 */
export function currentSkipLengths(): { back: number; forward: number } {
  const { skipBackSeconds, skipForwardSeconds } = useListeningPrefsStore.getState()
  return { back: skipBackSeconds, forward: skipForwardSeconds }
}
