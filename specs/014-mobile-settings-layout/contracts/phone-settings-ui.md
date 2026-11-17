# Contract: Phone Settings ("More") UI — spec 014

Scope: what the Mobile host renders for `/settings*`, the hooks other code may rely on, and what Desktop must keep.
Data shapes are in [../data-model.md](../data-model.md); decisions in [../research.md](../research.md).

## 1. Entry points

| Host | Entry | Label (en / vi) | Target |
|---|---|---|---|
| Phone | 4th bottom tab (`PhoneNav`, id `settings`, same position) | More / Khác + "more" icon | `navigate('/settings')`, `replace` when already under `/settings` |
| Desktop | menubar link (`AppMenubar`, same position) | More / Khác (text only) | `/settings` (unchanged behaviour) |

The labels come from `chrome.nav.settings`; the page / sidebar title from `settings.title`.

## 2. Routes (phone)

- `/settings` → **list page**: header (title "More", no back control) + scrollable body with one group of rows.
- `/settings/:section` → **section page**: header (back control + section name) + scrollable body with the section's
  existing component (`AppearanceSettings`, `PrivacySettings`, `AdvancedSettings`, `AboutSettings`).
- Invalid / hidden `:section` → `replace('/settings')`.
- System Back (Android): dialog open → closes it (§5); section page → list; list → today's top-level behaviour.

Desktop: `/settings/:section` renders exactly what `/settings` renders today.

## 3. Components (`screens/Settings/phone/`)

| Component | Props | Must |
|---|---|---|
| `MobileSettingsScreen` | — | lazy-loaded by `SettingsScreen` only when `isMobileHost()`; root class `phone-settings`; list always mounted under the section layer |
| `PhoneSettingsHeader` | `title`, `onBack?` | back control is a `<button>` ≥ 48 × 48, SVG chevron (`aria-hidden`), accessible name `settings.phone.back`; title truncates with ellipsis; header never scrolls |
| `PhoneSettingsList` | `sections`, `onOpen(id)` | `<ul>` of `<li><button>` rows ≥ 48 dp: icon, name, description (≤ 2 lines, wraps), chevron; whole row is the target; focus ring `outline-lib-accent` |
| `PhoneSettingsSectionPage` | `section` | renders the existing section component unchanged; body `overflow-x: hidden` |

## 4. CSS hooks (`styles/phone.css`, all under `:root[data-mobile-host] .phone-settings`)

| Hook | Added on | Phone rule |
|---|---|---|
| `.phone-settings-page` (enter) / `.phone-settings-page--leaving` | section layer | slide 220 ms in / 200 ms out, `transform` only; `prefers-reduced-motion: reduce` → none |
| `.settings-switch-row` | the flex row wrapping label + `SettingsSwitch` | `position: relative; min-height: 48px` |
| `.settings-switch` | `SettingsSwitch` button | `::after { content:''; position:absolute; inset:0 }` (whole row toggles) |
| `.settings-action` | action buttons (Clear data, Reset, Open in store, dialog buttons) | `min-height: 48px` |
| `[data-tone="danger"]` | Clear data, Reset (outlined buttons) | `color` / `border-color: var(--lib-danger)` at rest |
| `[data-tone="danger-filled"]` | dialog destructive buttons (filled red) | background / border `#dc2626`, text white (4.83:1; desktop red-500 is 3.76:1) |
| `.settings-choice-row` | `ClearDataDialog` option `<label>` | `min-height: 48px`, whole row toggles the checkbox |
| secondary text | `.text-[10px]`, `.text-[11px]` inside `.phone-settings` | `font-size: 12px` |
| width | list + section body | `max-width: 640px; margin-inline: auto` at `min-width: 900px` |
| density | `:root[data-mobile-host]` | `--ui-density-*` fixed to the phone values regardless of `data-density` |

Token: `--lib-danger` in `theme.css` (Night/Sepia `#f87171`, Paper `#b91c1c`). Desktop does not use it in this feature.

## 5. Back-closable dialogs

`useBackClose(open: boolean, onClose: () => void)` (`hooks/app/useBackClose.ts`, store `backCloseStore`). Mobile host
only; no-op on Desktop. Used by `ConfirmBookActionDialog` and `ClearDataDialog`. Guarantees: one history entry per
open layer; Back closes only the top layer; closing by button / Escape removes the entry so the next Back goes where it
went before.

## 6. Section-level exceptions (stated in the spec)

| Item | Phone | Desktop |
|---|---|---|
| Density card (Appearance) | hidden (`isFeatureAvailable('uiDensity')` false) | unchanged |
| About version | `getAppInfo().version` ("Loading…" / "Unknown") | same |
| About link rows | only rows with a destination: Privacy Policy (URL), Store page (Play on Android, App Store on iOS); empty groups hidden | Privacy Policy only (store row hidden); empty groups hidden |
| About Updates card | version + "Open in store" (`settings-action`) → store page; button hidden if no store URL | unchanged |

## 7. i18n keys (en / vi, `settings` and `chrome` areas)

Changed values: `chrome.nav.settings` → "More" / "Khác"; `settings.title` → "More" / "Khác".
New keys: `settings.phone.back` ("Back" / "Quay lại"), `settings.phone.listAria` (section list name),
`settings.about.openInStore` ("Open in store" / "Mở trong cửa hàng"). "Loading…" / "Unknown" reuse the existing `settings.loading` and
`settings.advanced.unknown`.
Glossary: add "More (navigation entry) → Khác".

## 8. Mobile-only stores (reason, per spec 008 `contracts/phone-ui.md`)

- `phoneSettingsNavStore`: the exit-slide layer and the list scroll position exist only because the phone shows the list
  and a section as two pages; Desktop shows both at once.
- `backCloseStore`: Android's system Back exists only on the phone.
