/**
 * Main-side access to the shipped Typewriter fonts (`assets/fonts/typewriter/`): reads each file once,
 * parses it once and hands out the cached face. specs/005-typewriter-note/ (T018).
 */

import type { EmbeddedFontFaceInfo, FontMetrics } from '@reading-book/book-reader-sdk'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTrueType, ttfFontMetrics, type TtfFace } from './pdf-font-embed'

const cache = new Map<string, TtfFace>()

export function typewriterFontsDir(): string {
  const root = process.env.APP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  return path.join(root, 'assets', 'fonts', 'typewriter')
}

/** Throws (code `font_unavailable` for the caller) when the file is missing or not a usable TrueType font. */
export function loadTypewriterFace(face: EmbeddedFontFaceInfo): TtfFace {
  const hit = cache.get(face.id)
  if (hit) return hit
  const bytes = new Uint8Array(readFileSync(path.join(typewriterFontsDir(), face.file)))
  const parsed = parseTrueType(bytes)
  cache.set(face.id, parsed)
  return parsed
}

export function loadTypewriterBytes(face: EmbeddedFontFaceInfo): Uint8Array {
  return loadTypewriterFace(face).bytes
}

let metrics: FontMetrics | undefined
export function typewriterFontMetrics(): FontMetrics {
  metrics ??= ttfFontMetrics(loadTypewriterFace)
  return metrics
}
