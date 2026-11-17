# Implementation Plan: Mobile Settings screen layout (shell only)

**Branch**: `014-mobile-settings-layout` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-mobile-settings-layout/spec.md`

## Summary

Give the Mobile host a phone-style **More** screen (the Settings screen behind the renamed 4th tab): a full-width list
of the phone's sections (Appearance, Privacy, Advanced, About) and one full-width page per section with a back header,
reached through real router entries (`/settings` → `/settings/:section`) so Android's system Back — already mapped to
`history.back()` by the host — works without new native code. A lazily loaded `screens/Settings/phone/MobileSettingsScreen.tsx`
replaces the sidebar layout on the phone only (same pattern as `MobileLibraryHub`), reuses every section component, and
adds a short directional slide (instant under reduced motion). Shared building blocks get phone standards through
`phone.css` rules scoped to the new screen (48 dp targets, whole-row switches, destructive buttons that look
destructive at rest, ≥ 12 px secondary text), and the section dialogs close on system Back through one shared
back-close store. Two deliberate content exceptions: Density is hidden on the phone, and the About page shows the real
installed version, opens the Privacy Policy / store page links, hides rows that have no destination, and (phone only)
turns its Updates button into "Open in store". The navigation entry is renamed **More / Khác** on both hosts; Desktop's
layout is otherwise unchanged.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19 (shared UI); React Native / Expo host unchanged

**Primary Dependencies**: existing only — zustand, react-router (`HashRouter`, `useNavigationType`), Tailwind v4 classes
+ `styles/phone.css`, `@core` (`config`, `i18n`). No new package.

**Storage**: none new. localStorage keys unchanged (`reading-book.settings.sidebar-collapsed`, appearance prefs incl.
the stored density, which is kept but ignored on the phone). No SQLite change, no migration.

**Testing**: vitest in `source/core/tests` (`npm run sdk:test`: new `config/app-links.test.ts`,
`settings/phone-settings-nav.test.ts`) and `source/app/platforms/native/tests` (`npm run mobile:test`, unchanged
suites must stay green); `npm run check`; manual device pass in `quickstart.md`. No E2E (manual-only rule).

**Target Platform**: Android (Expo native build with the local server, WebView). iOS follows the same rules when built.
Desktop (Electron) only gets the names (FR-018) and the About changes (FR-019, FR-020).

**Project Type**: Mobile app (WebView host) sharing the Desktop React UI.

**Performance Goals**: section page shown < 100 ms after the tap (content is already in the bundle); slide 200–250 ms at
60 fps using `transform` only; list scroll restored on the same frame as the list is shown.

**Constraints**: dependency rules R1–R12 (phone code gated by `isMobileHost()` / `isFeatureAvailable()` from
`@app/platforms/host`, no suffixed imports outside `platforms/`); `window.api` only in `api.electron.ts`; **no Main /
preload / IPC change** (both hosts already expose `getAppInfo` and `openExternalLink`); theme tokens only; every text
from the i18n catalogue (`readmate/no-ui-literals`); Vietnamese per glossary; Desktop layout and behaviour unchanged
apart from FR-018–FR-020.

**Scale/Scope**: 1 phone screen (list + section page + header), ~5 new UI files, 1 new store + 1 hook, 2 small core
modules, ~12 i18n keys × 2, ~10 edited files (sections, dialogs, nav, About), 1 glossary row.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template (no ratified principles). The gates applied are the project
rules from `CLAUDE.md`:

| Gate | Status |
|---|---|
| core platform-agnostic (R1–R3): `config/app-links.ts`, `settings/phone-settings-nav.ts` are pure, no DOM / Node | ✅ |
| No `.native` / `.electron` import outside `platforms/` (R12): phone screen chosen by `isMobileHost()` | ✅ |
| `window.api` only in `api.electron.ts` (R9): About uses `appApi.getAppInfo` / `openExternalLink` from `bridge/app.ts` | ✅ |
| IPC four places in sync | ✅ n/a — no new channel |
| Main-file changes approved (`check:desktop-baseline`) | ✅ n/a — no Main file touched |
| Mobile-only store needs a written reason (`contracts/phone-ui.md`) | ✅ planned — `phoneSettingsNavStore` (slide-out layer + list scroll), reason in [contracts/phone-settings-ui.md](./contracts/phone-settings-ui.md) |
| Hook-owned state in zustand (project preference) | ✅ back-close stack and phone nav state are zustand stores |
| Desktop unchanged except FR-018–FR-020 (FR-012, SC-006) | ✅ desktop keeps `SettingsSidebar` + panel; phone CSS scoped to `[data-mobile-host]` |
| No literal UI text; vi glossary | ✅ planned — new keys in `settings` / `chrome` areas, glossary row "More → Khác" |

Post-design re-check: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/014-mobile-settings-layout/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: UI state, link + section models
├── quickstart.md        # Phase 1: device + desktop validation pass
├── contracts/
│   └── phone-settings-ui.md   # Phase 1: routes, components, CSS hooks, stores, i18n keys
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
source/core/src/
├── config/app-links.ts                  # NEW: privacy-policy URL, store URLs, storePageUrl(platform)
├── settings/phone-settings-nav.ts       # NEW: sectionFromParam(), phone section list rules (pure)
└── i18n/catalogue/{en,vi}/{settings,chrome}.ts   # EDIT: More / Khác, back, open in store, loading/unknown

source/core/tests/
├── config/app-links.test.ts             # NEW
└── settings/phone-settings-nav.test.ts  # NEW

source/app/
├── App.tsx                              # EDIT: route `/settings/:section?`
├── components/chrome/PhoneNav.tsx       # EDIT: "More" icon (label comes from the catalogue)
├── components/chrome/AppMenubar.tsx     # unchanged code (label comes from the catalogue)
├── hooks/app/useBackClose.ts            # NEW: system Back closes a dialog first (history entry)
├── hooks/app/backCloseStore.ts          # NEW: zustand stack of back-closable layers
├── platforms/host-types.ts, host.native.ts   # EDIT: feature 'uiDensity' unavailable on the phone
├── styles/phone.css                     # EDIT: .phone-settings rules (targets, switch rows, danger, text, slide)
├── styles/theme.css                     # EDIT: --lib-danger token per theme
└── screens/Settings/
    ├── SettingsScreen.tsx               # EDIT: lazy MobileSettingsScreen on the Mobile host
    ├── phone/
    │   ├── MobileSettingsScreen.tsx     # NEW: list ⇄ section page by route, slide layer
    │   ├── PhoneSettingsList.tsx        # NEW: grouped rows (icon, name, description, chevron)
    │   ├── PhoneSettingsHeader.tsx      # NEW: back + title (list: title only)
    │   └── PhoneSettingsSectionPage.tsx # NEW: renders the existing section component
    ├── logic/phoneSettingsNavStore.ts   # NEW: leaving page, list scrollTop
    ├── logic/updatesStore.ts            # EDIT: keep platform from getAppInfo
    └── components/
        ├── appearance/AppearanceSettings.tsx   # EDIT: Density card behind 'uiDensity'
        ├── about/AboutSettings.tsx             # EDIT: real version, links, phone Updates card
        ├── privacy/PrivacySettings.tsx, privacy/ClearDataDialog.tsx   # EDIT: CSS hooks, label rows, useBackClose
        ├── advanced/AdvancedSettings.tsx       # EDIT: CSS hooks on action / danger buttons
        └── layout/SettingsSwitch.tsx           # EDIT: `settings-switch` hook class
source/app/screens/Library/components/book/ConfirmBookActionDialog.tsx   # EDIT: useBackClose, action hook classes
specs/012-app-ui-i18n/contracts/glossary.md   # EDIT: "More (navigation) → Khác"
```

**Structure Decision**: Same single-project layout as spec 013: the phone screen lives next to the desktop one under
`screens/Settings/phone/`, chosen at runtime by `isMobileHost()`; pure rules go to `source/core` with vitest tests.

## Complexity Tracking

No violations to justify.
