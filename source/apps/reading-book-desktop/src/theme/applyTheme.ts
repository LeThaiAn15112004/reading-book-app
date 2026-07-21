/** Matches `AppTheme` in `@reading-book/domain` (day | sepia | night). */
export type AppThemeId = 'day' | 'sepia' | 'night'

/** Sets shell theme via CSS variables on `<html data-theme>` (NFR-03). */
export function applyTheme(theme: AppThemeId): void {
  document.documentElement.dataset.theme = theme
}
