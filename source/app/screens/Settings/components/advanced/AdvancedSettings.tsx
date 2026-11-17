import type { MessageKey, MessageRef, Translator } from '@core'
import { getT, translateRef, useT } from '../../../../i18n'
import { useEffect, useState } from 'react'
import type { UpdateChannel } from '../../../../bridge'
import { ConfirmBookActionDialog } from '../../../Library/components/book/ConfirmBookActionDialog'
import { resetAppSettings } from '../../logic/resetAppSettings'
import { useUpdatesStore, type UpdateCheckState } from '../../logic/updatesStore'
import { SettingsCard } from '../layout/SettingsCard'
import { isFeatureAvailable } from '../../../../platforms/host'

type ResetNotice = { tone: 'success' | 'error'; text: MessageRef }

const CHANNEL_NOTE: Record<UpdateChannel, MessageKey> = {
  'mac-app-store': 'settings.advanced.channel.macAppStore',
  'microsoft-store': 'settings.advanced.channel.microsoftStore',
  direct: 'settings.advanced.channel.direct',
}

type StatusView = { tone: 'neutral' | 'success' | 'accent' | 'error'; title: string; body: string }

function statusFor(t: Translator, check: UpdateCheckState): StatusView | null {
  switch (check.kind) {
    case 'idle':
      return null
    case 'checking':
      return {
        tone: 'neutral',
        title: t('settings.advanced.status.checking'),
        body: t('settings.advanced.status.checkingBody'),
      }
    case 'error':
      return {
        tone: 'error',
        title: t('settings.advanced.status.failed'),
        body: t('settings.advanced.status.failedBody'),
      }
    case 'done': {
      const { result } = check
      switch (result.status) {
        case 'up-to-date':
          return {
            tone: 'success',
            title: t('settings.advanced.status.upToDate'),
            body: t('settings.advanced.status.upToDateBody'),
          }
        case 'update-available':
          return {
            tone: 'accent',
            title: t('settings.advanced.status.available'),
            body: result.latestVersion
              ? t('settings.advanced.status.availableVersion', { version: result.latestVersion })
              : t('settings.advanced.status.availableBody'),
          }
        case 'failed':
          return {
            tone: 'error',
            title: t('settings.advanced.status.failed'),
            body: t('settings.advanced.status.failedBody'),
          }
        case 'unavailable':
          return {
            tone: 'neutral',
            title: t('settings.advanced.status.unavailable'),
            body: t(CHANNEL_NOTE[result.channel]),
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
  const t = useT()
  const version = useUpdatesStore((s) => s.version)
  const check = useUpdatesStore((s) => s.check)
  const loadVersion = useUpdatesStore((s) => s.loadVersion)
  const checkForUpdates = useUpdatesStore((s) => s.checkForUpdates)
  const checking = check.kind === 'checking'
  const status = statusFor(t, check)
  const resetCopy = t('settings.advanced.resetCopy')
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
        ? { tone: 'success', text: { key: 'settings.advanced.reset.success' } }
        : {
            tone: 'error',
            text: {
              key: 'settings.advanced.reset.partial',
              params: { groups: failed.map((group) => getT()(group.labelKey)).join(', ') },
            },
          },
    )
  }

  useEffect(() => {
    void loadVersion()
  }, [loadVersion])

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {/* No update channel on the Mobile host (spec 008): the app store updates it. */}
      {isFeatureAvailable('updates') ? (
        <SettingsCard title={t('settings.advanced.updates')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[13px] text-lib-muted">{t('settings.advanced.currentVersion')}</p>
              <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums select-text">
                {version === null ? t('settings.loading') : version === undefined ? t('settings.advanced.unknown') : version}
              </p>
            </div>
            <button
              type="button"
              className="settings-action inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-lib-border disabled:hover:bg-transparent"
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
              {checking ? t('settings.advanced.status.checking') : t('settings.advanced.checkForUpdates')}
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
      ) : null}

      <SettingsCard
        title={t('settings.advanced.reset.title')}
        description={t('settings.advanced.reset.description', { copy: resetCopy })}
      >
        <button
          type="button"
          data-tone="danger"
          className="settings-action inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-wait disabled:opacity-60 disabled:hover:border-lib-border disabled:hover:text-lib-text-strong"
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
          {resetting ? t('settings.advanced.reset.resetting') : t('settings.advanced.reset.button')}
        </button>

        {resetNotice ? (
          <p
            role="status"
            aria-live="polite"
            className={`m-0 mt-4 rounded-lg border px-3 py-2.5 text-[13px] ${
              TONE_CLASS[resetNotice.tone]
            }`}
          >
            {translateRef(t, resetNotice.text)}
          </p>
        ) : null}
      </SettingsCard>

      {resetDialogOpen ? (
        <ConfirmBookActionDialog
          title={t('settings.advanced.reset.confirmTitle')}
          message={t('settings.advanced.reset.confirmBody', { copy: resetCopy })}
          confirmLabel={t('settings.advanced.reset.confirm')}
          destructive
          onCancel={() => setResetDialogOpen(false)}
          onConfirm={confirmReset}
        />
      ) : null}
    </div>
  )
}
