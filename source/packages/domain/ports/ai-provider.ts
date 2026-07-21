/**
 * Request / response shapes for AI assistance (Phase 2 — SDS §2.6 / §2.9).
 * Kept minimal so MVP can wire NoOp without locking full AI design.
 */
export interface AiContext {
  bookId: string;
  /** Selected or cited text when available. */
  selectedText?: string;
  /** Opaque location string (Location.toString()) for citation. */
  locationRef?: string;
}

export interface AiAnswer {
  text: string;
  /** Optional citation location strings. */
  citations?: string[];
}

/**
 * AI provider port. MVP uses NoOpAiProvider; Phase 2 swaps Remote/Local.
 */
export interface AiProvider {
  ask(question: string, context: AiContext): Promise<AiAnswer>;
  explain(context: AiContext): Promise<AiAnswer>;
  summarize(context: AiContext): Promise<AiAnswer>;
}

/** MVP stub — no network; always reports AI disabled. */
export class NoOpAiProvider implements AiProvider {
  async ask(_question: string, _context: AiContext): Promise<AiAnswer> {
    return { text: 'AI disabled' };
  }

  async explain(_context: AiContext): Promise<AiAnswer> {
    return { text: 'AI disabled' };
  }

  async summarize(_context: AiContext): Promise<AiAnswer> {
    return { text: 'AI disabled' };
  }
}
