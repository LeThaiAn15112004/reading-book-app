import { SplashBrand, SplashSpinner } from './components'
import { useSplashBoot } from './logic'

/** SCR-00 — brand shell + boot gate; auto-navigates to Library when Main is ready. */
export function SplashScreen() {
  useSplashBoot()

  return (
    <main className="lib-chrome app-drag flex h-full w-full select-none flex-col items-center justify-center overflow-hidden">
      <SplashBrand />
      <SplashSpinner />
    </main>
  )
}
