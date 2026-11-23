import { useId, useRef, type RefObject } from 'react'
import { create } from 'zustand'
import { SKIP_LENGTHS, isSkipLength } from '@core'
import { useT } from '../../../i18n'
import { useDismissOnOutsideOrEscape } from '../../Reader/logic'
import { useListeningPrefsStore } from '../logic/listeningPrefsStore'

/** Open / closed state of the menu (zustand, as every hook-owned UI state in this app). */
const useListeningMenuStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

const FIELD = 'flex items-center justify-between gap-4 text-sm text-lib-text'
const SELECT =
  'focus-ring h-8 cursor-pointer rounded-lg border border-lib-border bg-lib-input px-2 text-sm text-lib-text-strong'

/**
 * Spec 018 FR-028 / FR-029: the player's "Listening" settings — skip back / forward lengths and rewind on resume. Kept
 * for every audiobook on this computer (`useListeningPrefsStore`); the buttons, shortcuts, mini player, floating window
 * and system media controls all follow them.
 */
export function ListeningMenu() {
  const t = useT()
  const id = useId()
  const open = useListeningMenuStore((s) => s.open)
  const setOpen = useListeningMenuStore((s) => s.setOpen)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        className="focus-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-lib-border bg-lib-surface px-3 text-xs font-semibold text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-surface-hover aria-expanded:border-lib-accent-ring"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
        {t('audiobook.player.controls.listening')}
      </button>
      {open ? <ListeningPanel id={id} anchorRef={anchorRef} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

/** The open panel; mounted only while open, so its outside-click / Escape handling exists only then. */
function ListeningPanel({
  id,
  anchorRef,
  onClose,
}: {
  id: string
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const t = useT()
  const skipBack = useListeningPrefsStore((s) => s.skipBackSeconds)
  const skipForward = useListeningPrefsStore((s) => s.skipForwardSeconds)
  const autoRewind = useListeningPrefsStore((s) => s.autoRewind)
  const setPrefs = useListeningPrefsStore((s) => s.set)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsideOrEscape(panelRef, onClose, { ignoreRef: anchorRef, consumeEscape: true })

  const lengthOptions = SKIP_LENGTHS.map((n) => (
    <option key={n} value={n}>
      {t('audiobook.player.controls.seconds', { seconds: n })}
    </option>
  ))

  return (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          role="dialog"
          aria-label={t('audiobook.player.controls.listeningSettings')}
          className="absolute bottom-[calc(100%+8px)] left-1/2 z-[300] flex w-72 -translate-x-1/2 flex-col gap-3 rounded-xl border border-lib-border bg-lib-surface-strong p-3 shadow-xl backdrop-blur-md"
        >
          <label className={FIELD}>
            {t('audiobook.player.controls.skipBackLength')}
            <select
              className={SELECT}
              value={skipBack}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (isSkipLength(n)) setPrefs({ skipBackSeconds: n })
              }}
            >
              {lengthOptions}
            </select>
          </label>
          <label className={FIELD}>
            {t('audiobook.player.controls.skipForwardLength')}
            <select
              className={SELECT}
              value={skipForward}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (isSkipLength(n)) setPrefs({ skipForwardSeconds: n })
              }}
            >
              {lengthOptions}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label className={FIELD}>
              {t('audiobook.player.controls.rewindOnResume')}
              <select
                className={SELECT}
                value={autoRewind ? 'on' : 'off'}
                aria-describedby={`${id}-rewind-hint`}
                onChange={(e) => setPrefs({ autoRewind: e.target.value === 'on' })}
              >
                <option value="on">{t('audiobook.player.controls.on')}</option>
                <option value="off">{t('audiobook.player.controls.off')}</option>
              </select>
            </label>
            <p id={`${id}-rewind-hint`} className="m-0 text-xs leading-snug text-lib-muted">
              {t('audiobook.player.controls.rewindOnResumeHint')}
            </p>
          </div>
        </div>
  )
}
