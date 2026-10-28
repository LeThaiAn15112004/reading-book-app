import { create } from 'zustand'
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
  switch (status.code) {
    case 'unsupported_characters':
      return `Remove or replace: ${(status.characters ?? []).join(' ')} — or choose another font. Your text is kept.`
    case 'font_unavailable':
      return 'Restart the app; your text is kept.'
    case 'does_not_fit':
      return 'Enlarge the box or reduce the size.'
    case 'file_not_writable':
      return 'The PDF cannot be written right now (read-only, encrypted, in use, signed or changed on disk). Your note is kept in Readmate.'
  }
}
