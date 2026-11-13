/**
 * The reserved 320 × 50 banner slot above the phone tab bar (spec 013 US5, FR-022 / FR-023). Nothing is shown to users
 * in this release: outside a development build it renders nothing and takes no height. In development it is a dashed
 * placeholder so the layout can be checked. No network, no ad SDK.
 *
 * The placeholder text is a developer layout aid (aria-hidden, never in a release build), so it is NOT in the i18n
 * catalogue: a catalogue entry is bundled in every build, and the release bundle must not contain it (quickstart:
 * `grep -c "Banner 320" web-dist/assets/*.js` = 0). Here it sits behind `import.meta.env.DEV`, which Vite removes.
 */
export function AdSlot() {
  if (!import.meta.env.DEV) return null
  return (
    <div className="flex shrink-0 justify-center py-1" aria-hidden>
      <div className="flex h-[50px] w-[320px] max-w-full items-center justify-center rounded-md border border-dashed border-lib-border text-[11px] text-lib-faint">
        {/* i18n-ignore: development-only layout placeholder, never shown to users */}
        Ad · Banner 320 × 50
      </div>
    </div>
  )
}
