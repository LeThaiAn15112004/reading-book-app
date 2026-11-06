import { create } from 'zustand'

/**
 * Library search history: the last few queries typed in the Library search box. User-generated
 * history (Settings → Privacy), distinct from the FTS5 search index (Settings → Storage → Cache).
 */

const STORAGE_KEY = 'reading-book.library.search-history.v1'
/** Most recent entries kept. */
export const SEARCH_HISTORY_LIMIT = 8
/** Shorter queries are not worth remembering. */
const MIN_QUERY_LENGTH = 2

type Persisted = { enabled: boolean; entries: string[] }

function load(): Persisted {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Persisted> | null
    return {
      enabled: parsed?.enabled !== false,
      entries: Array.isArray(parsed?.entries)
        ? parsed.entries
            .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
            .slice(0, SEARCH_HISTORY_LIMIT)
        : [],
    }
  } catch {
    return { enabled: true, entries: [] }
  }
}

function save(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / private mode — history just won't persist
  }
}

type SearchHistoryState = Persisted & {
  /** Record a finished search (no-op while disabled or for very short queries). */
  record: (query: string) => void
  remove: (query: string) => void
  /** Delete every saved query (Privacy → Clear Data). Does not change `enabled`. */
  clear: () => void
  /** Turning recording off keeps existing entries. */
  setEnabled: (enabled: boolean) => void
}

export const useSearchHistoryStore = create<SearchHistoryState>()((set, get) => {
  const commit = (patch: Partial<Persisted>) => {
    set(patch)
    const { enabled, entries } = get()
    save({ enabled, entries })
  }

  return {
    ...load(),
    record: (query) => {
      const q = query.trim().replace(/\s+/g, ' ')
      if (!get().enabled || q.length < MIN_QUERY_LENGTH) return
      const key = q.toLocaleLowerCase()
      const rest = get().entries.filter((e) => e.toLocaleLowerCase() !== key)
      commit({ entries: [q, ...rest].slice(0, SEARCH_HISTORY_LIMIT) })
    },
    remove: (query) => commit({ entries: get().entries.filter((e) => e !== query) }),
    clear: () => commit({ entries: [] }),
    setEnabled: (enabled) => commit({ enabled }),
  }
})
