import { useEffect } from 'react'
import { notificationsApi } from '../bridge'
import { useOpenReading } from './OpenReadingContext'

/**
 * App-level bridge: Main `notifications:openBook` (a reading-reminder notification was clicked)
 * → open that book in the Reader. Main has already shown the window.
 */
export function ReminderNavigationBridge() {
  const { openBook } = useOpenReading()
  useEffect(() => notificationsApi.onOpenBook(({ bookId, title }) => openBook(bookId, title || undefined)), [openBook])
  return null
}
