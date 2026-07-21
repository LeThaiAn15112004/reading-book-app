import { AppTheme } from '@reading-book/domain';

export type ThemeTokenName = '--bg' | '--text' | '--accent';
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

/** App chrome theme tokens stub (Design §4 / T0.3). CSS mapping is T0.12. */
export const THEME_TOKENS: Readonly<Record<AppTheme, ThemeTokens>> = {
  [AppTheme.Day]: {
    '--bg': '#FDFBF7',
    '--text': '#2D2D2D',
    '--accent': '#4A90E2',
  },
  [AppTheme.Sepia]: {
    '--bg': '#F4ECD8',
    '--text': '#2D2D2D',
    '--accent': '#4A90E2',
  },
  [AppTheme.Night]: {
    '--bg': '#1A1A1A',
    '--text': '#E8E6E3',
    '--accent': '#4A90E2',
  },
};

export function getThemeTokens(theme: AppTheme): ThemeTokens {
  return THEME_TOKENS[theme];
}
