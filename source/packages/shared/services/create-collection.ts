import type { Collection, CollectionStore } from '@reading-book/domain';

/**
 * Create a user collection (SDS — CollectionService.create).
 */
export class CreateCollectionService {
  constructor(private readonly collections: CollectionStore) {}

  async execute(_name: string, _description?: string): Promise<Collection> {
    throw new Error('CreateCollectionService.execute: not implemented');
  }
}
