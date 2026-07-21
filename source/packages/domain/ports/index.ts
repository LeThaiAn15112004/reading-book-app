export type { LibraryStore } from './library-store.js';
export type { CollectionStore } from './collection-store.js';
export type { OverlayStore } from './overlay-store.js';

export type { DocumentImporter, ImportResult } from './document-importer.js';
export type { UrlDocumentFetcher, UrlFetchResult } from './url-document-fetcher.js';
export type { DocumentNormalizer, NormalizeResult } from './document-normalizer.js';

export type { DocumentRenderer } from './document-renderer.js';
export type { OverlayPainter } from './overlay-painter.js';
export type {
  LocationCodec,
  LocationEncodeInput,
  LocationDecodeResult,
} from './location-codec.js';

export type { AiProvider, AiContext, AiAnswer } from './ai-provider.js';
export { NoOpAiProvider } from './ai-provider.js';

export type {
  ExternalLibraryConnector,
  ExternalLibraryProvider,
  ExternalLibraryStatus,
  ExternalCatalogEntry,
  LinkLibraryOptions,
} from './external-library-connector.js';
export { NoOpExternalLibraryConnector } from './external-library-connector.js';

/** @deprecated Use ExternalLibraryConnector / NoOpExternalLibraryConnector */
export type { SyncService, SyncStatus } from './sync-service.js';
export { NoOpSyncService } from './sync-service.js';
