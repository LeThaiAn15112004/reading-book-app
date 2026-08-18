/** Hit-test typewriter textboxes by viewport coordinates (Hand mode click-to-edit). */

export function pointInClientRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

/**
 * Return a textbox id whose host element contains the click point.
 * When `noteIds` is given, later ids are tested first (top z-order).
 * Otherwise every registered element is tested (last match wins).
 */
export function hitTestTypewriterAtClientPoint(
  noteIds: readonly string[] | null,
  refs: ReadonlyMap<string, HTMLElement>,
  clientX: number,
  clientY: number,
): string | null {
  const ordered =
    noteIds && noteIds.length > 0 ? [...noteIds].reverse() : [...refs.keys()]
  for (const id of ordered) {
    const el = refs.get(id)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (pointInClientRect(clientX, clientY, rect)) return id
  }
  return null
}
