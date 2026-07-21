import type { Note, OverlayStore } from '@reading-book/domain';

/**
 * Add a note overlay on a book (SDS — AnnotationService.addNote).
 */
export class AddNoteService {
  constructor(private readonly overlays: OverlayStore) {}

  async execute(_n: Note): Promise<Note> {
    throw new Error('AddNoteService.execute: not implemented');
  }
}
