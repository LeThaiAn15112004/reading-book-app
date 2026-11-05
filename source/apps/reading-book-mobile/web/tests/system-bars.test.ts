/** Status / navigation bar colours: what the page reports and what the host accepts. */
import { describe, expect, it } from 'vitest'
import { createAppService } from '../../src/host/app-service'
import { edgeColors, parseCssColor, toHex } from '../src/bridge/system-bars'

/** A page whose elements at the top and bottom edge have these backgrounds, innermost first. */
function fakeDoc(top: string[], bottom: string[], libBgDeep = '#0f172a') {
  const chain = (colors: string[]) => {
    let parent: unknown = null
    for (const bg of [...colors].reverse()) parent = { bg, parentElement: parent }
    return parent
  }
  const els = { top: chain(top), bottom: chain(bottom) }
  const win = {
    innerWidth: 360,
    innerHeight: 640,
    getComputedStyle: (el: { bg?: string }) => ({
      backgroundColor: el.bg ?? 'rgba(0, 0, 0, 0)',
      getPropertyValue: (name: string) => (name === '--lib-bg-deep' ? libBgDeep : ''),
    }),
  }
  return {
    defaultView: win,
    documentElement: {},
    body: { bg: 'rgba(0, 0, 0, 0)' },
    elementFromPoint: (_x: number, y: number) => (y === 0 ? els.top : els.bottom),
  } as unknown as Document
}

describe('edge colours', () => {
  it('parses what browsers compute, and writes #rrggbb', () => {
    expect(parseCssColor('rgb(15, 23, 42)')).toEqual({ r: 15, g: 23, b: 42, a: 1 })
    expect(parseCssColor('rgba(248, 250, 252, 0.95)')?.a).toBe(0.95)
    expect(parseCssColor('rgb(1 2 3 / 50%)')?.a).toBe(0.5)
    expect(parseCssColor('transparent')).toBeUndefined()
    expect(toHex({ r: 15, g: 23, b: 42, a: 1 })).toBe('#0f172a')
  })

  it('reads the opaque background at each edge, through transparent wrappers', () => {
    const doc = fakeDoc(['rgba(0, 0, 0, 0)', 'rgb(22, 18, 14)'], ['rgb(248, 250, 252)'])
    expect(edgeColors(doc)).toEqual({ top: '#16120e', bottom: '#f8fafc' })
  })

  it('blends a translucent bar with what is under it, and falls back to the theme colour', () => {
    const doc = fakeDoc(['rgba(255, 255, 255, 0.5)', 'rgb(0, 0, 0)'], ['rgba(0, 0, 0, 0)'], '#f8fafc')
    expect(edgeColors(doc)).toEqual({ top: '#808080', bottom: '#f8fafc' })
  })
})

describe('app.setSystemBars', () => {
  it('passes #rrggbb colours to the screen and refuses anything else', () => {
    const seen: unknown[] = []
    const app = createAppService({ info: { version: '1', platform: 'android', osVersion: '15' }, openUrl: async () => {}, onSystemBars: (c) => seen.push(c) })
    expect(app.setSystemBars({ top: '#0F172A', bottom: '#f8fafc' })).toEqual({ applied: true })
    expect(seen).toEqual([{ top: '#0f172a', bottom: '#f8fafc' }])
    for (const bad of [{ top: 'red', bottom: '#000000' }, { top: '#000', bottom: '#000000' }, { top: '#000000' }, { top: 'url(x)', bottom: '#000000' }]) {
      expect(() => app.setSystemBars(bad), JSON.stringify(bad)).toThrow(/#rrggbb/)
    }
    expect(seen).toHaveLength(1)
  })
})
