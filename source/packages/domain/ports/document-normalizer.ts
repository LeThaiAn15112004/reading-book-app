/**
 * Optional normalize step before reading (SDS §2.6).
 * MVP reads the 4 formats directly — stub / pass-through is OK.
 */
export interface NormalizeResult {
  /** Path to use for reading (may equal inputPath for pass-through). */
  normalizedPath: string;
}

export interface DocumentNormalizer {
  /**
   * Normalize a sandbox file for the reader pipeline.
   * Stub adapters may return `{ normalizedPath: inputPath }`.
   */
  normalize(inputPath: string): Promise<NormalizeResult>;
}
