import { Location } from './location.js';

export interface ReadingSessionStateProps {
  bookId: string;
  lastReadLocation: Location;
  /** Approximate position indicator for UI (0–100); not "must finish the book". */
  percent: number;
  /** Human-readable last-read label for Library / Continue Reading (FR-10). */
  lastReadLabel?: string;

  // Typography (per-book)
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  textAlign?: string;

  // Layout & page turn (per-book)
  layoutMode?: string;
  pageTurnMode?: string;
  marginsEnabled?: boolean;
  marginPreset?: string;

  isLandscape?: boolean;
  updatedAt: string;
}

/**
 * Per-book last reading session: resume location + display settings (SDS §3).
 * 1–1 with Book. Does not imply sequential or complete reading.
 */
export class ReadingSessionState {
  readonly bookId: string;
  lastReadLocation: Location;
  percent: number;
  /** Display label (chapter/page); persisted beside Location in session JSON. */
  lastReadLabel?: string;

  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  textAlign?: string;

  layoutMode?: string;
  pageTurnMode?: string;
  marginsEnabled?: boolean;
  marginPreset?: string;

  isLandscape: boolean;
  updatedAt: string;

  constructor(props: ReadingSessionStateProps) {
    this.bookId = props.bookId;
    this.lastReadLocation = props.lastReadLocation;
    this.percent = ReadingSessionState.clampPercent(props.percent);
    this.lastReadLabel = ReadingSessionState.normalizeLabel(props.lastReadLabel);
    this.fontFamily = props.fontFamily;
    this.fontSize = props.fontSize;
    this.fontWeight = props.fontWeight;
    this.lineHeight = props.lineHeight;
    this.textAlign = props.textAlign;
    this.layoutMode = props.layoutMode;
    this.pageTurnMode = props.pageTurnMode;
    this.marginsEnabled = props.marginsEnabled;
    this.marginPreset = props.marginPreset;
    this.isLandscape = props.isLandscape ?? false;
    this.updatedAt = props.updatedAt;
  }

  static clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  static normalizeLabel(label?: string): string | undefined {
    const trimmed = label?.trim();
    return trimmed ? trimmed : undefined;
  }

  updateLocation(
    location: Location,
    percent: number,
    label?: string,
    now = new Date().toISOString(),
  ): void {
    this.lastReadLocation = location;
    this.percent = ReadingSessionState.clampPercent(percent);
    if (label !== undefined) {
      this.lastReadLabel = ReadingSessionState.normalizeLabel(label);
    }
    this.updatedAt = now;
  }

  applySettings(partial: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    lineHeight?: number;
    textAlign?: string;
    layoutMode?: string;
    pageTurnMode?: string;
    marginsEnabled?: boolean;
    marginPreset?: string;
    isLandscape?: boolean;
  }, now = new Date().toISOString()): void {
    if (partial.fontFamily !== undefined) this.fontFamily = partial.fontFamily;
    if (partial.fontSize !== undefined) this.fontSize = partial.fontSize;
    if (partial.fontWeight !== undefined) this.fontWeight = partial.fontWeight;
    if (partial.lineHeight !== undefined) this.lineHeight = partial.lineHeight;
    if (partial.textAlign !== undefined) this.textAlign = partial.textAlign;
    if (partial.layoutMode !== undefined) this.layoutMode = partial.layoutMode;
    if (partial.pageTurnMode !== undefined) this.pageTurnMode = partial.pageTurnMode;
    if (partial.marginsEnabled !== undefined) this.marginsEnabled = partial.marginsEnabled;
    if (partial.marginPreset !== undefined) this.marginPreset = partial.marginPreset;
    if (partial.isLandscape !== undefined) this.isLandscape = partial.isLandscape;
    this.updatedAt = now;
  }

  /** UI helper when percent estimate reaches the end — not a requirement to finish. */
  hasReachedEnd(): boolean {
    return this.percent >= 100;
  }
}
