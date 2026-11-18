import { useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '@core'

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
      sortOrder?: number,
    ) => Promise<{ ok: boolean }>
    /** Spec 015 bulk add; optional so older clients still fit. */
    addBooksToCollection?: (
      collectionId: string,
      bookIds: string[],
    ) => Promise<{ ok: boolean; added: string[]; skipped: string[] }>
    removeBookFromCollection: (
      collectionId: string,
      bookId: string,
    ) => Promise<{ ok: boolean; sortOrder?: number }>
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

  /**
   * `sortOrder` (Undo of a removal, spec 015 FR-015): the book goes back at that position; the list is then re-read
   * so the local order is exactly the stored one.
   */
  async function addBookToCollection(collectionId: string, bookId: string, sortOrder?: number) {
    if (clientRef.current) {
      const result = await clientRef.current.addBookToCollection(
        collectionId,
        bookId,
        sortOrder,
      )
      if (!result.ok) return false
      if (sortOrder !== undefined) {
        await refreshCollections().catch(() => {})
        return true
      }
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

  /** Several books at the end, in the given order (spec 015 FR-010); returns the client's result as is. */
  async function addBooksToCollection(collectionId: string, bookIds: string[]) {
    const client = clientRef.current
    const result = client?.addBooksToCollection
      ? await client.addBooksToCollection(collectionId, bookIds)
      : { ok: !client, added: client ? [] : [...new Set(bookIds)], skipped: [] }
    if (result.ok && result.added.length > 0) {
      const now = new Date().toISOString()
      setCollections((prev) =>
        prev.map((collection) =>
          collection.id === collectionId
            ? {
                ...collection,
                bookIds: [...collection.bookIds, ...result.added.filter((id) => !collection.bookIds.includes(id))],
                updatedAt: now,
              }
            : collection,
        ),
      )
    }
    return result
  }

  /** `sortOrder` = the removed link's position (for Undo); absent without a client. */
  async function removeBookFromCollection(
    collectionId: string,
    bookId: string,
  ): Promise<{ ok: boolean; sortOrder?: number }> {
    let sortOrder: number | undefined
    if (clientRef.current) {
      const result = await clientRef.current.removeBookFromCollection(
        collectionId,
        bookId,
      )
      if (!result.ok) return { ok: false }
      sortOrder = result.sortOrder
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
    return { ok: true, sortOrder }
  }

  return {
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
    updateCollection,
    deleteCollection,
    addBookToCollection,
    addBooksToCollection,
    removeBookFromCollection,
    refreshCollections,
  }
}
