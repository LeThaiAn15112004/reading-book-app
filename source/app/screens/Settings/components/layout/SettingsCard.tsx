import type { ReactNode } from 'react'

/** Rounded card used for each group on a Settings page (title, optional description, content). */
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section
      className="rounded-xl border border-lib-border-soft bg-lib-surface-strong/60 p-[var(--ui-density-pad)]"
      aria-label={title}
    >
      <h3 className="m-0 text-[15px] font-semibold text-lib-text-strong">{title}</h3>
      {description ? (
        <p className="m-0 mt-1 text-[13px] leading-relaxed text-lib-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}
