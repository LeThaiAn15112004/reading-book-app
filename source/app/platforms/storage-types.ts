/** Shared shapes of the `storage` platform adapter (spec 009 T044). */

export interface BookContentSource {
  /** Whole book; rejects when the file is missing or unreadable. */
  read(bookId: string): Promise<ArrayBuffer>
  /** Renderer-safe cover URL, or undefined when there is none. `version` changes when the cover does. */
  coverUrl(bookId: string, version: string): Promise<string | undefined>
}

/** What the native source needs from its host: one RPC call (the Mobile `HostClient` has it). */
export interface BookContentHost {
  call<T>(service: string, method: string, args?: unknown): Promise<T>
}

/** Per-launch values of the Mobile local server; Desktop has none. */
export interface BookContentBoot {
  baseUrl?: string | null
  token?: string | null
}
