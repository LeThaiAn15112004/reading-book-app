import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

import { LONG_PRESS_MS, withLongPress } from '@app/platforms/longPress'
import { useLibrarySelectionStore } from '@app/screens/Library/logic/librarySelectionStore'

/**
 * Phone long press → Library select mode. Android WebView fires its own `contextmenu` for a held finger — on some
 * devices (seen on a Xiaomi, Android 16) at ~400 ms, BEFORE the app's 500 ms timer. Both used to reach the handler:
 * the first picked the book, the second unpicked it, and select mode closed again ~100 ms after it opened.
 */
const target = {} as Element

const pointer = (type: string, x = 100, y = 200) =>
  ({ pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, currentTarget: target, type }) as unknown as ReactPointerEvent<Element>

const nativeContextMenu = () => {
  const preventDefault = vi.fn()
  return { event: { clientX: 100, clientY: 200, currentTarget: target, target, preventDefault, stopPropagation: vi.fn() } as unknown as ReactMouseEvent<Element>, preventDefault }
}

/** The same wiring as the phone book list / grid: a long press starts select mode with that book. */
const rowProps = () =>
  withLongPress((event) => {
    event.preventDefault()
    useLibrarySelectionStore.getState().press('book-1')
  })

// The adapter remembers when a long press last fired (module state): every test starts an hour later than the last.
let clock = Date.now()
const later = () => vi.setSystemTime((clock += 3_600_000))

describe('phone long press (select mode)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    later()
    useLibrarySelectionStore.getState().clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays in select mode when the native contextmenu arrives before the 500 ms timer', () => {
    const props = rowProps()
    props.onPointerDown!(pointer('pointerdown'))
    vi.advanceTimersByTime(394)
    props.onContextMenu(nativeContextMenu().event)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    props.onPointerUp!(pointer('pointerup'))

    expect(useLibrarySelectionStore.getState()).toMatchObject({ active: true, ids: ['book-1'] })
  })

  it('stays in select mode when the timer fires first and the native contextmenu follows', () => {
    const props = rowProps()
    props.onPointerDown!(pointer('pointerdown'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    const late = nativeContextMenu()
    props.onContextMenu(late.event)
    props.onPointerUp!(pointer('pointerup'))

    expect(useLibrarySelectionStore.getState()).toMatchObject({ active: true, ids: ['book-1'] })
    expect(late.preventDefault).toHaveBeenCalled()
  })

  it('swallows the click that ends the press in both orders', () => {
    for (const nativeFirst of [true, false]) {
      later()
      const props = rowProps()
      props.onPointerDown!(pointer('pointerdown'))
      if (nativeFirst) {
        vi.advanceTimersByTime(400)
        props.onContextMenu(nativeContextMenu().event)
      }
      vi.advanceTimersByTime(LONG_PRESS_MS)
      props.onPointerUp!(pointer('pointerup'))
      const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ReactMouseEvent<Element>
      props.onClickCapture!(click)
      expect(click.preventDefault).toHaveBeenCalled()
    }
  })

  it('a short tap fires nothing', () => {
    const props = rowProps()
    props.onPointerDown!(pointer('pointerdown'))
    vi.advanceTimersByTime(120)
    props.onPointerUp!(pointer('pointerup'))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(useLibrarySelectionStore.getState().active).toBe(false)
  })

  it('a native contextmenu with no touch press in progress (e.g. a mouse) still opens once', () => {
    const props = rowProps()
    props.onContextMenu(nativeContextMenu().event)

    expect(useLibrarySelectionStore.getState()).toMatchObject({ active: true, ids: ['book-1'] })
  })
})
