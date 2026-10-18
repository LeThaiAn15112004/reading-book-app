/**
 * Text edits over the canonical TXT string (see `txt-text.ts` for the offset contract).
 *
 * An edit is ONE contiguous replacement: remove `deleteLength` code units at `start`, put `insert`
 * there. Every user action in a text box (typing, Backspace, paste, cut, IME commit, drag-drop,
 * undo) is exactly that, so the annotation rules in `txt-annotations.ts` only ever have to reason
 * about one region.
 */

export interface TextEdit {
  start: number
  deleteLength: number
  insert: string
}

/** Where the caret / selection was just BEFORE the input event (from `beforeinput`). */
export interface EditHint {
  selectionStart: number
  selectionEnd: number
  /** `InputEvent.inputType`, e.g. `insertText`, `deleteContentBackward`. */
  inputType?: string
}

export function isNoopEdit(edit: TextEdit): boolean {
  return edit.deleteLength === 0 && edit.insert.length === 0
}

/** `edit.insert.length - edit.deleteLength` — how far everything after the edit moves. */
export function textEditDelta(edit: TextEdit): number {
  return edit.insert.length - edit.deleteLength
}

/** True when the edit's region lies inside a text of `length` code units. */
export function isEditInRange(length: number, edit: TextEdit): boolean {
  return (
    Number.isInteger(edit.start) &&
    Number.isInteger(edit.deleteLength) &&
    edit.start >= 0 &&
    edit.deleteLength >= 0 &&
    edit.start + edit.deleteLength <= length
  )
}

export function applyTextEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.start) + edit.insert + text.slice(edit.start + edit.deleteLength)
}

/** The edit that undoes `edit` when applied to the text AFTER it; `before` is the text BEFORE it. */
export function invertTextEdit(before: string, edit: TextEdit): TextEdit {
  return {
    start: edit.start,
    deleteLength: edit.insert.length,
    insert: before.slice(edit.start, edit.start + edit.deleteLength),
  }
}

/**
 * Where a position in the old text ends up after `edit`. A position inside the removed region
 * collapses to the start of the edit (it can't point into text that no longer exists).
 */
export function shiftOffsetForEdit(offset: number, edit: TextEdit): number {
  if (offset <= edit.start) return offset
  if (offset >= edit.start + edit.deleteLength) return offset + textEditDelta(edit)
  return edit.start
}

/** Region `[start, end)` of `before` replaced to turn it into `after`, when that is consistent. */
function editForRegion(before: string, after: string, start: number, end: number): TextEdit | null {
  if (start < 0 || end < start || end > before.length) return null
  const insertLength = after.length - (before.length - (end - start))
  if (insertLength < 0) return null
  if (start === end && insertLength === 0) return null
  if (!after.startsWith(before.slice(0, start))) return null
  if (!after.endsWith(before.slice(end))) return null
  return { start, deleteLength: end - start, insert: after.slice(start, start + insertLength) }
}

/** What the input event itself says was replaced: the selection, or the char(s) next to the caret. */
function editFromHint(before: string, after: string, hint: EditHint): TextEdit | null {
  const { selectionStart: from, selectionEnd: to } = hint
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > before.length) {
    return null
  }
  if (to > from) return editForRegion(before, after, from, to)

  const grow = after.length - before.length
  if (grow >= 0) return editForRegion(before, after, from, from)

  const removed = -grow
  const forward = hint.inputType?.includes('Forward') ?? false
  const back = (): TextEdit | null => editForRegion(before, after, from - removed, from)
  const ahead = (): TextEdit | null => editForRegion(before, after, from, from + removed)
  return forward ? (ahead() ?? back()) : (back() ?? ahead())
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** No hint to go by: smallest region, nudged to the position closest to the caret when ambiguous. */
function editFromDiff(before: string, after: string, hint: EditHint | undefined): TextEdit {
  const lenB = before.length
  const lenA = after.length
  const minLen = Math.min(lenB, lenA)
  let prefix = 0
  while (prefix < minLen && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (suffix < minLen && before.charCodeAt(lenB - 1 - suffix) === after.charCodeAt(lenA - 1 - suffix)) {
    suffix++
  }
  const caret = hint?.selectionStart

  // Pure insertion: any start in [lenB - suffix, prefix] gives the same result text ("aa" + "a").
  // No caret to go by → the rightmost one (the common prefix-first diff).
  if (lenA > lenB && prefix + suffix >= lenB) {
    const high = Math.min(prefix, lenB)
    const start = caret === undefined ? high : clamp(caret, lenB - suffix, high)
    return { start, deleteLength: 0, insert: after.slice(start, start + (lenA - lenB)) }
  }
  // Pure deletion: same freedom; a Backspace removes the text that ENDS at the caret.
  if (lenA < lenB && prefix + suffix >= lenA) {
    const removed = lenB - lenA
    const high = Math.min(prefix, lenA)
    let start = high
    if (caret !== undefined) {
      const backward = !(hint?.inputType?.includes('Forward') ?? false)
      start = clamp(backward ? caret - removed : caret, lenA - suffix, high)
    }
    return { start, deleteLength: removed, insert: '' }
  }
  // Replacement: the common head and tail are kept.
  const keepTail = Math.min(suffix, minLen - prefix)
  return {
    start: prefix,
    deleteLength: lenB - prefix - keepTail,
    insert: after.slice(prefix, lenA - keepTail),
  }
}

/**
 * The single edit that turns `before` into `after`, or null when they are equal.
 *
 * With a `hint` (the selection captured in `beforeinput`) the region is the one the input event
 * really replaced — so typing a letter that happens to equal its neighbours still lands at the
 * caret, which decides whether an annotation edge is touched. Without one (or when the text doesn't
 * fit the hint) the smallest differing region is used.
 */
export function deriveTextEdit(before: string, after: string, hint?: EditHint): TextEdit | null {
  if (before === after) return null
  if (hint) {
    const fromHint = editFromHint(before, after, hint)
    if (fromHint) return fromHint
  }
  return editFromDiff(before, after, hint)
}
