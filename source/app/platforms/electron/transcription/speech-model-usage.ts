import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SpeechModelDto } from '../ipc/api-types'
import { TRANSCRIPTION_MODELS } from './transcription-models'

/**
 * How much disk the downloaded SPEECH models (audiobook transcription) take, for Settings → Storage. Electron-free: the models
 * folder is passed in, so the Main spike measures real temp folders.
 *
 * Only folders of the verified catalog count and are listed — a folder with another name (a leftover `.partial` download, a stray
 * file) is not a model and is never offered for removal; it stays in "Other".
 */

/** Recursive size in bytes; a missing or unreadable entry counts as 0, symbolic links are not followed. */
async function sizeOf(dir: string): Promise<number> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) return 0
      if (entry.isDirectory()) return sizeOf(full)
      try {
        return (await fsp.stat(full)).size
      } catch {
        return 0
      }
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

/** The speech models present under `modelsDir` (one folder per catalog id), largest information first: catalog order. */
export async function listSpeechModelUsage(
  modelsDir: string,
  catalog: ReadonlyArray<{ id: string; label: string }> = TRANSCRIPTION_MODELS,
): Promise<SpeechModelDto[]> {
  const found: SpeechModelDto[] = []
  for (const model of catalog) {
    const dir = path.join(modelsDir, model.id)
    try {
      if (!(await fsp.stat(dir)).isDirectory()) continue
    } catch {
      continue
    }
    found.push({ id: model.id, label: model.label, bytes: await sizeOf(dir) })
  }
  return found
}
