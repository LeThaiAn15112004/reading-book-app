import { Fragment, type ReactNode } from 'react'
import type { AnyMessageKey, Params } from '@core'
import { useT } from './useT'

type Props = {
  /** Message key; its text may contain slot markers like `Open <link>Settings</link>`. */
  k: AnyMessageKey
  params?: Params
  /** One renderer per slot name; the slot's inner text is passed in (already translated). */
  slots: Readonly<Record<string, (text: string) => ReactNode>>
}

// Parameter values are swapped for private-use markers BEFORE slots are parsed, so a value containing "<b>" or
// "<link>" is never treated as markup (spec 012: inserted values are shown literally).
const OPEN = ''
const CLOSE = ''
const MARKER = /(\d+)/g
const SLOT = /<([A-Za-z][A-Za-z0-9]*)>([\s\S]*?)<\/\1>/g

/** A translated message with React nodes in its slots (spec 012 contract `renderer-i18n.md`). */
export function TransText({ k, params, slots }: Props): ReactNode {
  const t = useT() as (key: string, params?: Params) => string
  const values = params ? Object.entries(params) : []
  const masked: Record<string, string | number> = {}
  values.forEach(([name, value], index) => {
    // `count` stays numeric so plural forms are still chosen from it.
    masked[name] = name === 'count' && typeof value === 'number' ? value : `${OPEN}${index}${CLOSE}`
  })
  const text = t(k, params ? masked : undefined)
  const unmask = (s: string) => s.replace(MARKER, (_m, i: string) => String(values[Number(i)]?.[1] ?? ''))

  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(SLOT)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(unmask(text.slice(last, start)))
    const render = slots[match[1]!]
    const inner = unmask(match[2] ?? '')
    nodes.push(render ? render(inner) : inner)
    last = start + match[0].length
  }
  if (last < text.length) nodes.push(unmask(text.slice(last)))
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  )
}
