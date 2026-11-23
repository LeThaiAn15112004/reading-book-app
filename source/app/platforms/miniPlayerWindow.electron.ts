/**
 * Platform adapter `miniPlayerWindow`, Desktop renderer (spec 018, research R4). The ONLY file that reads
 * `window.miniPlayerWindow` — the floating mini player window's preload API (that window has no `window.api`).
 */
import type { MiniPlayerCommandDto, MiniPlayerStateDto, MiniPlayerWindowApi } from './electron/ipc/api-types'

declare global {
  interface Window {
    miniPlayerWindow?: MiniPlayerWindowApi
  }
}

/** True in the floating window (loaded with `?window=mini-player` and given its own preload API). */
export function isMiniPlayerWindow(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('window') === 'mini-player' &&
    window.miniPlayerWindow !== undefined
  )
}

export const miniPlayerWindowHost = {
  onState(handler: (state: MiniPlayerStateDto | null) => void): () => void {
    return window.miniPlayerWindow?.onState(handler) ?? (() => {})
  },
  command(command: MiniPlayerCommandDto): void {
    window.miniPlayerWindow?.command(command)
  },
  returnToApp(): void {
    window.miniPlayerWindow?.returnToApp()
  },
  close(): void {
    window.miniPlayerWindow?.close()
  },
  minimize(): void {
    window.miniPlayerWindow?.minimize()
  },
}
