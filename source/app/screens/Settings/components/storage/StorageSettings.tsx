import { uiText, useFormat, useT } from '../../../../i18n'
import { useEffect, useState } from 'react'
import { ConfirmBookActionDialog } from '../../../Library/components/book/ConfirmBookActionDialog'
import { useStorageStore } from '../../logic/storageStore'
import { SettingsCard } from '../layout/SettingsCard'



const secondaryButton =
  'inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-lib-border bg-transparent px-4 text-[13px] font-semibold text-lib-text-strong transition-colors hover:border-lib-accent hover:bg-lib-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60'

/** Usage segments in display order; colors are theme tokens / neutral swatches. */
const SEGMENTS = [
  { key: 'books', labelKey: 'settings.storage.segments.books', color: 'var(--lib-accent)' },
  { key: 'cache', labelKey: 'settings.storage.segments.cache', color: '#38bdf8' },
  { key: 'models', labelKey: 'settings.storage.segments.models', color: '#a78bfa' },
  { key: 'speech', labelKey: 'settings.storage.segments.speech', color: '#34d399' },
  { key: 'other', labelKey: 'settings.storage.segments.other', color: 'var(--lib-faint)' },
] as const

/**
 * SCR-06 Settings → Storage: where managed books live, what Clear Cache removes, downloaded
 * translation models and a usage breakdown. Not a place to manage books (that is the Library).
 */
export function StorageSettings() {
  const t = useT()
  const format = useFormat()
  const formatBytes = (bytes: number | null | undefined): string => (bytes == null ? '—' : format.bytes(bytes))
  const usage = useStorageStore((s) => s.usage)
  const loading = useStorageStore((s) => s.loading)
  const loadError = useStorageStore((s) => s.loadError)
  const clearing = useStorageStore((s) => s.clearing)
  const removingModelId = useStorageStore((s) => s.removingModelId)
  const notice = useStorageStore((s) => s.notice)
  const load = useStorageStore((s) => s.load)
  const clearCache = useStorageStore((s) => s.clearCache)
  const removeTranslationModel = useStorageStore((s) => s.removeTranslationModel)
  const removeSpeechModel = useStorageStore((s) => s.removeSpeechModel)
  const openBooksFolder = useStorageStore((s) => s.openBooksFolder)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRemoveModel, setConfirmRemoveModel] = useState<string | null>(null)
  const [confirmRemoveSpeech, setConfirmRemoveSpeech] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const sizes = {
    books: usage?.booksBytes ?? 0,
    cache: usage?.cacheBytes ?? 0,
    models: usage?.translationModelsBytes ?? 0,
    speech: usage?.speechModelsBytes ?? 0,
    other: usage?.otherBytes ?? 0,
  }
  const total = usage?.totalBytes ?? 0

  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {notice ? (
        <p
          role="status"
          className={`m-0 rounded-lg border px-3 py-2 text-[13px] ${
            notice.tone === 'success'
              ? 'border-lib-accent-ring bg-lib-accent-soft text-lib-text-strong'
              : 'border-red-400/40 bg-red-500/10 text-red-400'
          }`}
        >
          {uiText(t, notice.text)}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="m-0 text-[13px] text-red-400">
          {uiText(t, loadError)}
        </p>
      ) : null}

      <SettingsCard
        title={t('settings.storage.books.title')}
        description={t('settings.storage.books.description')}
      >
        <p className="m-0 text-[12px] font-semibold text-lib-muted">{t('settings.storage.books.location')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <code
            className="min-w-0 flex-1 truncate rounded-md border border-lib-border-soft bg-lib-input px-2.5 py-2 font-mono text-[12px] text-lib-text-strong select-text"
            title={usage?.booksFolderPath}
          >
            {usage?.booksFolderPath ?? (loading ? t('settings.loading') : '—')}
          </code>
          <button type="button" className={secondaryButton} onClick={() => void openBooksFolder()}>
            {t('settings.storage.books.openFolder')}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.storage.cache.title')}
        description={t('settings.storage.cache.description')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="m-0 text-[13px] text-lib-muted">{t('settings.storage.cache.used')}</p>
            <p className="m-0 mt-0.5 text-[15px] font-semibold text-lib-text-strong tabular-nums">
              {usage ? formatBytes(usage.cacheBytes) : loading ? t('settings.loading') : '—'}
            </p>
            {usage ? (
              <p className="m-0 mt-1 text-[11px] text-lib-faint tabular-nums">
                {t('settings.storage.cache.breakdown', {
                  index: formatBytes(usage.searchIndexBytes),
                  browser: formatBytes(usage.browserCacheBytes),
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={clearing || !usage}
            onClick={() => setConfirmClear(true)}
          >
            {clearing ? t('settings.storage.cache.clearing') : t('settings.storage.cache.clear')}
          </button>
        </div>
        <p className="m-0 mt-3 text-[12px] text-lib-faint">
          {t('settings.storage.cache.after')}
        </p>
      </SettingsCard>

      <SettingsCard
        title={t('settings.storage.models.title')}
        description={t('settings.storage.models.description')}
      >
        {usage && usage.translationModels.length > 0 ? (
          <ul className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0">
            {usage.translationModels.map((model) => (
              <li
                key={model.id}
                className="flex min-h-[var(--ui-density-row)] items-center justify-between gap-3 px-3 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-[12px] text-lib-text-strong">
                  {model.id}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[12px] text-lib-muted tabular-nums">
                    {formatBytes(model.bytes)}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center rounded-md border border-lib-border bg-transparent px-2.5 text-[12px] font-semibold text-lib-muted transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={t('settings.storage.models.removeAria', { id: model.id })}
                    disabled={removingModelId !== null}
                    onClick={() => setConfirmRemoveModel(model.id)}
                  >
                    {removingModelId === model.id ? t('settings.storage.models.removing') : t('common.actions.remove')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-lib-faint">
            {usage ? t('settings.storage.models.none') : loading ? t('settings.loading') : '—'}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('settings.storage.speech.title')}
        description={t('settings.storage.speech.description')}
      >
        {usage && usage.speechModels.length > 0 ? (
          <ul className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0">
            {usage.speechModels.map((model) => (
              <li
                key={model.id}
                className="flex min-h-[var(--ui-density-row)] items-center justify-between gap-3 px-3 py-1.5"
              >
                <span className="min-w-0 truncate text-[12px] text-lib-text-strong" title={model.id}>
                  {model.label}
                  <span className="ml-2 font-mono text-lib-faint">{model.id}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[12px] text-lib-muted tabular-nums">
                    {formatBytes(model.bytes)}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center rounded-md border border-lib-border bg-transparent px-2.5 text-[12px] font-semibold text-lib-muted transition-colors hover:border-red-400 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={t('settings.storage.models.removeAria', { id: model.id })}
                    disabled={removingModelId !== null}
                    onClick={() => setConfirmRemoveSpeech(model.id)}
                  >
                    {removingModelId === model.id ? t('settings.storage.models.removing') : t('common.actions.remove')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-lib-faint">
            {usage ? t('settings.storage.speech.none') : loading ? t('settings.loading') : '—'}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title={t('settings.storage.usage.title')} description={t('settings.storage.usage.description')}>
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-lib-chip"
          role="img"
          aria-label={t('settings.storage.usage.totalAria', { size: formatBytes(total) })}
        >
          {total > 0
            ? SEGMENTS.map((segment) => {
                const share = (sizes[segment.key] / total) * 100
                return share > 0 ? (
                  <span
                    key={segment.key}
                    style={{ width: `${share}%`, background: segment.color }}
                    title={t('settings.storage.segmentTitle', {
                      label: t(segment.labelKey),
                      size: formatBytes(sizes[segment.key]),
                    })}
                  />
                ) : null
              })
            : null}
        </div>
        <dl className="m-0 mt-4 flex flex-col gap-2 text-[13px]">
          {SEGMENTS.map((segment) => (
            <div key={segment.key} className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-lib-muted">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: segment.color }}
                  aria-hidden
                />
                {t(segment.labelKey)}
              </dt>
              <dd className="m-0 text-lib-text-strong tabular-nums">
                {usage ? formatBytes(sizes[segment.key]) : '—'}
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-lib-border-soft pt-2">
            <dt className="font-semibold text-lib-text-strong">{t('settings.storage.usage.total')}</dt>
            <dd className="m-0 font-semibold text-lib-text-strong tabular-nums">
              {usage ? formatBytes(total) : '—'}
            </dd>
          </div>
        </dl>
        <p className="m-0 mt-3 text-[12px] text-lib-faint">
          {t('settings.storage.usage.otherNote')}
        </p>
      </SettingsCard>

      {confirmClear ? (
        <ConfirmBookActionDialog
          title={t('settings.storage.confirm.clearTitle')}
          message={t('settings.storage.confirm.clearBody')}
          confirmLabel={t('settings.storage.cache.clear')}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false)
            void clearCache()
          }}
        />
      ) : null}

      {confirmRemoveSpeech ? (
        <ConfirmBookActionDialog
          title={t('settings.storage.confirm.removeSpeechTitle')}
          message={t('settings.storage.confirm.removeSpeechBody', { id: confirmRemoveSpeech })}
          confirmLabel={t('common.actions.remove')}
          destructive
          onCancel={() => setConfirmRemoveSpeech(null)}
          onConfirm={() => {
            const id = confirmRemoveSpeech
            setConfirmRemoveSpeech(null)
            void removeSpeechModel(id)
          }}
        />
      ) : null}

      {confirmRemoveModel ? (
        <ConfirmBookActionDialog
          title={t('settings.storage.confirm.removeModelTitle')}
          message={t('settings.storage.confirm.removeModelBody', { id: confirmRemoveModel })}
          confirmLabel={t('common.actions.remove')}
          destructive
          onCancel={() => setConfirmRemoveModel(null)}
          onConfirm={() => {
            const id = confirmRemoveModel
            setConfirmRemoveModel(null)
            void removeTranslationModel(id)
          }}
        />
      ) : null}
    </div>
  )
}
