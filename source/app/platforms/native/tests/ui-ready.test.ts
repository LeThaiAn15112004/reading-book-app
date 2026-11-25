/**
 * `app.uiReady` (launch flow): the host hears once that the UI drew its first real screen, so it can hide the system
 * splash screen.
 */
import { describe, expect, it, vi } from 'vitest'
import { createAppService } from '../host/app-service'

const info = { version: '1.0.0', platform: 'android' as const, osVersion: '15' }

describe('app.uiReady', () => {
  it('tells the host and answers ok', () => {
    const onUiReady = vi.fn()
    const service = createAppService({ info, openUrl: async () => {}, onUiReady })
    expect(service.uiReady()).toEqual({ ok: true })
    expect(onUiReady).toHaveBeenCalledTimes(1)
  })

  it('is harmless without a listener', () => {
    const service = createAppService({ info, openUrl: async () => {} })
    expect(service.uiReady()).toEqual({ ok: true })
  })
})
