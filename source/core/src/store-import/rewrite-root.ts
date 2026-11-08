// Spec 010 (contracts/store-import.md "Steps" 3, data-model §6) — re-point stored absolute paths from the installer
// build's userData root to the Store build's root. Windows path rules: case-insensitive, `/` and `\` equal, whole
// path segments only (`…\reading-book-desktop2\x` is NOT inside `…\reading-book-desktop`). Paths outside the root
// (the user's own, referenced book files) are never changed: they answer `null`.

const SEPARATORS = /[\\/]+/g

function split(p: string): string[] {
  return p.replace(SEPARATORS, '\\').replace(/\\+$/, '').split('\\')
}

/** True when `value` is `root` itself or a path inside it (Windows rules). */
export function isInsideRoot(value: string | null | undefined, root: string): boolean {
  if (typeof value !== 'string' || value.trim() === '' || root.trim() === '') return false
  const v = split(value.trim())
  const r = split(root.trim())
  if (v.length < r.length) return false
  return r.every((seg, i) => seg.toLowerCase() === v[i]?.toLowerCase())
}

/**
 * `value` re-rooted from `fromRoot` to `toRoot`, or `null` when `value` is empty or not inside `fromRoot`.
 * The part after the root keeps its own spelling; the separator style of `value` is kept (all `/` stays `/`).
 */
export function rewriteRoot(value: string | null | undefined, fromRoot: string, toRoot: string): string | null {
  if (!isInsideRoot(value, fromRoot)) return null
  const v = (value as string).trim()
  const forwardOnly = v.includes('/') && !v.includes('\\')
  const sep = forwardOnly ? '/' : '\\'
  const rest = split(v).slice(split(fromRoot.trim()).length)
  const base = split(toRoot.trim())
  return [...base, ...rest].join(sep)
}
