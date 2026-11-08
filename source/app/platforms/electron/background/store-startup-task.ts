import { spawn } from 'node:child_process'
import path from 'node:path'
import type { StartAtLoginDto } from '../ipc/api-types'
import { startAtLoginFromOutput, startupTaskOperation } from './startup-task-core.mjs'

/**
 * Spec 010 T031 (contracts/packaged-runtime.md "Start at Login", research R5). Start at Login of the Microsoft Store
 * build is the package's startup task (TaskId ReadmateReaderStartup, store/appx-extensions.xml), not a login item:
 * `app.setLoginItemSettings` does not work for packaged apps. Its state is read and changed by a short-lived Windows
 * PowerShell child running the checked-in `store/startup-task.ps1` (a child of a packaged app keeps the package
 * identity). argv array, no shell, fixed script, no user input. Never overrides a task the user turned off in
 * Windows Settings → Startup, or one set by policy (FR-007).
 */
const TIMEOUT_MS = 10_000

function scriptPath(): string {
  return path.join(process.resourcesPath, 'store', 'startup-task.ps1')
}

function runBridge(op: 'get' | 'enable' | 'disable'): Promise<StartAtLoginDto> {
  return new Promise((resolve) => {
    let stdout = ''
    let settled = false
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(startAtLoginFromOutput(stdout, code))
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), op],
        { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (err) {
      console.error('Start at Login: the startup-task bridge could not be started:', err)
      resolve(startAtLoginFromOutput('', null))
      return
    }
    const timer = setTimeout(() => {
      console.error(`Start at Login: the startup-task bridge did not answer within ${TIMEOUT_MS} ms (${op})`)
      child.kill()
      finish(null)
    }, TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', (err) => {
      console.error('Start at Login: the startup-task bridge failed:', err)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

export function getStoreStartAtLogin(): Promise<StartAtLoginDto> {
  return runBridge('get')
}

export async function setStoreStartAtLogin(enabled: boolean): Promise<StartAtLoginDto> {
  const current = await runBridge('get')
  const op = startupTaskOperation(current, enabled)
  return op ? runBridge(op) : current
}
