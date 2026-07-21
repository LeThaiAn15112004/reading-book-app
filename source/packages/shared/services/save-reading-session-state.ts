import type { OverlayStore, ReadingSessionState } from '@reading-book/domain';

/**
 * Persist reading progress / session state (SDS — ReaderService.saveSessionState).
 */
export class SaveReadingSessionStateService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(_state: ReadingSessionState): Promise<void> {
    throw new Error('SaveReadingSessionStateService.execute: not implemented');
  }
}
