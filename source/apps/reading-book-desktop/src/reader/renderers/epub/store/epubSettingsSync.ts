import { createStore } from 'zustand/vanilla'
import type {
  FontFamily,
  FontWeight,
  ReaderTheme,
  TextAlign,
} from '@reading-book/book-reader-sdk'
import type {
  EpubjsHandle,
  EpubPageLayout,
  EpubSettingsPatch,
  EpubViewMode,
} from '../openEpubjs'

/** Every reader-appearance value that can change without re-opening the book. */
export type EpubAppearanceSettings = {
  theme: ReaderTheme
  layout: EpubPageLayout
  viewMode: EpubViewMode
  fontSize: number
  fontFamily: FontFamily
  fontWeight: FontWeight
  lineHeight: number
  textAlign: TextAlign
  marginsEnabled: boolean
  marginPreset: string
  chromeHidden: boolean
}

/** Trailing-coalesce window for bursty sources (the Aa sliders). */
const COALESCE_MS = 150

type EpubSettingsSyncState = {
  handle: EpubjsHandle | null
  enabled: boolean
  onApplied: (() => void) | null
  /** Last appearance known to be live in the rendition. */
  baseline: EpubAppearanceSettings | null
  /** Latest appearance requested by props. */
  desired: EpubAppearanceSettings | null
  timerId: ReturnType<typeof setTimeout> | null
  lastAppliedAt: number
}

/**
 * Plain Zustand vanilla store -- no React binding.
 *
 * EpubRenderer never reads this store to render anything, so there is
 * nothing here for useStore/useSyncExternalStore to subscribe to. It only
 * exists to hold the bookkeeping (baseline, pending timer, last-applied time)
 * that the nine now-removed per-setting effects used to keep in individual
 * useRefs, and to give the apply logic below a single place to read/write
 * it instead of a useCallback per concern.
 */
const store = createStore<EpubSettingsSyncState>()(() => ({
  handle: null,
  enabled: false,
  onApplied: null,
  baseline: null,
  desired: null,
  timerId: null,
  lastAppliedAt: 0,
}))

function diffSettings(
  baseline: EpubAppearanceSettings,
  next: EpubAppearanceSettings,
): EpubSettingsPatch | null {
  const patch: EpubSettingsPatch = {}
  let changed = false

  if (next.theme !== baseline.theme) {
    patch.theme = next.theme
    changed = true
  }
  if (next.layout !== baseline.layout) {
    patch.layout = next.layout
    changed = true
  }
  if (next.viewMode !== baseline.viewMode) {
    patch.viewMode = next.viewMode
    changed = true
  }
  if (next.fontSize !== baseline.fontSize) {
    patch.fontSize = next.fontSize
    changed = true
  }
  if (next.fontFamily !== baseline.fontFamily) {
    patch.fontFamily = next.fontFamily
    changed = true
  }
  if (next.fontWeight !== baseline.fontWeight) {
    patch.fontWeight = next.fontWeight
    changed = true
  }
  if (next.lineHeight !== baseline.lineHeight) {
    patch.lineHeight = next.lineHeight
    changed = true
  }
  if (next.textAlign !== baseline.textAlign) {
    patch.textAlign = next.textAlign
    changed = true
  }
  if (next.marginsEnabled !== baseline.marginsEnabled) {
    patch.marginsEnabled = next.marginsEnabled
    changed = true
  }
  if (next.marginPreset !== baseline.marginPreset) {
    patch.marginPreset = next.marginPreset
    changed = true
  }
  if (next.chromeHidden !== baseline.chromeHidden) {
    patch.chromeHidden = next.chromeHidden
    changed = true
  }

  return changed ? patch : null
}

function clearPendingTimer(): void {
  const { timerId } = store.getState()
  if (timerId != null) {
    clearTimeout(timerId)
    store.setState({ timerId: null })
  }
}

/** Diff `desired` against `baseline` and, if anything changed, apply once. */
function applyNow(): void {
  clearPendingTimer()

  const { handle, baseline, desired, onApplied } = store.getState()
  if (!handle || !baseline || !desired) return

  const patch = diffSettings(baseline, desired)
  if (!patch) return

  let applied = false
  try {
    // `applySettings` already guards a destroyed/aborted handle internally
    // and returns false rather than throwing -- this catch is for the
    // unexpected case (a malformed handle, a third-party throw inside
    // epubjs) so one bad tick can never take the reader down.
    applied = handle.applySettings(patch) !== false
  } catch (err) {
    console.warn('[epub settings] apply failed', err)
    applied = false
  }

  if (!applied) {
    // Baseline stays as-is so the same patch is retried on the next call to
    // syncEpubAppearance (props change) instead of being silently dropped.
    return
  }

  store.setState({ baseline: desired, lastAppliedAt: Date.now() })

  try {
    onApplied?.()
  } catch (err) {
    console.warn('[epub settings] post-apply repaint failed', err)
  }
}

/**
 * Push the latest appearance props into the sync store and apply the diff.
 *
 * Called directly from EpubRenderer's render body -- every render, not from
 * an effect. It replaces the nine `useEffect(() => { handle.setX(x); ... })`
 * blocks that used to run once per changed prop; here a render that touches
 * several appearance props still costs exactly one applySettings call.
 *
 * Safe to call with the same values repeatedly (including React 18
 * StrictMode's double-invoked dev render): every call re-diffs against the
 * current baseline, so a repeat with nothing new is a no-op.
 */
export function syncEpubAppearance(input: {
  handle: EpubjsHandle | null
  enabled: boolean
  onApplied?: () => void
  settings: EpubAppearanceSettings
}): void {
  const state = store.getState()
  const onApplied = input.onApplied ?? null
  if (
    state.handle !== input.handle ||
    state.enabled !== input.enabled ||
    state.onApplied !== onApplied
  ) {
    store.setState({ handle: input.handle, enabled: input.enabled, onApplied })
  }

  if (!input.enabled) {
    // Opening/erroring -- record the desired value but hold off applying;
    // flushEpubSettingsNow() drains it once the handle is ready.
    store.setState({ desired: input.settings })
    return
  }

  const baseline = store.getState().baseline
  if (baseline == null) {
    // First `ready` pass: openEpubjs already opened with these exact
    // values, so they are the baseline -- nothing to apply yet.
    store.setState({ desired: input.settings, baseline: input.settings })
    return
  }

  store.setState({ desired: input.settings })

  if (!diffSettings(baseline, input.settings)) return

  const sinceLast = Date.now() - store.getState().lastAppliedAt
  if (sinceLast >= COALESCE_MS) {
    // Idle: apply now so a discrete change (theme, layout, a margin toggle)
    // feels instant.
    applyNow()
    return
  }

  // Mid-burst (slider drag): a timer is already pending -- it will read
  // whatever `desired` holds when it fires, so nothing more to schedule.
  if (store.getState().timerId != null) return
  const id = setTimeout(applyNow, COALESCE_MS - sinceLast)
  store.setState({ timerId: id })
}

/**
 * Mark `settings` as already live -- call this where the book is (re)opened,
 * since openEpubjs receives these same values directly.
 */
export function resetEpubSettingsBaseline(settings: EpubAppearanceSettings): void {
  clearPendingTimer()
  store.setState({ baseline: settings, desired: settings })
}

/** Drain any pending diff immediately -- call once the handle exists, in case
 * a setting changed while the book was still opening. */
export function flushEpubSettingsNow(): void {
  applyNow()
}

/** Clear timers and forget the handle -- call from the open effect's cleanup. */
export function disposeEpubSettingsSync(): void {
  clearPendingTimer()
  store.setState({
    handle: null,
    enabled: false,
    onApplied: null,
    baseline: null,
    desired: null,
    lastAppliedAt: 0,
  })
}
