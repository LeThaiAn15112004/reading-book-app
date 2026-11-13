import { describe, expect, it } from 'vitest'
import { placeMenu, submenuOffsetY } from '../../src/app-models/menu-placement'

const VIEW = { viewportWidth: 1280, viewportHeight: 800 }

describe('placeMenu', () => {
  it('opens below / right of the point when it fits', () => {
    expect(placeMenu({ x: 100, y: 100, width: 274, height: 450, ...VIEW })).toEqual({ left: 100, top: 100 })
  })

  it('flips above the point when it would pass the bottom edge (the taskbar case)', () => {
    // Opened near the bottom: 560 + 460 > 800 - 8 → placed so its bottom is at the point.
    const p = placeMenu({ x: 560, y: 560, width: 274, height: 460, ...VIEW })
    expect(p.top).toBe(100)
    expect(p.top + 460).toBeLessThanOrEqual(800 - 8)
  })

  it('a menu opened from a button flips above the button, not over it', () => {
    // Button 520–556, menu asked below it at 560; flipped, it ends at the button's top (flipY).
    expect(placeMenu({ x: 560, y: 560, flipY: 516, width: 274, height: 460, ...VIEW }).top).toBe(56)
  })

  it('pins to the bottom margin when it fits neither below nor above the point', () => {
    const p = placeMenu({ x: 10, y: 300, width: 274, height: 600, ...VIEW })
    expect(p.top).toBe(800 - 8 - 600)
    expect(p.maxHeight).toBeUndefined()
  })

  it('flips left of the point near the right edge', () => {
    expect(placeMenu({ x: 1200, y: 10, width: 274, height: 100, ...VIEW }).left).toBe(1200 - 274)
  })

  it('a menu taller than the window gets maxHeight and starts at the top margin', () => {
    expect(placeMenu({ x: 10, y: 400, width: 274, height: 900, ...VIEW })).toEqual({ left: 10, top: 8, maxHeight: 784 })
  })

  it('never goes past any edge, for any point', () => {
    for (const x of [-50, 0, 640, 1279, 1500]) {
      for (const y of [-50, 0, 400, 799, 1000]) {
        const p = placeMenu({ x, y, width: 274, height: 460, ...VIEW })
        expect(p.left).toBeGreaterThanOrEqual(8)
        expect(p.left + 274).toBeLessThanOrEqual(1280 - 8)
        expect(p.top).toBeGreaterThanOrEqual(8)
        expect(p.top + 460).toBeLessThanOrEqual(800 - 8)
      }
    }
  })
})

describe('submenuOffsetY', () => {
  it('0 when the submenu fits below its row', () => {
    expect(submenuOffsetY(100, 200, 800)).toBe(0)
  })

  it('moves up just enough to end at the bottom margin', () => {
    expect(submenuOffsetY(700, 200, 800)).toBe(-(700 + 200 - 792))
  })

  it('never moves above the top margin', () => {
    expect(submenuOffsetY(50, 2000, 800)).toBe(-42)
  })
})
