/**
 * Deliberately tiny, tolerant XML scanning for the few flat elements EPUB packaging needs
 * (`rootfile`, `dc:*`, `meta`, `item`, `itemref`). Not a general XML parser: it does not build a
 * tree and does not handle nesting of the *same* element name — none of the targeted elements
 * nest. Keeping it here avoids a hard dependency on DOMParser (absent in Node / React Native) or
 * fast-xml-parser.
 */

export interface XmlElement {
  /** Qualified name as written, e.g. `dc:title`. */
  name: string
  /** Attributes keyed both by qualified name and by local name (`opf:role` and `role`). */
  attrs: Record<string, string>
  /** Raw inner markup, or `null` for a self-closing element. */
  inner: string | null
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/** Strip comments, processing instructions and unwrap CDATA (escaping its content). */
export function preprocessXml(xml: string): string {
  return xml
    .replace(/^﻿/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, content: string) =>
      content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
}

export function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const name = match[1] ?? ''
    const value = decodeXmlEntities(match[2] ?? match[3] ?? '')
    attrs[name] = value
    const colon = name.indexOf(':')
    if (colon >= 0) {
      const local = name.slice(colon + 1)
      if (!(local in attrs)) attrs[local] = value
    }
  }
  return attrs
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** All elements whose local name is `localName`, with any (or no) namespace prefix. */
export function findElements(xml: string, localName: string): XmlElement[] {
  const name = escapeRegExp(localName)
  const re = new RegExp(
    `<((?:[A-Za-z_][\\w.-]*:)?${name})(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</\\1\\s*>)`,
    'g',
  )
  const out: XmlElement[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    out.push({
      name: match[1] ?? localName,
      attrs: parseAttributes(match[2] ?? ''),
      inner: match[3] ?? null,
    })
  }
  return out
}

/** Inner text with tags removed, entities decoded and whitespace collapsed. */
export function textOf(element: XmlElement): string {
  if (element.inner === null) return ''
  return decodeXmlEntities(element.inner.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Inner markup of the first `localName` element, e.g. the `<metadata>` block of an OPF. */
export function innerOf(xml: string, localName: string): string | null {
  return findElements(xml, localName)[0]?.inner ?? null
}
