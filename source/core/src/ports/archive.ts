/** Read-only view over an opened ZIP container (an EPUB is a ZIP). */
export interface ArchiveReader {
  /** All entry paths, `/`-separated, no leading slash. */
  listEntries(): readonly string[]
  /** UTF-8 text of an entry, or `null` when it does not exist. */
  readText(path: string): Promise<string | null>
  readBytes(path: string): Promise<Uint8Array | null>
  close?(): void | Promise<void>
}

/**
 * ZIP decoding is injected (JSZip on desktop, react-native-zip-archive / fflate on mobile) so
 * the SDK stays dependency-free. Without it, EPUB imports fall back to file-name metadata.
 */
export interface ArchiveAdapter {
  open(bytes: Uint8Array): Promise<ArchiveReader>
}
