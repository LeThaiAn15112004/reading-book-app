import { useState } from 'react'
import type { CollectionSummary } from '../../models/collection-summary.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type UseCollectionsOptions = {
  /** Called after a collection is created in memory (persist via CollectionStore later). */
  onCreated?: (collection: CollectionSummary) => void
}

/**
 * In-memory collections hub stub (FR-14) until CollectionStore is wired.
 * Platform-agnostic — desktop/mobile share this; UI chrome stays in each app.
 */
export function useCollections(options: UseCollectionsOptions = {}) {
  const { onCreated } = options
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)

  function handleCreateCollection(input: {
    name: string
    description?: string
  }) {
    const now = new Date().toISOString()
    const created: CollectionSummary = {
      id: newId(),
      name: input.name,
      description: input.description,
      bookIds: [],
      createdAt: now,
      updatedAt: now,
    }
    setCollections((prev) => [created, ...prev])
    onCreated?.(created)
  }

  return {
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
  }
}
