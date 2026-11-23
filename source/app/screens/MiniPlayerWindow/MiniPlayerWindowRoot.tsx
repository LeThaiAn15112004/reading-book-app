import { MiniPlayerWindow } from './MiniPlayerWindow'

/**
 * Spec 018 (research R4): the floating mini player window's whole React tree. `main.tsx` mounts it INSTEAD of `App` in
 * that window — no router, no providers, no ShortcutsBridge / SessionFlushBridge / import queue / mini player sync, and
 * nothing that would use `window.api` (that window does not have it).
 */
export function MiniPlayerWindowRoot() {
  return <MiniPlayerWindow />
}
