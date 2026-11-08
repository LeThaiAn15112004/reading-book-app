// Types of startup-task-core.mjs (the Desktop tsconfig has no allowJs).
import type { StartAtLoginDto, StartAtLoginState } from '../ipc/api-types'

export const MANAGED_BY_WINDOWS: Readonly<StartAtLoginDto>

export function startAtLoginFromOutput(stdout: string, exitCode: number | null): StartAtLoginDto

export function canChangeStartAtLogin(state: StartAtLoginState | undefined): boolean

export function startupTaskOperation(current: StartAtLoginDto, enabled: boolean): 'enable' | 'disable' | null
