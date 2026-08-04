import { AppTheme } from '@reading-book/domain';

export type ThemeTokenName = '--bg' | '--text' | '--accent';
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

/** Legacy AppTheme mapping aligned with Reader BR-05 presets. */
export const THEME_TOKENS: Readonly<Record<AppTheme, ThemeTokens>> = {
  [AppTheme.Day]: {
    '--bg': '#f8fafc',
    '--text': '#334155',
    '--accent': '#d97706',
  },
  [AppTheme.Sepia]: {
    '--bg': '#16120e',
    '--text': '#e1cfb3',
    '--accent': '#f59e0b',
  },
  [AppTheme.Night]: {
    '--bg': '#0f172a',
    '--text': '#cbd5e1',
    '--accent': '#f59e0b',
  },
};

export function getThemeTokens(theme: AppTheme): ThemeTokens {
  return THEME_TOKENS[theme];
}
