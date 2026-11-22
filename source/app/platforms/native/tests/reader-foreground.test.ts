/**
 * Spec 017 (US1, T016, FR-003): the host's AppState (`lifecycle` event) reaches the Reader's opening store as the DOM
 * event `readmate:foreground`, so time in the background never counts against an opening's time limit — without
 * relying on `visibilitychange` inside the Android WebView.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FOREGROUND_EVENT } from '../bridge/app'
import { createFakeHost, type FakeHost } from './fake-host'

let host: FakeHost
const saved = (globalThis as { window?: unknown }).window
afterEach(() => {
  host?.sql.db.close()
  host = undefined as unknown as FakeHost
  ;(globalThis as { window?: unknown }).window = saved
})

describe('foreground events for the opening store', () => {
  it('turns lifecycle active / background into readmate:foreground { active }', async () => {
    const target = new EventTarget()
    ;(globalThis as { window?: unknown }).window = target
    const seen: boolean[] = []
    target.addEventListener(FOREGROUND_EVENT, (event) => seen.push((event as CustomEvent<{ active: boolean }>).detail.active))
    host = await createFakeHost()
    host.emit('lifecycle', { state: 'background' })
    host.emit('lifecycle', { state: 'active' })
    host.emit('lifecycle', { state: 'unknown' })
    await host.settle()
    expect(seen).toEqual([false, true])
  })

  it('a 60 s background followed by a return does not count as foreground time', async () => {
    const target = new EventTarget()
    ;(globalThis as { window?: unknown }).window = target
    host = await createFakeHost()
    // The store's own foreground clock, fed by the same event the bridge sends.
    const { foregroundNow, setClock, setForegroundSource } = await import('../../../hooks/reader/readerOpeningStore')
    let now = 0
    setClock(() => now)
    setForegroundSource((onChange) => {
      const handler = (event: Event) => onChange((event as CustomEvent<{ active: boolean }>).detail.active)
      target.addEventListener(FOREGROUND_EVENT, handler)
      return () => target.removeEventListener(FOREGROUND_EVENT, handler)
    })
    const start = foregroundNow()
    now += 1_000
    host.emit('lifecycle', { state: 'background' })
    await host.settle()
    now += 60_000
    host.emit('lifecycle', { state: 'active' })
    await host.settle()
    now += 500
    expect(foregroundNow() - start).toBe(1_500)
  })
})
