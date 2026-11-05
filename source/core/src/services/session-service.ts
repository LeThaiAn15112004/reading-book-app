import { SdkError, toSdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import { ReadingSessionState } from '../domain/index.js'

export interface SessionService {
  load(bookId: string): Promise<ReadingSessionState | undefined>
  save(session: ReadingSessionState): Promise<void>
}

export function createSessionService(rt: SdkRuntime): SessionService {
  const store = rt.storage.overlays

  return {
    async load(bookId) {
      if (!bookId.trim()) throw new SdkError('INVALID_ARGUMENT', 'bookId is required')
      try {
        return await store.getSessionState(bookId)
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not load reading session')
      }
    },

    async save(session) {
      try {
        await store.saveSessionState(session)
      } catch (err) {
        throw toSdkError(err, 'STORAGE_FAILED', 'Could not save reading session')
      }
    },
  }
}
