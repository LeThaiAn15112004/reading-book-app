/**
 * The audiobook ZIP the user chose in the ordinary "Add file" dialog. The renderer never receives its path: Main keeps it
 * here for the one follow-up call (`zipImport:inspectPicked`) that opens the preview, which takes it exactly once.
 * It expires, so an abandoned pick cannot be inspected later by an unrelated call.
 */
const TTL_MS = 2 * 60 * 1000

let held: { path: string; at: number } | null = null

export function holdPickedZip(zipPath: string, now = Date.now()): void {
  held = { path: zipPath, at: now }
}

/** The held path, once; `null` when nothing is held or it expired. */
export function takePickedZip(now = Date.now()): string | null {
  const current = held
  held = null
  return current && now - current.at <= TTL_MS ? current.path : null
}
