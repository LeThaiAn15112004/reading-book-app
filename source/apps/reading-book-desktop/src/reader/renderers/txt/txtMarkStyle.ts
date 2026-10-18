import type { CSSProperties } from 'react'
import type { TxtReaderHighlight } from '@reading-book/book-reader-sdk'

/** Share of the annotation color a highlight fill keeps (the text on top must stay readable). */
const FILL_PERCENT = 46
/** A note (textbox) gets a lighter wash so it reads as "something is attached here". */
const NOTE_FILL_PERCENT = 22

/**
 * How the backdrop paints a stretch of text covered by `covering` (lowest first, so later rows win
 * where two kinds collide): highlight = filled background, underline / strikethrough = a line,
 * note = a light wash with a dotted underline.
 */
export function txtMarkStyle(covering: readonly TxtReaderHighlight[]): CSSProperties {
  let fill: { color: string; percent: number } | undefined
  let lineColor: string | undefined
  let lineStyle: CSSProperties['textDecorationStyle'] = 'solid'
  const lines = new Set<string>()

  for (const h of covering) {
    switch (h.styleKind) {
      case 'highlight':
        fill = { color: h.colorHex, percent: FILL_PERCENT }
        break
      case 'underline':
        lines.add('underline')
        lineColor = h.colorHex
        lineStyle = 'solid'
        break
      case 'strikethrough':
        lines.add('line-through')
        lineColor = h.colorHex
        lineStyle = 'solid'
        break
      case 'textbox':
        fill ??= { color: h.colorHex, percent: NOTE_FILL_PERCENT }
        lines.add('underline')
        lineColor ??= h.colorHex
        if (covering.every((c) => c.styleKind === 'textbox')) lineStyle = 'dotted'
        break
    }
  }

  const top = covering[covering.length - 1]
  const style: Record<string, string | number | undefined> = {
    '--txt-mark-ring': top?.colorHex,
  }
  if (fill) style.backgroundColor = `color-mix(in srgb, ${fill.color} ${fill.percent}%, transparent)`
  if (lines.size > 0) {
    style.textDecorationLine = [...lines].join(' ')
    style.textDecorationColor = lineColor
    style.textDecorationStyle = lineStyle
    style.textDecorationThickness = '2px'
    style.textUnderlineOffset = '2px'
  }
  return style as CSSProperties
}
