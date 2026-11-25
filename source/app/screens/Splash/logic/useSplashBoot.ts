import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { bootErrorMessage, sleep, withTimeout } from '@core'
import type { BootLocationState } from '../../boot'
import { getT } from '../../../i18n'
import { isMobileHost } from '../../../platforms/host'
import { INIT_TIMEOUT_MS, MIN_BRAND_MS, probeReady } from './splashBoot'

/** SCR-00 boot gate — probe Main IPC then navigate to Library. */
export function useSplashBoot() {
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const probe = withTimeout(probeReady(), INIT_TIMEOUT_MS, 'Init').then(
        (): string | undefined => undefined,
        (err: unknown): string => {
          console.error('[splash] init probe failed', err)
          return bootErrorMessage(err, getT()('library.boot.fallback'))
        },
      )

      // The phone keeps its system splash up until the Library is drawn (`announceUiReady`): no second brand delay.
      const [bootError] = await Promise.all([probe, sleep(isMobileHost() ? 0 : MIN_BRAND_MS)])

      if (cancelled) return

      const state: BootLocationState | undefined = bootError
        ? { bootError }
        : undefined
      navigate('/library', { replace: true, state })
    })()

    return () => {
      cancelled = true
    }
  }, [navigate])
}
