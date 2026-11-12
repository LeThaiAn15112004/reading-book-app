import { create } from 'zustand'
import { getT } from '../../../../i18n'
/** Mirrors `TypewriterFileStatusDto` (electron/ipc/api-types.ts). */
export type TypewriterFileStatusDto = {
  id: string
  code: 'in_file' | 'file_not_writable' | 'unsupported_characters' | 'font_unavailable' | 'does_not_fit'
  characters?: string[]
}

type State = {
  /** Last known result of writing each Typewriter note into the PDF; a note not listed was never reported (no badge). */
  byId: Record<string, TypewriterFileStatusDto>
  apply: (list: readonly TypewriterFileStatusDto[] | undefined) => void
  forget: (id: string) => void
  reset: () => void
}

/**
 * Whether each Typewriter note is in the PDF file, reported by Main after every sync cycle that tried to write it.
 * Session-only: it is recomputed by the first sync after the book opens.
 */
export const useTypewriterFileStatusStore = create<State>()((set) => ({
  byId: {},
  apply: (list) => {
    if (!list || list.length === 0) return
    set((s) => ({ byId: { ...s.byId, ...Object.fromEntries(list.map((t) => [t.id, t])) } }))
  },
  forget: (id) => set((s) => (id in s.byId ? { byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)) } : s)),
  reset: () => set({ byId: {} }),
}))

/** The user-facing reason a note is "not in the file" (contracts §3); null when it is in the file or unreported. The note itself is never altered. */
export function typewriterNotInFileMessage(status: TypewriterFileStatusDto | undefined): string | null {
  if (!status || status.code === 'in_file') return null
  // Called while rendering, so the text follows the current interface language (spec 012).
  const t = getT()
  switch (status.code) {
    case 'unsupported_characters':
      return t('reader.pdf.typewriter.notInFile.unsupportedCharacters', { characters: (status.characters ?? []).join(' ') })
    case 'font_unavailable':
      return t('reader.pdf.typewriter.notInFile.fontUnavailable')
    case 'does_not_fit':
      return t('reader.pdf.typewriter.notInFile.doesNotFit')
    case 'file_not_writable':
      return t('reader.pdf.typewriter.notInFile.fileNotWritable')
  }
}
