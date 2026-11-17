import type { ReactNode } from 'react'
import { isMobileHost } from '../../../../platforms/host'

/**
 * Rounded card used for each group on a Settings page (title, optional description, content). Its title is one level
 * below the page title: `h3` under Desktop's `h2` section title, `h2` under the phone section page's `h1`.
 */
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const Heading = isMobileHost() ? 'h2' : 'h3'
  return (
    <section
      className="rounded-xl border border-lib-border-soft bg-lib-surface-strong/60 p-[var(--ui-density-pad)]"
      aria-label={title}
    >
      <Heading className="m-0 text-[15px] font-semibold text-lib-text-strong">{title}</Heading>
      {description ? (
        <p className="m-0 mt-1 text-[13px] leading-relaxed text-lib-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}
