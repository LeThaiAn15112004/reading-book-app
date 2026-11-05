/** POSIX-style path helpers for ZIP entry names (no `node:path`, which RN / browsers lack). */

export function normalizeZipPath(path: string): string {
  const out: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

export function zipDirname(path: string): string {
  const normalized = normalizeZipPath(path)
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : ''
}

/** Resolve a manifest `href` (URL-encoded, maybe with `#fragment`) against the OPF directory. */
export function resolveZipHref(baseDir: string, href: string): string {
  const withoutFragment = href.split('#')[0] ?? ''
  let decoded = withoutFragment
  try {
    decoded = decodeURIComponent(withoutFragment)
  } catch {
    /* keep raw href */
  }
  return normalizeZipPath(baseDir ? `${baseDir}/${decoded}` : decoded)
}
