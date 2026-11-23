/**
 * Spec 018: the skip-back / skip-forward lengths every surface uses (buttons, shortcuts, mini bar, floating window,
 * system media controls). Fixed 15 s / 30 s until the listener can choose them (FR-028), then read from the listening
 * preferences — one place, so no surface can disagree.
 */
export function currentSkipLengths(): { back: number; forward: number } {
  return { back: 15, forward: 30 }
}
