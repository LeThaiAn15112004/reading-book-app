/**
 * Renderer-side Typewriter fonts (specs/005-typewriter-note, T018): registers the shipped files as
 * `@font-face` for the page/editor and parses the SAME bytes for `FontMetrics`, so the layout the
 * editor shows equals the layout Main writes into the PDF.
 */

import { typewriterFontFaces, type EmbeddedFontFaceInfo, type FontMetrics } from '@reading-book/book-reader-sdk'
import { parseTrueType, ttfFontMetrics, type TtfFace } from '../../../../electron/pdf-sync/pdf-font-embed'

const urls = import.meta.glob('../../../../assets/fonts/typewriter/*.ttf', { query: '?url', import: 'default', eager: true }) as Record<string, string>

const parsed = new Map<string, TtfFace>()
let loading: Promise<void> | undefined

function urlFor(face: EmbeddedFontFaceInfo): string | undefined {
  const key = Object.keys(urls).find((k) => k.endsWith(`/${face.file}`))
  return key ? urls[key] : undefined
}

/** CSS `font-family` name of a face (one family per real face; weight/style are baked into the file). */
export function typewriterCssFamily(face: EmbeddedFontFaceInfo): string {
  return `rb-typewriter-${face.id.replace(':', '-')}`
}

/** Loads and registers every shipped face once; rejects when a file cannot be fetched or parsed. */
export function loadTypewriterFonts(): Promise<void> {
  loading ??= Promise.all(
    typewriterFontFaces.map(async (face) => {
      const url = urlFor(face)
      if (!url) throw new Error(`Typewriter font missing: ${face.file}`)
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      parsed.set(face.id, parseTrueType(bytes))
      const font = new FontFace(typewriterCssFamily(face), bytes.slice().buffer)
      document.fonts.add(await font.load())
    }),
  ).then(() => undefined)
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

export function areTypewriterFontsReady(): boolean {
  return parsed.size === typewriterFontFaces.length
}

/** Metrics from the loaded files; call after `loadTypewriterFonts()` resolved. */
export const typewriterRendererMetrics: FontMetrics = ttfFontMetrics((face) => {
  const hit = parsed.get(face.id)
  if (!hit) throw new Error('Typewriter fonts are not loaded yet')
  return hit
})
