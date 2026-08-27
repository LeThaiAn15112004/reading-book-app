/** Progress callback invoked while a streamed HTTP response body is read. */
export type DownloadProgressListener = (
  receivedBytes: number,
  /** Total size from the `Content-Length` header, or `null` when the server didn't send one. */
  totalBytes: number | null,
) => void;

/**
 * Reads a `fetch` Response body via its stream reader, invoking `onProgress` after
 * each chunk with cumulative bytes received. Falls back to `response.arrayBuffer()`
 * when no listener is given or the runtime doesn't expose a readable stream body.
 */
export async function readResponseBodyWithProgress(
  response: Response,
  onProgress?: DownloadProgressListener,
): Promise<ArrayBuffer> {
  if (!onProgress || !response.body) {
    return response.arrayBuffer();
  }

  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, total != null && Number.isFinite(total) ? total : null);
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
