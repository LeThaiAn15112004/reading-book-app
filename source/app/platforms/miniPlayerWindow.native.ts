/**
 * Platform adapter `miniPlayerWindow`, Mobile WebView (spec 018): the phone has no floating window — inert, same
 * exports as `miniPlayerWindow.electron.ts`.
 */
import type { MiniPlayerCommandDto, MiniPlayerStateDto } from './electron/ipc/api-types'

export function isMiniPlayerWindow(): boolean {
  return false
}

export const miniPlayerWindowHost = {
  onState(_handler: (state: MiniPlayerStateDto | null) => void): () => void {
    return () => {}
  },
  command(_command: MiniPlayerCommandDto): void {},
  returnToApp(): void {},
  close(): void {},
}
