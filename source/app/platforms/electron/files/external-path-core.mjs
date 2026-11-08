// Spec 010 T026 (contracts/packaged-runtime.md "Paths given to other apps", research R7) — pure, no Electron, so a
// `node --test` can load it (source/scripts/store/external-path.test.mjs). `external-path.ts` feeds it the real values.
//
// A file the Store (MSIX) build creates under its userData is virtualised: other processes (Explorer, the default PDF
// viewer …) only see it at its real location under %LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\<folder>\…
// So every app-owned path handed to another program is mapped first.

const SEP = /[\\/]+/

function segments(p) {
  return String(p).replace(/[\\/]+$/, '').split(SEP)
}

/**
 * Package family name `<Name>_<PublisherId>` from the packaged exe path
 * `…\WindowsApps\<Name>_<Version>_<Arch>__<PublisherId>\app\<exe>`, or null when the path is not inside WindowsApps or
 * the folder name does not have that shape.
 */
export function packageFamilyNameFromExecPath(execPath) {
  if (typeof execPath !== 'string' || execPath === '') return null
  const parts = segments(execPath)
  const i = parts.findIndex((s) => s.toLowerCase() === 'windowsapps')
  if (i < 0 || i + 1 >= parts.length) return null
  const m = /^([^_]+)_[^_]+_[^_]*_[^_]*_([a-z0-9]+)$/i.exec(parts[i + 1])
  return m ? `${m[1]}_${m[2]}` : null
}

/**
 * `p` as other programs can open it. Inside `userData` (Windows rules: case-insensitive, `/` = `\`, whole segments
 * only) and with a known package family name → the real per-package path; otherwise `p` unchanged.
 */
export function mapForOtherApps(p, { userData, localAppData, pfn }) {
  if (typeof p !== 'string' || p === '' || !pfn || !userData || !localAppData) return p
  const parts = segments(p)
  const root = segments(userData)
  if (parts.length < root.length) return p
  if (!root.every((seg, i) => seg.toLowerCase() === parts[i].toLowerCase())) return p
  const folder = root[root.length - 1]
  const rest = parts.slice(root.length)
  const base = segments(localAppData)
  return [...base, 'Packages', pfn, 'LocalCache', 'Roaming', folder, ...rest].join('\\')
}
