import {
  toAppThemeAttr,
  type ReaderTheme,
} from '@reading-book/shared/models'
import { appApi } from '../bridge/app'

/** App chrome theme ids (Night / Sepia / Paper). */
export type AppThemeId = ReaderTheme

/** Sets shell theme via CSS variables on `<html data-theme>` (NFR-03). */
export function applyTheme(theme: string): void {
  const id = toAppThemeAttr(theme)
  document.documentElement.dataset.theme = id
  // Native minimize / maximize / close (Electron titleBarOverlay).
  void appApi.setChromeTheme(id).catch(() => {
    // Not in Electron (or preload not ready yet).
  })
}
