---

description: "Task list for spec 014 — Mobile Settings screen layout (More)"
---

# Tasks: Mobile Settings screen layout (shell only)

**Input**: Design documents from `specs/014-mobile-settings-layout/` (plan.md, spec.md, research.md, data-model.md,
contracts/phone-settings-ui.md, quickstart.md)

**Tests**: Included for the two pure core modules (plan.md Testing: `config/app-links.test.ts`,
`settings/phone-settings-nav.test.ts`), written first. The shared UI has no test runner: UI is checked by
`npm run check` and the device / desktop pass in `quickstart.md`. Never run E2E (manual-only rule in CLAUDE.md).

**Paths**: relative to the repository root. `@app` = `source/app`, core = `source/core`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

**Purpose**: work on the feature branch.

- [X] T001 Create branch `014-mobile-settings-layout` from the current HEAD (`git switch -c 014-mobile-settings-layout`), leave the unrelated uncommitted files (`electron-builder.json5`, `source/scripts/check-desktop-package*.mjs`, `source/scripts/desktop-package-deps.mjs`) unstaged, and confirm `.specify/feature.json` points to `specs/014-mobile-settings-layout`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: pure rules in core, the router entry, the phone screen shell, i18n keys and the phone CSS scope. Every
story builds on this.

**⚠️ CRITICAL**: no user story work before this phase is done.

- [X] T002 [P] Write failing tests in `source/core/tests/settings/phone-settings-nav.test.ts` for `sectionFromParam(param: string | undefined, visible: readonly string[]): string | null` — returns the param when it is one of `visible`; returns `null` for `undefined`, `''`, an unknown id, or an id not in `visible` (e.g. `'storage'` when visible is `['appearance','privacy','advanced','about']`); is case-sensitive
- [X] T003 [P] Write failing tests in `source/core/tests/config/app-links.test.ts`: `PRIVACY_POLICY_URL === 'https://lethaian15112004.github.io/reading-book-app-privacy-policy/'`; `storePageUrl('android') === 'https://play.google.com/store/apps/details?id=com.anle.readmate'`; `storePageUrl('ios') === 'https://apps.apple.com/us/app/readmate-reader/id6789796532'`; `storePageUrl` returns `null` for `'win32'`, `'darwin'`, `'linux'`, `undefined`, `''`; every exported URL starts with `https://` and contains no whitespace
- [X] T004 [P] Implement `source/core/src/settings/phone-settings-nav.ts` (`sectionFromParam`) and `source/core/src/settings/index.ts`; export from `source/core/src/index.ts`; make T002 pass (`cd source/core && npx vitest run tests/settings/phone-settings-nav.test.ts`). Pure TypeScript only (R1–R3)
- [X] T005 [P] Implement `source/core/src/config/app-links.ts` (`PRIVACY_POLICY_URL`, `PLAY_STORE_URL`, `APP_STORE_URL`, `storePageUrl(platform: string | undefined): string | null` — `'android'` → Play, `'ios'` → App Store, anything else `null`) and export it from `source/core/src/config/index.ts`; make T003 pass
- [X] T006 [P] Add i18n keys in `source/core/src/i18n/catalogue/en/settings.ts` and the same shape in `vi/settings.ts`: `settings.phone.back` ("Back" / "Quay lại"), `settings.phone.listAria` ("Settings sections" / "Các mục cài đặt"), `settings.about.openInStore` ("Open in store" / "Mở trong cửa hàng"); change the value of `settings.title` to "More" / "Khác"
- [X] T007 [P] Change the value of `chrome.nav.settings` to "More" / "Khác" in `source/core/src/i18n/catalogue/en/chrome.ts` and `vi/chrome.ts`, and add a row "More (navigation entry) | Khác" to `specs/012-app-ui-i18n/contracts/glossary.md`; run `npm run sdk:test` (i18n shape + glossary anchor tests must stay green)
- [X] T008 Change the route in `source/app/App.tsx` from `/settings` to `/settings/:section?` (same `SettingsScreen` element); Desktop ignores the param (contract §2)
- [X] T009 [P] Create `source/app/screens/Settings/logic/phoneSettingsNavStore.ts` (zustand, data-model.md): `listScrollTop: number`, `leaving: { section: SettingsSectionId; token: number } | null`, actions `saveListScroll(top)`, `resetListScroll()`, `startLeaving(section)` (sets a new token, schedules clear after 200 ms only if the token still matches), `clearLeaving()`; header comment states the Mobile-only reason from contract §8
- [X] T010 Create `source/app/screens/Settings/phone/MobileSettingsScreen.tsx` (default export for `lazy`): root `<div className="phone-settings …">` filling the frame; reads `:section` with `useParams`, resolves it with core `sectionFromParam(param, visibleSettingsSections().map(s => s.id))`; invalid param → `<Navigate to="/settings" replace />`; renders the list page when no section, else the list (kept mounted, `aria-hidden` + `inert` while covered) plus the section layer (placeholders for the components of US1/US2)
- [X] T011 In `source/app/screens/Settings/SettingsScreen.tsx`, when `isMobileHost()` render `<Suspense fallback={null}><MobileSettingsScreen /></Suspense>` with `const MobileSettingsScreen = lazy(() => import('./phone/MobileSettingsScreen'))`; the desktop tree (sidebar + header + panel) stays exactly as it is
- [X] T012 [P] Add the phone scope block to `source/app/styles/phone.css`: `:root[data-mobile-host] .phone-settings` (full height, column flex, theme background), `.phone-settings-body` (`flex: 1; overflow-y: auto; overflow-x: hidden; padding-inline: 16px`), and at `@media (min-width: 900px)` `.phone-settings-body > .phone-settings-content { max-width: 640px; margin-inline: auto }` (FR-007, FR-013, FR-015)

**Checkpoint**: `npm run typecheck` green; on the phone `/settings` renders the (empty) phone shell, Desktop unchanged.

---

## Phase 3: User Story 1 — Find a setting from a readable list (P1) 🎯 MVP

**Goal**: tapping the 4th tab ("More") shows a titled, full-width list of the phone's sections; no icon rail.

**Independent Test**: open the phone app, tap More → title "More", rows Appearance / Privacy / Advanced / About, each
with icon, name, description and chevron; no rail; no Storage / Notifications / Shortcuts rows (quickstart steps 1, 12).

- [X] T013 [P] [US1] Create `source/app/screens/Settings/phone/PhoneSettingsHeader.tsx`: props `title: string`, `onBack?: () => void`; header row min-height 56 px, same tokens as the Mobile Library header (`bg-lib-bg-deep`, `border-lib-border-soft`); when `onBack` is set, a `<button type="button">` 48 × 48 with an SVG left chevron (`aria-hidden`) and `aria-label={t('settings.phone.back')}`; title is an `<h1>` with `truncate`; focus ring `focus-visible:outline-2 focus-visible:outline-lib-accent`
- [X] T014 [P] [US1] Create `source/app/screens/Settings/phone/PhoneSettingsList.tsx`: props `sections`, `onOpen(id)`; `<ul aria-label={t('settings.phone.listAria')}>` inside one rounded group (`rounded-xl border border-lib-border-soft bg-lib-surface-strong/60`, dividers `divide-y divide-lib-border-soft`); each `<li><button>` is the whole row, `min-h-12` (48 px), `SettingsSectionIcon` (`aria-hidden`), name `text-[15px] font-semibold text-lib-text-strong`, description from `settings.sectionDescriptions.<id>` `text-[13px] text-lib-muted line-clamp-2` (wraps, max 2 lines), right SVG chevron (`aria-hidden`); pressed feedback `active:bg-lib-surface-hover`; focus ring as T013
- [X] T015 [US1] In `MobileSettingsScreen.tsx` render the list page: `<PhoneSettingsHeader title={t('settings.title')} />` + `.phone-settings-body > .phone-settings-content` with `PhoneSettingsList` of `visibleSettingsSections()` (keeps the existing order; hidden sections never appear, FR-010); `onOpen` → `navigate('/settings/' + id)`
- [X] T016 [P] [US1] In `source/app/components/chrome/PhoneNav.tsx` replace the `settings` gear icon with a "more" icon (three dots in a rounded square, `strokeWidth="1.8"`, same style); the label already comes from `chrome.nav.settings` ("More"). The tab's `onSelect` uses `navigate('/settings', { replace: path.startsWith('/settings') })` and calls `usePhoneSettingsNavStore.getState().resetListScroll()` when coming from another tab (FR-006, research R2)
- [X] T017 [US1] Remove the phone-only branch from `source/app/screens/Settings/components/layout/SettingsSidebar.tsx` (`isMobileHost()` collapse + hidden toggle are dead code now that the phone never renders the sidebar); Desktop behaviour unchanged

**Checkpoint**: US1 testable on device (quickstart steps 1, 12).

---

## Phase 4: User Story 2 — Open a section and come back (P1)

**Goal**: a row opens the section as its own page with back + title; header back and Android Back return to the list
at the same scroll position; dialogs close first; short directional slide.

**Independent Test**: quickstart steps 2, 3, 4, 5, 7.

- [X] T018 [P] [US2] Create `source/app/screens/Settings/phone/PhoneSettingsSectionPage.tsx`: props `section: SettingsSectionId`, `leaving?: boolean`; root `.phone-settings-page` (+ `.phone-settings-page--leaving` when leaving, `pointer-events: none`), absolute full-size layer above the list with the theme background; `<PhoneSettingsHeader title={t(label)} onBack={…} />` + `.phone-settings-body > .phone-settings-content` rendering the existing component (`AppearanceSettings`, `PrivacySettings`, `AdvancedSettings`, `AboutSettings`) unchanged
- [X] T019 [US2] Wire navigation in `MobileSettingsScreen.tsx`: opening a row first calls `saveListScroll(listBody.scrollTop)`; header back = `navigate(-1)` when `location.key !== 'default'` and the previous entry is the list (track with `useNavigationType()` / a ref of the last path), else `navigate('/settings', { replace: true })`; when the route goes from a section back to the list, call `startLeaving(prevSection)` unless reduced motion is on (`matchMedia('(prefers-reduced-motion: reduce)')`), and restore the list's `scrollTop` from the store in a layout effect (FR-006); any new navigation calls `clearLeaving()` first (FR-016 edge: last action wins)
- [X] T020 [P] [US2] Add the slide rules to `source/app/styles/phone.css` under `:root[data-mobile-host] .phone-settings`: `.phone-settings-page { animation: phone-settings-in 220ms cubic-bezier(0, 0, 0.2, 1) both }`, `.phone-settings-page--leaving { animation: phone-settings-out 200ms cubic-bezier(0.4, 0, 1, 1) both; pointer-events: none }`, keyframes on `transform: translateX(100%) ↔ translateX(0)` only; `@media (prefers-reduced-motion: reduce) { animation: none }` (FR-016)
- [X] T021 [P] [US2] Create `source/app/hooks/app/backCloseStore.ts` (zustand, data-model.md "backCloseStore"): `stack: { id: string; close: () => void }[]`, `push(close) → id` (pushes one `history.pushState({...history.state, readmateBackClose: id}, '')` on a 0 ms timer, like `PhoneBookSheet.tsx:56-90`), `remove(id)` (pops its history entry if it is the current one), and one global `popstate` listener that closes the top entry when its state is no longer current; header comment states the Mobile-only reason (contract §8)
- [X] T022 [US2] Create `source/app/hooks/app/useBackClose.ts`: `useBackClose(open: boolean, onClose: () => void)`; no-op when `!isMobileHost()`; on `open` registers with `backCloseStore`, on close / unmount removes the entry (so the next Back goes where it went before); keep `onClose` in a ref; export from `source/app/hooks/app/index.ts`
- [X] T023 [P] [US2] Use `useBackClose(true, onCancel)` in `source/app/screens/Library/components/book/ConfirmBookActionDialog.tsx` (Reset App Settings confirmation); Escape handling unchanged
- [X] T024 [P] [US2] Use `useBackClose(true, onCancel)` in `source/app/screens/Settings/components/privacy/ClearDataDialog.tsx`; Escape handling unchanged

**Checkpoint**: US1 + US2 = the MVP list → detail flow on device (quickstart steps 1–5, 7).

---

## Phase 5: User Story 3 — A Settings screen that looks like the rest of the phone app (P2)

**Goal**: phone look shared with the Mobile Library, phone-standard building blocks, Density hidden, About fixed.

**Independent Test**: quickstart steps 6, 8, 9, 10 and the Desktop pass.

### Shared building blocks (FR-014)

- [X] T025 [P] [US3] Add `--lib-danger` to each theme block in `source/app/styles/theme.css`: Night and Sepia `#f87171`, Paper `#b91c1c` (done: Paper uses #b91c1c — #dc2626 was only 3.92:1 on the `#e2e8f0` surface; Night 6.45:1, Sepia 6.74:1, Paper 5.25–6.47:1)
- [X] T026 [P] [US3] Add the hook class `settings-switch` to the button in `source/app/screens/Settings/components/layout/SettingsSwitch.tsx` (no other change)
- [X] T027 [P] [US3] In `source/app/screens/Settings/components/privacy/PrivacySettings.tsx` add `settings-switch-row` to the flex row that wraps the label and `SettingsSwitch`, add `settings-action` and `data-tone="danger"` to the Clear data button (classes only, layout unchanged)
- [X] T028 [P] [US3] In `source/app/screens/Settings/components/advanced/AdvancedSettings.tsx` add `settings-action` to the Check for updates and Reset buttons and `data-tone="danger"` to the Reset button (classes only)
- [X] T029 [P] [US3] In `ClearDataDialog.tsx` add `settings-choice-row` to each option row (it already was a `<label>` wrapping the checkbox and its text); add `settings-action` to both buttons and `data-tone="danger-filled"` to the filled red Clear button (analysis U1: `danger` would turn its text red on red)
- [X] T030 [P] [US3] In `ConfirmBookActionDialog.tsx` add `settings-action` to both buttons and `data-tone="danger-filled"` to the filled red confirm button when `destructive` (analysis U1)
- [X] T031 [US3] Add the building-block rules to `source/app/styles/phone.css` (contract §4), all under `:root[data-mobile-host]` and — except the dialog rules, which also need the phone host only — under `.phone-settings`: `.settings-switch-row { position: relative; min-height: 48px; align-items: center }`, `.settings-switch::after { content: ''; position: absolute; inset: 0 }`, `.settings-action { min-height: 48px }`, `[data-tone='danger'] { color: var(--lib-danger); border-color: var(--lib-danger) }`, `.settings-choice-row { min-height: 48px }`, `.phone-settings .text-\[10px\], .phone-settings .text-\[11px\] { font-size: 12px }`

### Density hidden on the phone (FR-017)

- [X] T032 [P] [US3] Add `'uiDensity'` to `AppFeature` in `source/app/platforms/host-types.ts` and to `MOBILE_UNAVAILABLE` in `source/app/platforms/host.native.ts` (Electron keeps everything available)
- [X] T033 [US3] In `source/app/screens/Settings/components/appearance/AppearanceSettings.tsx` render the Density `SettingsCard` only when `isFeatureAvailable('uiDensity')`; the stored value and `setDensity` are untouched
- [X] T034 [P] [US3] In `source/app/styles/phone.css` pin `--ui-density-row: 3rem; --ui-density-gap: 1rem; --ui-density-pad: 1rem; --ui-density-content-x: 0; --ui-density-content-y: 1rem` on `:root[data-mobile-host], :root[data-mobile-host][data-density]` so a stored Compact / Comfortable value has no effect on the phone

### About page (FR-019, FR-020, FR-021)

- [X] T035 [US3] In `source/app/screens/Settings/logic/updatesStore.ts` keep `platform: string | null | undefined` from `appApi.getAppInfo()` next to `version` (same call, same null = loading / undefined = failed convention)
- [X] T036 [US3] In `source/app/screens/Settings/components/about/AboutSettings.tsx` remove `ABOUT_APP_VERSION`; call `loadVersion()` on mount; show `version` in App info and the Updates card with "Loading…" (`settings.loading`) for `null` and "Unknown" (`settings.advanced.unknown`) for `undefined`, never "0.0.0" (FR-019)
- [X] T037 [US3] In `AboutSettings.tsx` change `AboutLinkItem.destination` to `string | null`: `privacy-policy` → `PRIVACY_POLICY_URL`, `store-page` → `storePageUrl(platform)`, others `null`; render only rows with a destination as enabled buttons that call `appApi.openExternalLink(destination)`; skip a group (`SettingsCard`) whose list is empty; delete `NotAvailableBadge` and the disabled-row code (FR-020)
- [X] T038 [US3] In `AboutSettings.tsx` on the Mobile host (`isMobileHost()`) render the Updates card with the version and, when `storePageUrl(platform)` is not `null`, an enabled `settings-action` button `t('settings.about.openInStore')` that opens it; on Desktop keep today's Updates card markup (FR-021)

**Checkpoint**: quickstart steps 6, 8, 9, 10 pass; Desktop About shows the real version and only the Privacy Policy row.

---

## Phase 6: User Story 4 — Same screen in both languages (P3)

**Goal**: every text of the frame follows the interface language.

**Independent Test**: quickstart step 11.

- [X] T039 [US4] Check every new / changed component (`PhoneSettingsHeader`, `PhoneSettingsList`, `PhoneSettingsSectionPage`, `MobileSettingsScreen`, `AboutSettings`, `PhoneNav`) uses `useT()` only — no literal UI text (`npm run desktop:lint`, rule `readmate/no-ui-literals`), and that the vi values of T006 / T007 follow `specs/012-app-ui-i18n/contracts/glossary.md` (no "bạn")
- [ ] T040 [US4] Verify on device that switching App Language to Tiếng Việt updates the tab ("Khác"), list title, rows, section headers and the back control's accessible name ("Quay lại") without reopening the screen

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 Update `CLAUDE.md` "Mobile app" section with one bullet for spec 014 (phone More screen: `/settings/:section?`, `screens/Settings/phone/`, `useBackClose`, `uiDensity` feature, About links in `@core/config/app-links`) and mention that the Settings nav entry is labelled "More / Khác" on both hosts
- [X] T042 Run `npm run check` (typecheck, lint, sdk + mobile tests, boundaries, platform adapters, builds, build split) and fix anything red; confirm `npm run check:desktop-baseline` needs no new Main approval
- [ ] T043 Run the device pass (quickstart steps 1–12) and the Desktop pass (SC-006) from `specs/014-mobile-settings-layout/quickstart.md`; record any deviation in the spec's Clarifications or as a follow-up
- [X] T044 [P] Leave a note in `specs/014-mobile-settings-layout/quickstart.md` "Known outside-scope item" if `docs/store/privacy-policy.html` is still uncommitted / has TODO markers at the end of the feature (do not edit that file here)

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (T001) → Foundational (T002–T012) → user stories.
- **US1** (T013–T017) needs T006–T012.
- **US2** (T018–T024) needs US1's list (T015) for the list ⇄ page flow; T021–T024 (back-close) only need T008.
- **US3** (T025–T038) needs Foundational; building blocks (T025–T031) are independent of US1/US2 code but are only
  visible inside the phone screen; About tasks need T005.
- **US4** (T039–T040) after US1–US3 (checks their texts).
- Polish after all stories.

### Within a phase

- T002 before T004; T003 before T005 (tests first).
- T010 before T011, T015, T018, T019.
- T021 before T022; T022 before T023, T024.
- T026–T030 before T031 is verified on device.
- T035 before T036–T038; T036 → T037 → T038 (same file).

## Parallel Example

```text
# Foundational, after T001:
T002, T003, T006, T007, T009, T012   (different files)
then T004 (after T002), T005 (after T003)

# US1:
T013, T014, T016 together, then T015, then T017

# US2:
T018, T020, T021 together; T022 after T021; then T023 + T024 together; T019 last

# US3:
T025, T026, T027, T028, T029, T030, T032, T034 together; then T031, T033, T035 → T036 → T037 → T038
```

## Implementation Strategy

1. **MVP = US1 + US2** (both P1): list + section page + back (header and system Back) + dialogs closing first. Ship
   check: quickstart steps 1–5, 7, 12.
2. **US3**: phone look, building blocks, Density hidden, About (version, links, Open in store) — quickstart 6, 8–10 and
   the Desktop pass.
3. **US4**: language check — quickstart 11.
4. Polish: CLAUDE.md, `npm run check`, full device + desktop pass.
