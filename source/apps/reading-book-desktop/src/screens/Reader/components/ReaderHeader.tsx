type ReaderHeaderProps = {
  bookId?: string
}

/** SCR-03 chrome title (placeholder until document render). */
export function ReaderHeader({ bookId }: ReaderHeaderProps) {
  return (
    <header>
      <h1>Reader</h1>
      <p>SCR-03 placeholder — bookId: {bookId}</p>
    </header>
  )
}
