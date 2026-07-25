/** Collection list row for Library hub (FR-14) — membership ids included for UI. */
export type CollectionSummary = {
  id: string
  name: string
  description?: string
  /** Book ids in this collection (`COLLECTION_BOOK`), display order. */
  bookIds: string[]
  createdAt: string
  updatedAt: string
}
