import { Location } from './location.js';

export interface ReadingSessionStateProps {
  bookId: string;
  lastReadLocation: Location;
  /** Approximate position indicator for UI (0–100); not "must finish the book". */
  percent: number;
  bgColor: string;
  textColor: string;
  fontSize: number;
  fontFamily?: string;
  lineHeight?: number;
  themePreset?: string;
  isLandscape?: boolean;
  updatedAt: string;
}

/**
 * Per-book last reading session: resume location + visual settings (SDS §3).
 * 1–1 with Book. Does not imply sequential or complete reading.
 */
export class ReadingSessionState {
  readonly bookId: string;
  lastReadLocation: Location;
  percent: number;
  bgColor: string;
  textColor: string;
  fontSize: number;
  fontFamily?: string;
  lineHeight?: number;
  themePreset?: string;
  isLandscape: boolean;
  updatedAt: string;

  constructor(props: ReadingSessionStateProps) {
    this.bookId = props.bookId;
    this.lastReadLocation = props.lastReadLocation;
    this.percent = ReadingSessionState.clampPercent(props.percent);
    this.bgColor = props.bgColor;
    this.textColor = props.textColor;
    this.fontSize = props.fontSize;
    this.fontFamily = props.fontFamily;
    this.lineHeight = props.lineHeight;
    this.themePreset = props.themePreset;
    this.isLandscape = props.isLandscape ?? false;
    this.updatedAt = props.updatedAt;
  }

  static clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  updateLocation(location: Location, percent: number, now = new Date().toISOString()): void {
    this.lastReadLocation = location;
    this.percent = ReadingSessionState.clampPercent(percent);
    this.updatedAt = now;
  }

  applyTheme(partial: {
    bgColor?: string;
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    themePreset?: string;
    isLandscape?: boolean;
  }, now = new Date().toISOString()): void {
    if (partial.bgColor !== undefined) this.bgColor = partial.bgColor;
    if (partial.textColor !== undefined) this.textColor = partial.textColor;
    if (partial.fontSize !== undefined) this.fontSize = partial.fontSize;
    if (partial.fontFamily !== undefined) this.fontFamily = partial.fontFamily;
    if (partial.lineHeight !== undefined) this.lineHeight = partial.lineHeight;
    if (partial.themePreset !== undefined) this.themePreset = partial.themePreset;
    if (partial.isLandscape !== undefined) this.isLandscape = partial.isLandscape;
    this.updatedAt = now;
  }

  /** UI helper when percent estimate reaches the end — not a requirement to finish. */
  hasReachedEnd(): boolean {
    return this.percent >= 100;
  }
}
