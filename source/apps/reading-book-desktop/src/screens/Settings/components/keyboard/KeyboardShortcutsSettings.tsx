import { useEffect, useState } from 'react'
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  effectiveShortcutKeys,
  formatShortcutKey,
  getShortcut,
  shortcutKeysFromEvent,
  useShortcutsStore,
  type ShortcutDefinition,
  type ShortcutKeys,
} from '../../../../shortcuts'
import { SettingsCard } from '../layout/SettingsCard'

/** Rejected attempt shown while the row keeps listening: the keys pressed and why they were refused. */
type Attempt = { keys: ShortcutKeys; message: string }

function KeyCaps({ keys }: { keys: ShortcutKeys }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <span className="text-[11px] opacity-60">+</span> : null}
          <span className="inline-flex h-5 min-w-5 items-center justify-center px-0.5 text-[12px] font-semibold">
            {formatShortcutKey(key)}
          </span>
        </span>
      ))}
    </span>
  )
}

const CHIP_BASE =
  'inline-flex h-8 min-w-24 cursor-pointer items-center justify-center rounded-lg border px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent'
const CHIP_IDLE =
  'border-lib-border bg-lib-chip text-lib-text-strong hover:border-lib-accent hover:bg-lib-accent-soft hover:text-lib-accent focus-visible:border-lib-accent'
const CHIP_RECORDING = 'border-lib-accent bg-lib-accent-soft text-lib-accent'
const CHIP_ERROR = 'border-red-400/40 bg-red-500/10 text-red-400'

function ShortcutRow({ shortcut }: { shortcut: ShortcutDefinition }) {
  const overrides = useShortcutsStore((s) => s.overrides)
  const recording = useShortcutsStore((s) => s.recordingId === shortcut.id)
  const setRecording = useShortcutsStore((s) => s.setRecording)
  const tryAssign = useShortcutsStore((s) => s.tryAssign)
  const resetOne = useShortcutsStore((s) => s.resetOne)
  const [attempt, setAttempt] = useState<Attempt | null>(null)

  const keys = effectiveShortcutKeys(overrides)[shortcut.id]
  const changed = shortcut.id in overrides

  function stopRecording() {
    setRecording(null)
    setAttempt(null)
  }

  useEffect(() => {
    if (!recording) return
    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setRecording(null)
        setAttempt(null)
        return
      }
      const pressed = shortcutKeysFromEvent(event)
      if (!pressed) return // modifier on its own — keep waiting for the main key
      const result = tryAssign(shortcut.id, pressed)
      if (result.ok) {
        setRecording(null)
        setAttempt(null)
      } else if (result.reason === 'conflict') {
        setAttempt({
          keys: pressed,
          message: `Already assigned to ${getShortcut(result.conflictWith).label}.`,
        })
      } else {
        setAttempt({ keys: pressed, message: result.message })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, shortcut.id, setRecording, tryAssign])

  function toggleRecording() {
    if (recording) stopRecording()
    else {
      setAttempt(null)
      setRecording(shortcut.id)
    }
  }

  const chipClass = !recording ? CHIP_IDLE : attempt ? CHIP_ERROR : CHIP_RECORDING

  return (
    <li className="px-3 py-1.5">
      <div className="flex min-h-[calc(var(--ui-density-row)-12px)] items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate font-medium text-lib-text-strong">{shortcut.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {changed && !recording ? (
            <button
              type="button"
              onClick={() => resetOne(shortcut.id)}
              aria-label={`Reset ${shortcut.label} to default`}
              className="cursor-pointer rounded-md border-none bg-transparent px-1.5 py-1 text-[12px] font-medium text-lib-muted transition-colors hover:text-lib-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleRecording}
            onBlur={() => {
              if (recording) stopRecording()
            }}
            aria-label={
              recording
                ? `Recording a new shortcut for ${shortcut.label}. Press Escape to cancel.`
                : `${shortcut.label}: change shortcut`
            }
            className={`${CHIP_BASE} ${chipClass}`}
          >
            {recording && !attempt ? (
              <span className="font-medium">Press a shortcut…</span>
            ) : (
              <KeyCaps keys={attempt ? attempt.keys : keys} />
            )}
          </button>
        </span>
      </div>
      {attempt ? (
        <p role="alert" className="m-0 mt-1 text-right text-[12px] text-red-400">
          ⚠ {attempt.message}
        </p>
      ) : null}
    </li>
  )
}

/**
 * SCR-06 Settings → Keyboard Shortcuts: click a shortcut to record a new one. A combination that is
 * already used by another action active on the same screen is refused (see `shortcutConflicts`).
 */
export function KeyboardShortcutsSettings() {
  const hasOverrides = useShortcutsStore((s) => Object.keys(s.overrides).length > 0)
  const reset = useShortcutsStore((s) => s.reset)

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-[13px] text-lib-muted">Click a shortcut, then press the new keys.</p>
        <button
          type="button"
          disabled={!hasOverrides}
          onClick={() => reset()}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:text-lib-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-lib-border disabled:hover:text-lib-text-strong"
        >
          Reset to Defaults
        </button>
      </div>
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsCard key={group.id} title={group.label}>
          <ul
            className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0"
            aria-label={`${group.label} shortcuts`}
          >
            {SHORTCUTS.filter((s) => s.group === group.id).map((shortcut) => (
              <ShortcutRow key={shortcut.id} shortcut={shortcut} />
            ))}
          </ul>
        </SettingsCard>
      ))}
    </div>
  )
}
