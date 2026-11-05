/**
 * Keeps the phone's status bar and navigation bar the colour of the app (Mobile host only).
 *
 * The bars are transparent (edge-to-edge); the host paints the areas behind them with the colours this module
 * reports through `app.setSystemBars`. They are read from the page itself, at its top and bottom edge, so every
 * screen and theme matches without a colour table: Library and Settings (`--lib-bg-deep`), the Reader with its own
 * reading theme, a sheet open at the bottom. Read again when the theme changes (`setChromeTheme`), on navigation,
 * on resize, and once a second while the page is visible; only a change is sent.
 */
import type { HostClient } from './host-client'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** `rgb(…)` / `rgba(…)` / `rgb(… / a)` as computed by the browser; undefined for anything else. */
export function parseCssColor(value: string): Rgba | undefined {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim())
  if (!m) return undefined
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha }
}

export function toHex({ r, g, b }: Rgba): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Composites `top` over `under` (both straight alpha). */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (t: number, u: number) => (t * top.a + u * under.a * (1 - top.a)) / a
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a }
}

/**
 * The colour a person sees at one point: the backgrounds of the element there and its ancestors, composited from
 * the top down until opaque (a translucent bar such as `bg-lib-bg-deep/95` blends with what is under it).
 */
export function visibleColorAt(doc: Document, x: number, y: number, fallback: Rgba): Rgba {
  let color: Rgba = { r: 0, g: 0, b: 0, a: 0 }
  for (let el = doc.elementFromPoint(x, y); el && color.a < 0.999; el = el.parentElement) {
    const bg = parseCssColor(doc.defaultView?.getComputedStyle(el).backgroundColor ?? '')
    if (bg && bg.a > 0) color = over(color, bg)
  }
  return color.a < 0.999 ? over(color, fallback) : color
}

function fallbackColor(doc: Document): Rgba {
  const root = doc.defaultView?.getComputedStyle(doc.documentElement)
  const fromVar = root?.getPropertyValue('--lib-bg-deep').trim() ?? ''
  const hex = /^#([0-9a-f]{6})$/i.exec(fromVar)?.[1]
  if (hex) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 }
  return parseCssColor(doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? '') ?? { r: 15, g: 23, b: 42, a: 1 }
}

/** The two edge colours of the page as `#rrggbb`. */
export function edgeColors(doc: Document): { top: string; bottom: string } {
  const win = doc.defaultView!
  const x = Math.floor(win.innerWidth / 2)
  const fallback = fallbackColor(doc)
  return {
    top: toHex(visibleColorAt(doc, x, 0, fallback)),
    bottom: toHex(visibleColorAt(doc, x, Math.max(0, win.innerHeight - 1), fallback)),
  }
}

/** Starts following the page; returns `refresh`, to call when something is known to have changed. */
export function startSystemBarSync(client: HostClient, doc: Document = document): () => void {
  let last = ''
  let scheduled = false
  const send = () => {
    scheduled = false
    if (doc.visibilityState === 'hidden' || !doc.body) return
    const colors = edgeColors(doc)
    const key = `${colors.top}${colors.bottom}`
    if (key === last) return
    last = key
    void client.call('app', 'setSystemBars', colors).catch(() => {
      last = '' // try again on the next check
    })
  }
  // After the frame that applied the change has painted.
  const refresh = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => requestAnimationFrame(send))
  }
  const win = doc.defaultView!
  win.addEventListener('hashchange', () => {
    refresh()
    // Routes load lazily: look again once the new screen is in place.
    setTimeout(refresh, 400)
  })
  win.addEventListener('resize', refresh)
  doc.addEventListener('visibilitychange', refresh)
  // Sheets, immersive reading and theme previews change the edges without an event of their own.
  setInterval(refresh, 1000)
  refresh()
  return refresh
}
