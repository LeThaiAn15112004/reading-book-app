import type { UrlDocumentFetcher, UrlFetchResult } from '@reading-book/domain'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

/** Stable error codes for FR-13 / E4 (mapped to ImportResult). */
export type UrlFetchErrorCode =
  | 'scheme'
  | 'timeout'
  | 'too_large'
  | 'network'
  | 'not_direct_file'
  | 'http_status'

export class UrlFetchError extends Error {
  readonly code: UrlFetchErrorCode

  constructor(code: UrlFetchErrorCode, message: string) {
    super(message)
    this.name = 'UrlFetchError'
    this.code = code
  }
}

export const DOWNLOAD_TIMEOUT_MS = 60_000
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
export const MAX_REDIRECTS = 5

const ALLOWED_SCHEMES = new Set(['https:'])

function assertHttpsUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new UrlFetchError('scheme', 'Invalid URL.')
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new UrlFetchError('scheme', 'Only secure HTTPS links are allowed.')
  }
  return parsed
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return mime === 'text/html' || mime === 'application/xhtml+xml'
}

function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  return base || 'downloaded-document'
}

function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined

  const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return safeFileName(decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')))
    } catch {
      // fall through
    }
  }

  const plain = /filename\s*=\s*("([^"]+)"|([^;]+))/i.exec(header)
  const name = plain?.[2] ?? plain?.[3]?.trim()
  if (name) return safeFileName(name)
  return undefined
}

function basenameFromUrl(url: URL): string | undefined {
  try {
    const base = path.basename(decodeURIComponent(url.pathname))
    if (!base || base === '/' || base === '.' || base === '..') return undefined
    return safeFileName(base)
  } catch {
    return undefined
  }
}

function createByteLimitTransform(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length
      if (total > maxBytes) {
        cb(new UrlFetchError('too_large', 'File exceeds the maximum download size (100 MB).'))
        return
      }
      cb(null, chunk)
    },
  })
}

async function removeQuietly(filePath: string | undefined): Promise<void> {
  if (!filePath) return
  await fsp.rm(filePath, { force: true }).catch(() => {})
}

/**
 * Main-process HTTPS direct-file downloader (SDS §2.6 / FR-13 / T2.4).
 * Streams to a temp path with scheme allowlist, timeout, size limit, and bounded redirects.
 * T2.10: on failure after a partial write, removeQuietly deletes the temp file.
 */
export class HttpUrlFetcher implements UrlDocumentFetcher {
  async fetch(url: string): Promise<UrlFetchResult> {
    let current = assertHttpsUrl(url.trim())
    const tempRoot = app.getPath('temp')
    let tempPath: string | undefined
    let wroteFile = false

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

    try {
      let redirects = 0
      let response: Response | undefined

      while (true) {
        try {
          response = await fetch(current.href, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { Accept: '*/*' },
          })
        } catch (err) {
          if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
            throw new UrlFetchError('timeout', 'Download timed out. Please try again.')
          }
          throw new UrlFetchError(
            'network',
            err instanceof Error ? err.message : 'Network error while downloading.',
          )
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) {
            throw new UrlFetchError(
              'http_status',
              `Redirect without Location (HTTP ${response.status}).`,
            )
          }
          redirects += 1
          if (redirects > MAX_REDIRECTS) {
            throw new UrlFetchError('network', 'Too many redirects.')
          }
          // Re-validate scheme on every hop (no http/file downgrade).
          current = assertHttpsUrl(new URL(location, current).href)
          continue
        }

        break
      }

      if (!response || !response.ok) {
        const status = response?.status ?? 0
        throw new UrlFetchError(
          'http_status',
          status ? `Download failed (HTTP ${status}).` : 'Download failed.',
        )
      }

      const contentType = response.headers.get('content-type')
      if (isHtmlContentType(contentType)) {
        throw new UrlFetchError(
          'not_direct_file',
          'URL does not point to a direct file (HTML page received).',
        )
      }

      const contentLengthHeader = response.headers.get('content-length')
      if (contentLengthHeader) {
        const len = Number(contentLengthHeader)
        if (Number.isFinite(len) && len > MAX_DOWNLOAD_BYTES) {
          throw new UrlFetchError('too_large', 'File exceeds the maximum download size (100 MB).')
        }
      }

      if (!response.body) {
        throw new UrlFetchError('network', 'Empty response body.')
      }

      const suggestedFileName =
        parseContentDispositionFilename(response.headers.get('content-disposition')) ??
        basenameFromUrl(current) ??
        'downloaded-document'

      tempPath = path.join(tempRoot, `rb-import-${randomUUID()}-${suggestedFileName}`)

      const nodeStream = Readable.fromWeb(
        response.body as unknown as NodeWebReadableStream,
      )
      const limit = createByteLimitTransform(MAX_DOWNLOAD_BYTES)
      const out = fs.createWriteStream(tempPath)
      wroteFile = true

      try {
        await pipeline(nodeStream, limit, out)
      } catch (err) {
        if (err instanceof UrlFetchError) throw err
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new UrlFetchError('timeout', 'Download timed out. Please try again.')
        }
        throw new UrlFetchError(
          'network',
          err instanceof Error ? err.message : 'Failed to write downloaded file.',
        )
      }

      return {
        tempPath,
        suggestedFileName,
        contentType: contentType ?? undefined,
      }
    } catch (err) {
      if (wroteFile) await removeQuietly(tempPath)
      if (err instanceof UrlFetchError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new UrlFetchError('timeout', 'Download timed out. Please try again.')
      }
      throw new UrlFetchError(
        'network',
        err instanceof Error ? err.message : 'Download failed.',
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

export const httpUrlFetcher = new HttpUrlFetcher()
