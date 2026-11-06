import { create } from 'zustand'

export type SnapshotPoint = { x: number; y: number }

type SnapshotState = {
  /** True while the crosshair region-select overlay is armed (see `SnapshotOverlay`). */
  active: boolean
  /** Set on pointerdown, in viewport CSS px; null when not currently dragging. */
  start: SnapshotPoint | null
  /** Live pointer position while dragging, same coordinate space as `start`. */
  current: SnapshotPoint | null
  /** True once a drag has ended and the region is being cropped/copied — blocks re-arming. */
  capturing: boolean

  activate: () => void
  deactivate: () => void
  beginDrag: (point: SnapshotPoint) => void
  updateDrag: (point: SnapshotPoint) => void
  clearDrag: () => void
  setCapturing: (value: boolean) => void
}

/**
 * Foxit-style Snapshot tool: state for the crosshair region-select overlay driven by
 * `useSnapshotTool`. One Reader route is mounted at a time, so one shared store is safe, same as
 * `useBookSearchStore`.
 */
export const useSnapshotStore = create<SnapshotState>()((set) => ({
  active: false,
  start: null,
  current: null,
  capturing: false,

  activate: () => set({ active: true, start: null, current: null, capturing: false }),
  deactivate: () => set({ active: false, start: null, current: null, capturing: false }),
  beginDrag: (point) => set({ start: point, current: point }),
  updateDrag: (point) => set({ current: point }),
  clearDrag: () => set({ start: null, current: null }),
  setCapturing: (value) => set({ capturing: value }),
}))
