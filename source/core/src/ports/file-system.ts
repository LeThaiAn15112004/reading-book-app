/**
 * Opaque file reference. Desktop: an absolute path. Expo: a `file://` / `content://` URI.
 * Tests: any key. The SDK only ever extracts a display file name from it.
 */
export type FileRef = string

/**
 * File access the import pipeline needs. Implementations own the sandbox location and path
 * allow-listing; the SDK never builds paths itself.
 *
 * Invariant (CLAUDE.md "read-only/overlay invariant"): `copyToSandbox` must COPY, never move, and
 * nothing in the SDK ever writes to a source file or to a sandboxed book file.
 */
export interface FileSystemAdapter {
  readBytes(ref: FileRef): Promise<Uint8Array>
  /** Copy `source` into app-owned storage under `targetName`; resolves to the sandbox ref. */
  copyToSandbox(source: FileRef, targetName: string): Promise<FileRef>
  /** Write a derived asset (e.g. an extracted cover image) into app-owned storage. */
  writeSandboxFile(targetName: string, bytes: Uint8Array): Promise<FileRef>
  /** Delete a file previously created by `copyToSandbox` / `writeSandboxFile`. Never a source file. */
  removeSandboxFile(ref: FileRef): Promise<void>
  exists(ref: FileRef): Promise<boolean>
}
