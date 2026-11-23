import type { MiniPlayerCommandDto, MiniPlayerPrefsDto, MiniPlayerStateDto } from '../ipc/api-types'

/**
 * Spec 018 (contracts/mini-player-ipc.md "Main rules"): the pure rules of the mini player in Main — validation of what
 * the renderers send, when the floating window opens / closes by itself, and where it may appear. No Electron import,
 * so `spike:audio:mini-player` runs them directly.
 */

export const MINI_PLAYER_WINDOW_SIZE = { width: 360, height: 132 } as const
export const MINI_PLAYER_MARGIN_PX = 24
export const MAX_TEXT_LENGTH = 500

export const DEFAULT_MINI_PLAYER_PREFS: MiniPlayerPrefsDto = { autoOpen: true }

export type StoredMiniPlayerPrefs = MiniPlayerPrefsDto & { x: number | null; y: number | null }

export const DEFAULT_STORED_MINI_PLAYER_PREFS: StoredMiniPlayerPrefs = { ...DEFAULT_MINI_PLAYER_PREFS, x: null, y: null }

export function normalizeMiniPlayerPrefs(raw: unknown): StoredMiniPlayerPrefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const coord = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
  return {
    autoOpen: typeof o.autoOpen === 'boolean' ? o.autoOpen : DEFAULT_MINI_PLAYER_PREFS.autoOpen,
    x: coord(o.x),
    y: coord(o.y),
  }
}

function text(v: unknown, nullable: true): string | null | undefined
function text(v: unknown, nullable: false): string | undefined
function text(v: unknown, nullable: boolean): string | null | undefined {
  if (v === null && nullable) return null
  if (typeof v !== 'string' || v.length > MAX_TEXT_LENGTH) return undefined
  return v
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The renderer's state snapshot, or `undefined` when anything is malformed (it is then dropped whole). */
export function validateMiniPlayerState(input: unknown): MiniPlayerStateDto | null | undefined {
  if (input === null) return null
  if (typeof input !== 'object') return undefined
  const o = input as Record<string, unknown>
  const bookId = text(o.bookId, false)
  const title = text(o.title, false)
  const subtitle = text(o.subtitle, true)
  const author = text(o.author, true)
  const coverUrl = o.coverUrl === null ? null : typeof o.coverUrl === 'string' && o.coverUrl.startsWith('rb-cover://') && o.coverUrl.length <= 2048 ? o.coverUrl : undefined
  if (!bookId || title === undefined || subtitle === undefined || author === undefined || coverUrl === undefined) return undefined
  if (typeof o.playing !== 'boolean' || typeof o.canPrevious !== 'boolean' || typeof o.canNext !== 'boolean') return undefined
  if (o.status !== 'ready' && o.status !== 'switching' && o.status !== 'trackFailed') return undefined
  if (!finite(o.positionSeconds) || o.positionSeconds < 0) return undefined
  if (o.durationSeconds !== null && (!finite(o.durationSeconds) || o.durationSeconds < 0)) return undefined
  if (!finite(o.skipBackSeconds) || !finite(o.skipForwardSeconds)) return undefined
  if (o.theme !== 'night' && o.theme !== 'sepia' && o.theme !== 'paper') return undefined
  if (o.uiLanguage !== 'en' && o.uiLanguage !== 'vi') return undefined
  return {
    bookId,
    title,
    subtitle,
    author,
    coverUrl,
    playing: o.playing,
    status: o.status,
    positionSeconds: o.positionSeconds,
    durationSeconds: o.durationSeconds as number | null,
    skipBackSeconds: o.skipBackSeconds,
    skipForwardSeconds: o.skipForwardSeconds,
    canPrevious: o.canPrevious,
    canNext: o.canNext,
    theme: o.theme,
    uiLanguage: o.uiLanguage,
  }
}

const SIMPLE_COMMANDS = new Set(['toggle', 'play', 'pause', 'skipBack', 'skipForward', 'previous', 'next', 'retryTrack', 'openPlayer', 'endSession'])

/** A command from the floating window / tray, or `null` when malformed. */
export function validateMiniPlayerCommand(input: unknown): MiniPlayerCommandDto | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  if (o.type === 'seek') return finite(o.positionSeconds) && o.positionSeconds >= 0 ? { type: 'seek', positionSeconds: o.positionSeconds } : null
  return typeof o.type === 'string' && SIMPLE_COMMANDS.has(o.type) ? ({ type: o.type } as MiniPlayerCommandDto) : null
}

/** Session-only flags Main keeps (never stored). */
export type MiniPlayerFlags = {
  sessionActive: boolean
  windowOpen: boolean
  openedAutomatically: boolean
  /** The listener closed the floating window during this session: it does not reopen by itself. */
  closedByUserThisSession: boolean
}

export const INITIAL_FLAGS: MiniPlayerFlags = {
  sessionActive: false,
  windowOpen: false,
  openedAutomatically: false,
  closedByUserThisSession: false,
}

/** FR-025: the main window was minimised or hidden — open the floating window by itself? */
export function shouldAutoOpen(flags: MiniPlayerFlags, prefs: MiniPlayerPrefsDto): boolean {
  return flags.sessionActive && prefs.autoOpen && !flags.closedByUserThisSession && !flags.windowOpen
}

/** FR-025: the main window is shown again — close the floating window only if it opened by itself. */
export function shouldAutoClose(flags: MiniPlayerFlags): boolean {
  return flags.windowOpen && flags.openedAutomatically
}

/** A new state arrived: a new book (or no session) starts the "closed by the user" rule afresh. */
export function flagsForState(flags: MiniPlayerFlags, previousBookId: string | null, state: MiniPlayerStateDto | null): MiniPlayerFlags {
  if (state === null) return { ...flags, sessionActive: false, closedByUserThisSession: false }
  const newSession = previousBookId !== state.bookId
  return { ...flags, sessionActive: true, closedByUserThisSession: newSession ? false : flags.closedByUserThisSession }
}

export type WorkArea = { x: number; y: number; width: number; height: number }

/**
 * Where the floating window opens: the saved point when the whole window fits on a display's work area, else the
 * nearest visible position on the display closest to it (a monitor was disconnected), else bottom-right of `primary`.
 */
export function visiblePosition(
  saved: { x: number | null; y: number | null },
  areas: readonly WorkArea[],
  primary: WorkArea,
  size: { width: number; height: number } = MINI_PLAYER_WINDOW_SIZE,
): { x: number; y: number } {
  const fallback = {
    x: primary.x + primary.width - size.width - MINI_PLAYER_MARGIN_PX,
    y: primary.y + primary.height - size.height - MINI_PLAYER_MARGIN_PX,
  }
  if (saved.x === null || saved.y === null || areas.length === 0) return fallback
  const { x, y } = saved
  const fits = (a: WorkArea) => x >= a.x && y >= a.y && x + size.width <= a.x + a.width && y + size.height <= a.y + a.height
  if (areas.some(fits)) return { x, y }
  const centre = (a: WorkArea) => ({ cx: a.x + a.width / 2, cy: a.y + a.height / 2 })
  const nearest = [...areas].sort((a, b) => {
    const da = Math.hypot(centre(a).cx - x, centre(a).cy - y)
    const db = Math.hypot(centre(b).cx - x, centre(b).cy - y)
    return da - db
  })[0] as WorkArea
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
  return {
    x: clamp(x, nearest.x, nearest.x + nearest.width - size.width),
    y: clamp(y, nearest.y, nearest.y + nearest.height - size.height),
  }
}

/** The tray's audiobook entry, or `null` (no session). Rebuilt only when this changes (not on position ticks). */
export function trayEntryFor(state: MiniPlayerStateDto | null): { title: string; playing: boolean } | null {
  return state ? { title: state.title, playing: state.playing } : null
}
