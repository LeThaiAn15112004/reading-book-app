import {
  toAppThemeAttr,
  type ReaderTheme,
} from '@reading-book/book-reader-sdk'
import { setWindowTheme } from '../platforms/window'

/** App chrome theme ids (Night / Sepia / Paper). */
export type AppThemeId = ReaderTheme

/** Sets shell theme via CSS variables on `<html data-theme>` (NFR-03). */
export function applyTheme(theme: string): void {
  const id = toAppThemeAttr(theme)
  document.documentElement.dataset.theme = id
  // Native minimize / maximize / close on Desktop, status / navigation bars on the phone.
  void setWindowTheme(id)
}
