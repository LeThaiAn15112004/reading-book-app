import { useEffect } from 'react'
import { appApi } from '../bridge'
import { flushRegisteredSession } from '../screens/Reader/logic'

/**
 * App-level bridge: Main `app:requestFlushSession` → registered Reader flush (T4.2).
 */
export function SessionFlushBridge() {
  useEffect(() => {
    return appApi.onRequestFlushSession(() => flushRegisteredSession())
  }, [])
  return null
}
