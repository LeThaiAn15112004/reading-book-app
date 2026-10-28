import type { TranscriptionExportOptionsDto, TranscriptionExportResult } from '../ipc/api-types'
import type { TranscriptExportBuild } from './transcription-service'

/**
 * "Export transcript…" end to end (spec 004, FR-011) with every outside effect injected: the transcript text, the Main-owned save
 * dialog, the target check and the file write. Electron-free, so the Main spike drives it with fakes; `transcription.ipc.ts`
 * wires the real `dialog` and `fs`.
 *
 * The renderer only ever learns `saved` (and a reason when it failed) — never the path the person chose.
 */
export interface TranscriptExportFileDeps {
  /** `transcription-service.buildExport`. */
  build: (bookId: string, options: TranscriptionExportOptionsDto) => Promise<TranscriptExportBuild>
  /** The suggested file name (not a path) for this book. */
  suggestedName: (bookId: string) => Promise<string>
  /** The save dialog; resolves the chosen path, or `null` when the person cancelled. */
  pickFile: (suggestedName: string) => Promise<string | null>
  /** True for a place an export must never go (the app's own data folder). */
  isForbiddenTarget: (target: string) => boolean
  /** Write the text as UTF-8. */
  writeFile: (filePath: string, text: string) => Promise<void>
}

export async function exportTranscriptToFile(
  deps: TranscriptExportFileDeps,
  bookId: unknown,
  options: unknown,
): Promise<TranscriptionExportResult> {
  if (typeof bookId !== 'string' || !bookId.trim()) return { saved: false, errorCode: 'INVALID_ARGUMENT', errorMessage: 'Missing bookId' }
  const id = bookId.trim()
  const exportOptions: TranscriptionExportOptionsDto = {
    timestamps: !!options && typeof options === 'object' && (options as { timestamps?: unknown }).timestamps === true,
  }

  // Build first: there is nothing to ask the person for when there is nothing to export.
  const built = await deps.build(id, exportOptions)
  if (!built.ok) return { saved: false, errorCode: built.errorCode, errorMessage: built.errorMessage }

  let picked: string | null
  try {
    picked = await deps.pickFile(await deps.suggestedName(id))
  } catch (error) {
    return { saved: false, errorMessage: `The save dialog could not be opened: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!picked) return { saved: false } // cancelled: nothing happened, nothing to report

  const target = /\.[^\\/.]+$/.test(picked) ? picked : `${picked}.txt`
  if (deps.isForbiddenTarget(target)) {
    return { saved: false, errorCode: 'INVALID_ARGUMENT', errorMessage: "Choose a place outside the app's own data folder." }
  }
  try {
    await deps.writeFile(target, built.text)
  } catch (error) {
    return { saved: false, errorMessage: `The file could not be saved: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { saved: true }
}
