import { useEffect, useLayoutEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { sectionFromParam } from '@core'
import { useT } from '../../../i18n'
import { visibleSettingsSections, type SettingsSectionId } from '../logic/settingsNavStore'
import { usePhoneSettingsNavStore } from '../logic/phoneSettingsNavStore'
import { PhoneSettingsHeader } from './PhoneSettingsHeader'
import { PhoneSettingsList } from './PhoneSettingsList'
import { PhoneSettingsSectionPage } from './PhoneSettingsSectionPage'

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Phone "More" screen (spec 014, contracts/phone-settings-ui.md), loaded instead of the desktop Settings layout on the
 * Mobile host only. `/settings` is the section list; `/settings/:section` opens one section as its own page above the
 * list, so Android's system Back (`history.back()`) returns to the list (research R1). The list stays mounted under
 * the page (inert while covered) so its scroll position and an exit slide cost nothing.
 */
export default function MobileSettingsScreen() {
  const t = useT()
  const navigate = useNavigate()
  const { section: param } = useParams()
  const sections = visibleSettingsSections()
  const sectionId = sectionFromParam<SettingsSectionId>(param, sections.map((s) => s.id))
  const section = sections.find((s) => s.id === sectionId) ?? null

  const leaving = usePhoneSettingsNavStore((s) => s.leaving)
  const listBody = useRef<HTMLDivElement>(null)
  const shownSection = useRef<SettingsSectionId | null>(sectionId)

  // Route change → page transition. Opening a section cancels any exit slide (the last action wins); going back to
  // the list starts the exit slide of the section that was shown (instant under reduced motion).
  useEffect(() => {
    const store = usePhoneSettingsNavStore.getState()
    const previous = shownSection.current
    shownSection.current = sectionId
    if (sectionId) {
      store.clearLeaving()
      return
    }
    store.setOpenedFromList(false)
    if (!previous) return
    if (!prefersReducedMotion()) store.startLeaving(previous)
    // Back on the list: focus returns to the row of the section just closed, unless the user already put it somewhere
    // else (e.g. a tab of the bottom bar).
    const active = document.activeElement
    if (!active || active === document.body || active.closest('.phone-settings-page')) {
      listBody.current?.querySelector<HTMLElement>(`[data-section="${previous}"]`)?.focus({ preventScroll: true })
    }
  }, [sectionId])

  // Back on the list: restore its scroll position before paint (FR-006).
  useLayoutEffect(() => {
    if (sectionId === null && listBody.current) {
      listBody.current.scrollTop = usePhoneSettingsNavStore.getState().listScrollTop
    }
  }, [sectionId])

  if (param !== undefined && sectionId === null) return <Navigate to="/settings" replace />

  function openSection(id: SettingsSectionId) {
    const store = usePhoneSettingsNavStore.getState()
    store.saveListScroll(listBody.current?.scrollTop ?? 0)
    store.clearLeaving()
    store.setOpenedFromList(true)
    navigate(`/settings/${id}`)
  }

  function goBack() {
    // Pushed from the list in this session → pop it, so system Back history stays as the user built it; a section
    // reached any other way → replace it with the list.
    if (usePhoneSettingsNavStore.getState().openedFromList) navigate(-1)
    else navigate('/settings', { replace: true })
  }

  const leavingSection = !section && leaving ? sections.find((s) => s.id === leaving.section) : undefined
  const covered = section !== null

  return (
    <div className="phone-settings">
      <div className="flex min-h-0 flex-1 flex-col" aria-hidden={covered || undefined} inert={covered || undefined}>
        <PhoneSettingsHeader title={t('settings.title')} />
        <div ref={listBody} className="phone-settings-body">
          <div className="phone-settings-content py-4">
            <PhoneSettingsList sections={sections} onOpen={openSection} />
          </div>
        </div>
      </div>

      {section ? <PhoneSettingsSectionPage key={section.id} section={section} onBack={goBack} /> : null}
      {leavingSection ? (
        <PhoneSettingsSectionPage key={`leaving-${leaving!.token}`} section={leavingSection} onBack={goBack} leaving />
      ) : null}
    </div>
  )
}
