import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { appApi } from '../../bridge'
import type { BootLocationState } from '../boot'
import { SplashBrand, SplashSpinner } from './components'

/** Min brand display so a fast boot does not flash past the splash. SDS: ~0.8–1.5s. */
const MIN_BRAND_MS = 1000

/** Max wait for Main IPC probe before leaving Splash with an error (SDS SCR-00). */
const INIT_TIMEOUT_MS = 10_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`))
    }, ms)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function probeReady(): Promise<void> {
  await appApi.ping()
  await appApi.getAppInfo()
}

function bootErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'App failed to initialize'
}

/** SCR-00 — brand shell + boot gate; auto-navigates to Library when Main is ready. */
export function SplashScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const probe = withTimeout(probeReady(), INIT_TIMEOUT_MS, 'Init').then(
        (): string | undefined => undefined,
        (err: unknown): string => {
          console.error('[splash] init probe failed', err)
          return bootErrorMessage(err)
        },
      )

      const [bootError] = await Promise.all([probe, sleep(MIN_BRAND_MS)])

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

  return (
    <main className="fixed inset-0 z-50 flex select-none flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle,#1e293b_0%,#0f172a_100%)] [-webkit-app-region:drag]">
      <SplashBrand />
      <SplashSpinner />
    </main>
  )
}
