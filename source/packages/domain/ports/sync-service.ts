/**
 * @deprecated Prefer ExternalLibraryConnector (SRS FR-30 / SDS 1.11).
 * Kept as a thin alias so older imports compile during migration.
 * Account-based cloud sync is out of product scope.
 */
export type {
  ExternalLibraryStatus as SyncStatus,
  ExternalLibraryConnector as SyncService,
} from './external-library-connector.js';

export {
  NoOpExternalLibraryConnector as NoOpSyncService,
} from './external-library-connector.js';
