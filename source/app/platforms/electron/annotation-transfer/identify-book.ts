/**
 * Which library book does an annotations file belong to? (specs/006-annotation-import-export, research R4)
 * Order: the file's content fingerprint (`books.sha256`), then title + author + format. The same logic serves
 * the Reader menu and the Library, so both flows propose the same target.
 */
import type { BookListItem } from '../persistence/sqlite-library-store'

export interface IdentifyFileBook {
  title: string
  author?: string
  format: 'epub' | 'pdf' | 'txt' | 'md'
  sha256: string
}

export type IdentifiedBook =
  | { found: true; bookId: string; title: string; author?: string; format: string; matchedBy: 'sha256' | 'title' }
  | { found: false; missing: { title: string; author?: string } }

/** The two library calls identification needs (the real `SqliteLibraryStore` satisfies this). */
export interface IdentifyLibrary {
  findBySha256(hash: string): Promise<{ id: string } | undefined>
  listAll(): Promise<BookListItem[]>
}

/** Case-, accent-form- and spacing-insensitive text for comparing titles and authors. */
function norm(text: string | undefined): string {
  return (text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Finds the library book for a file's `book` header. With several title matches the newest wins
 * (`listAll` is newest-first). An author is compared only when the file recorded one.
 */
export async function identifyBook(file: IdentifyFileBook, library: IdentifyLibrary): Promise<IdentifiedBook> {
  const items = await library.listAll()
  const byHash = await library.findBySha256(file.sha256)
  if (byHash) {
    const item = items.find((i) => i.book.id === byHash.id)
    if (item) {
      return {
        found: true,
        bookId: item.book.id,
        title: item.book.title,
        author: item.authorNames || undefined,
        format: item.book.format,
        matchedBy: 'sha256',
      }
    }
  }

  const title = norm(file.title)
  const author = norm(file.author)
  const match = items.find(
    (i) => i.book.format === file.format && norm(i.book.title) === title && (author === '' || norm(i.authorNames) === author),
  )
  if (match) {
    return {
      found: true,
      bookId: match.book.id,
      title: match.book.title,
      author: match.authorNames || undefined,
      format: match.book.format,
      matchedBy: 'title',
    }
  }
  return { found: false, missing: { title: file.title, author: file.author } }
}
