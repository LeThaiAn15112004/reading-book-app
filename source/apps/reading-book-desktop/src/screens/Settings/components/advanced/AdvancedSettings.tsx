import { useEffect, useState } from 'react'
import type { UpdateChannel } from '../../../../bridge'
import { ConfirmBookActionDialog } from '../../../Library/components/book/ConfirmBookActionDialog'
import { resetAppSettings } from '../../logic/resetAppSettings'
import { useUpdatesStore, type UpdateCheckState } from '../../logic/updatesStore'
import { SettingsCard } from '../layout/SettingsCard'

const RESET_APP_SETTINGS_COPY =
  'Your books, reading progress, annotations, and other personal data will not be affected.'

type ResetNotice = { tone: 'success' | 'error'; text: string }

const CHANNEL_NOTE: Record<UpdateChannel, string> = {
  'mac-app-store':
    'This copy was installed from the Mac App Store, which delivers updates. Readmate Reader cannot query the App Store for pending updates from inside the app.',
  'microsoft-store':
    'This copy was installed from the Microsoft Store, which delivers updates. Checking the Store from inside the app is not supported yet.',
  direct: 'This build has no update service configured, so it cannot check for newer versions.',
}

type StatusView = { tone: 'neutral' | 'success' | 'accent' | 'error'; title: string; body: string }

function statusFor(check: UpdateCheckState): StatusView | null {
  switch (check.kind) {
    case 'idle':
      return null
    case 'checking':
      return { tone: 'neutral', title: 'Checking…', body: 'Checking for updates…' }
    case 'error':
      return {
        tone: 'error',
        title: 'Couldn’t check for updates.',
        body: 'Please try again later.',
      }
    case 'done': {
      const { result } = check
      switch (result.status) {
        case 'up-to-date':
          return {
            tone: 'success',
            title: 'You’re up to date.',
            body: 'You’re running the latest version.',
          }
        case 'update-available':
          return {
            tone: 'accent',
            title: 'Update available',
            body: result.latestVersion
              ? `Version ${result.latestVersion} is available.`
              : 'A new version is available.',
          }
        case 'failed':
          return {
            tone: 'error',
            title: 'Couldn’t check for updates.',
            body: 'Please try again later.',
          }
        case 'unavailable':
          return {
            tone: 'neutral',
            title: 'Update check not available yet',
            body: CHANNEL_NOTE[result.channel],
          }
      }
    }
  }
}

const TONE_CLASS: Record<StatusView['tone'], string> = {
  neutral: 'border-lib-border-soft bg-lib-chip/40 text-lib-text-strong',
  success: 'border-lib-accent-ring bg-lib-accent-soft text-lib-text-strong',
  accent: 'border-lib-accent-ring bg-lib-accent-soft text-lib-text-strong',
  error: 'border-red-400/40 bg-red-500/10 text-red-400',
}

/** SCR-06 Settings → Advanced: Updates (current version + check) and Reset App Settings. */
export function AdvancedSettings() {
  const version = useUpdatesStore((s) => s.version)
  const check = useUpdatesStore((s) => s.check)
  const loadVersion = useUpdatesStore((s) => s.loadVersion)
  const checkForUpdates = useUpdatesStore((s) => s.checkForUpdates)
  const checking = check.kind === 'checking'
  const status = statusFor(check)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetNotice, setResetNotice] = useState<ResetNotice | null>(null)
  const [resetting, setResetting] = useState(false)

  async function confirmReset() {
    setResetDialogOpen(false)
    setResetting(true)
    const { failed } = await resetAppSettings()
    setResetting(false)
    setResetNotice(
      failed.length === 0
        ? { tone: 'success', text: 'Settings have been reset to their defaults.' }
        : {
            tone: 'error',
            text: `Some settings couldn’t be saved and may revert after restarting: ${failed
              .map((group) => group.label)
              .join(', ')}.`,
          },
    )
  }

  useEffect(() => {
    void loadVersion()
  }, [loadVersion])

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      <SettingsCard title="Updates">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] text-lib-muted">Current Version</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums select-text">
              {version === null ? 'Loading…' : version === undefined ? 'Unknown' : version}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-lib-border disabled:hover:bg-transparent"
            disabled={checking}
            aria-busy={checking}
            onClick={() => void checkForUpdates()}
          >
            {checking ? (
              <span
                className="size-3.5 animate-spin rounded-full border-2 border-lib-border border-t-lib-accent"
                aria-hidden
              />
            ) : null}
            {checking ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>

        {status ? (
          <div
            role="status"
            aria-live="polite"
            className={`mt-4 rounded-lg border px-3 py-2.5 text-[13px] ${TONE_CLASS[status.tone]}`}
          >
            <p className="m-0 font-semibold">{status.title}</p>
            <p className="m-0 mt-0.5 text-[12px] opacity-90">{status.body}</p>
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Reset App Settings"
        description={`Restore your application preferences to their default values. ${RESET_APP_SETTINGS_COPY}`}
      >
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-60 disabled:hover:border-lib-border disabled:hover:text-lib-text-strong"
          disabled={resetting}
          aria-busy={resetting}
          onClick={() => {
            setResetNotice(null)
            setResetDialogOpen(true)
          }}
        >
          {resetting ? (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-lib-border border-t-lib-accent"
              aria-hidden
            />
          ) : null}
          {resetting ? 'Resetting…' : 'Reset App Settings'}
        </button>

        {resetNotice ? (
          <p
            role="status"
            aria-live="polite"
            className={`m-0 mt-4 rounded-lg border px-3 py-2.5 text-[13px] ${
              TONE_CLASS[resetNotice.tone]
            }`}
          >
            {resetNotice.text}
          </p>
        ) : null}
      </SettingsCard>

      {resetDialogOpen ? (
        <ConfirmBookActionDialog
          title="Reset App Settings?"
          message={`This will restore your application preferences to their default values. ${RESET_APP_SETTINGS_COPY}`}
          confirmLabel="Reset Settings"
          destructive
          onCancel={() => setResetDialogOpen(false)}
          onConfirm={confirmReset}
        />
      ) : null}
    </div>
  )
}
