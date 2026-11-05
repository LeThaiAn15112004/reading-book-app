import type { Collection } from '../domain/index.js';
import type { CollectionStore } from '../domain-ports/index.js';

/**
 * Create a user collection (SDS — CollectionService.create).
 */
export class CreateCollectionService {
  constructor(_collections: CollectionStore) {}

  async execute(_name: string, _description?: string): Promise<Collection> {
    throw new Error('CreateCollectionService.execute: not implemented');
  }
}
