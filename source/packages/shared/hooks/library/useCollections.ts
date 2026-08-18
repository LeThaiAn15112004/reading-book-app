import { useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '../../models/collection-summary.js'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type UseCollectionsOptions = {
  client?: {
    listCollections: () => Promise<CollectionSummary[]>
    createCollection: (input: {
      name: string
      description?: string
    }) => Promise<CollectionSummary>
    updateCollection: (
      id: string,
      input: { name: string; description?: string },
    ) => Promise<CollectionSummary | null>
    deleteCollection: (id: string) => Promise<{ ok: boolean }>
    addBookToCollection: (
      collectionId: string,
      bookId: string,
    ) => Promise<{ ok: boolean }>
    removeBookFromCollection: (
      collectionId: string,
      bookId: string,
    ) => Promise<{ ok: boolean }>
  }
  onCreated?: (collection: CollectionSummary) => void
}

/** Platform-agnostic collections state with an optional persistent client. */
export function useCollections(options: UseCollectionsOptions = {}) {
  const { client, onCreated } = options
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const clientRef = useRef(client)
  clientRef.current = client

  async function refreshCollections() {
    if (!clientRef.current) return
    const items = await clientRef.current.listCollections()
    setCollections(items)
  }

  useEffect(() => {
    if (!clientRef.current) return
    let cancelled = false
    void clientRef.current
      .listCollections()
      .then((items) => {
        if (!cancelled) setCollections(items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreateCollection(input: {
    name: string
    description?: string
  }) {
    const now = new Date().toISOString()
    const created = clientRef.current
      ? await clientRef.current.createCollection(input)
      : {
          id: newId(),
          name: input.name,
          description: input.description,
          bookIds: [],
          createdAt: now,
          updatedAt: now,
        }
    setCollections((prev) => [created, ...prev])
    onCreated?.(created)
    return created
  }

  async function updateCollection(
    collectionId: string,
    input: { name: string; description?: string },
  ) {
    const updated = clientRef.current
      ? await clientRef.current.updateCollection(collectionId, input)
      : null
    if (clientRef.current && !updated) return false
    const now = new Date().toISOString()
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              ...(updated ?? input),
              description: updated?.description ?? input.description,
              updatedAt: updated?.updatedAt ?? now,
            }
          : collection,
      ),
    )
    return true
  }

  async function deleteCollection(collectionId: string) {
    if (clientRef.current) {
      const result = await clientRef.current.deleteCollection(collectionId)
      if (!result.ok) return false
    }
    setCollections((prev) =>
      prev.filter((collection) => collection.id !== collectionId),
    )
    return true
  }

  async function addBookToCollection(collectionId: string, bookId: string) {
    if (clientRef.current) {
      const result = await clientRef.current.addBookToCollection(
        collectionId,
        bookId,
      )
      if (!result.ok) return false
    }
    const now = new Date().toISOString()
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId && !collection.bookIds.includes(bookId)
          ? {
              ...collection,
              bookIds: [...collection.bookIds, bookId],
              updatedAt: now,
            }
          : collection,
      ),
    )
    return true
  }

  async function removeBookFromCollection(
    collectionId: string,
    bookId: string,
  ) {
    if (clientRef.current) {
      const result = await clientRef.current.removeBookFromCollection(
        collectionId,
        bookId,
      )
      if (!result.ok) return false
    }
    const now = new Date().toISOString()
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              bookIds: collection.bookIds.filter((id) => id !== bookId),
              updatedAt: now,
            }
          : collection,
      ),
    )
    return true
  }

  return {
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
    updateCollection,
    deleteCollection,
    addBookToCollection,
    removeBookFromCollection,
    refreshCollections,
  }
}
