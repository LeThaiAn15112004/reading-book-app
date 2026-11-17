import { useEffect, useRef } from 'react'
import type { MessageKey } from '@core'
import { useT } from '../../../i18n'
import { AboutSettings, AdvancedSettings, AppearanceSettings, PrivacySettings, SettingsPlaceholder } from '../components'
import type { SettingsSectionId } from '../logic/settingsNavStore'
import { PhoneSettingsHeader } from './PhoneSettingsHeader'

export type PhoneSettingsSectionPageProps = {
  section: { id: SettingsSectionId; labelKey: MessageKey }
  onBack: () => void
  /** Kept on screen only for its exit slide: ignores input (FR-016). */
  leaving?: boolean
}

/** The existing content of one phone section, unchanged (FR-004, FR-011). */
function SectionContent({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case 'appearance':
      return <AppearanceSettings />
    case 'privacy':
      return <PrivacySettings />
    case 'advanced':
      return <AdvancedSettings />
    case 'about':
      return <AboutSettings />
    default:
      // Storage / Notifications / Keyboard are never visible on the phone (FR-010).
      return <SettingsPlaceholder />
  }
}

/** A section as its own full-width page above the list (spec 014 FR-004, contract §3). */
export function PhoneSettingsSectionPage({ section, onBack, leaving = false }: PhoneSettingsSectionPageProps) {
  const t = useT()
  const heading = useRef<HTMLHeadingElement>(null)

  // The list under the page turns inert, which drops focus to <body>: give it to the new page title instead, so a
  // screen reader announces where the user is.
  useEffect(() => {
    if (!leaving) heading.current?.focus({ preventScroll: true })
  }, [leaving])

  return (
    <div
      className={`phone-settings-page absolute inset-0 z-10 flex flex-col bg-lib-bg-deep${leaving ? ' phone-settings-page--leaving' : ''}`}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
      <PhoneSettingsHeader title={t(section.labelKey)} onBack={onBack} headingRef={heading} />
      <div className="phone-settings-body">
        <div className="phone-settings-content py-4">
          <SectionContent id={section.id} />
        </div>
      </div>
    </div>
  )
}
