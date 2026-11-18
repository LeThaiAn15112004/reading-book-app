import { create } from 'zustand'

type AddBooksPickerState = {
  open: boolean
  collectionId: string | null
  query: string
  /** Ticked book ids, in tick order (they are added in this order, FR-010). */
  selected: string[]
  submitting: boolean
  /** The last confirm failed (nothing was added); shown above the confirm bar. */
  error: boolean
  openFor: (collectionId: string) => void
  close: () => void
  setQuery: (query: string) => void
  toggle: (bookId: string) => void
  setSubmitting: (submitting: boolean) => void
  setError: (error: boolean) => void
}

const CLOSED = { open: false, collectionId: null, query: '', selected: [], submitting: false, error: false } as const

/** "Add books" picker of a collection page (spec 015 US2, data-model.md: session-only, cleared on close). */
export const useAddBooksPickerStore = create<AddBooksPickerState>()((set, get) => ({
  ...CLOSED,
  selected: [],
  openFor: (collectionId) => set({ ...CLOSED, selected: [], open: true, collectionId }),
  close: () => set({ ...CLOSED, selected: [] }),
  setQuery: (query) => set({ query }),
  toggle: (bookId) => {
    const { selected } = get()
    set({
      selected: selected.includes(bookId) ? selected.filter((id) => id !== bookId) : [...selected, bookId],
      error: false,
    })
  },
  setSubmitting: (submitting) => set({ submitting }),
  setError: (error) => set({ error }),
}))
