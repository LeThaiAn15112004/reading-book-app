import { useParams } from 'react-router-dom'
import { ReaderBackLink, ReaderHeader } from './components'

/** SCR-03 — Reader shell (placeholder; no document render yet). */
export function ReaderScreen() {
  const { bookId } = useParams<{ bookId: string }>()

  return (
    <main>
      <ReaderHeader bookId={bookId} />
      <ReaderBackLink />
    </main>
  )
}
