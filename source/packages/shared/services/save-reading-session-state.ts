import type { OverlayStore, ReadingSessionState } from '@reading-book/domain';

/** Minimal port surface needed to persist session (T4.3). */
export type SessionStateWriter = Pick<OverlayStore, 'saveSessionState'>;

/**
 * Persist reading progress / session state (SDS — ReaderService.saveSessionState).
 */
export class SaveReadingSessionStateService {
  constructor(private readonly overlays: SessionStateWriter) {}

  async execute(state: ReadingSessionState): Promise<void> {
    await this.overlays.saveSessionState(state);
  }
}
