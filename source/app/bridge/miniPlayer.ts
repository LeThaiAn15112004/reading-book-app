/** Typed wrappers for miniPlayer:* IPC via api (spec 018, contracts/mini-player-ipc.md). Desktop only. */

import { api } from '../platforms/api'

export type MiniPlayerState = Parameters<typeof api.miniPlayer.publishState>[0]
export type MiniPlayerCommand = Parameters<Parameters<typeof api.miniPlayer.onCommand>[0]>[0]
export type MiniPlayerPrefs = Awaited<ReturnType<typeof api.miniPlayer.getPrefs>>

export const miniPlayerApi = {
  publishState: (state: MiniPlayerState) => api.miniPlayer.publishState(state),
  open: () => api.miniPlayer.open(),
  getPrefs: () => api.miniPlayer.getPrefs(),
  setPrefs: (patch: Partial<MiniPlayerPrefs>) => api.miniPlayer.setPrefs(patch),
  onCommand: (handler: (command: MiniPlayerCommand) => void) => api.miniPlayer.onCommand(handler),
  onWindowChanged: (handler: (change: { open: boolean }) => void) => api.miniPlayer.onWindowChanged(handler),
}
