# Tasks: App interface in Vietnamese and English (i18n)

**Input**: Design documents from `specs/012-app-ui-i18n/` — [plan.md](plan.md), [spec.md](spec.md),
[research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included — FR-015 requires automated completeness checks, and the project's convention is vitest in
`source/core/tests` plus spike scripts for Main. E2E is manual-only and is NOT run by the agent.

**Format**: `- [ ] T### [P?] [US?] Description with file path`. `[P]` = touches different files from other open
tasks and depends on no unfinished task.

**Conventions used by every "area" task** (US1, US3, US4) — read once:

1. Create / fill `source/core/src/i18n/catalogue/en/<area>.ts` (`export const en = { … } as const`) with every
   interface text of the listed files, keys grouped by component (`library.empty.title`), placeholders `{name}`,
   plurals `{ one, other }` with `count` (contract [i18n-core-api.md](contracts/i18n-core-api.md)).
2. Replace each literal at its call site with `t('…')` from `useT()` (React) or `getT()` (stores / helpers);
   state shown later than produced stores a `MessageRef` (`{ key, params }`). User data (titles, authors, notes, file
   names, book text) is NEVER put through `t` (FR-009).
3. Replace the `pendingArea(…)` marker in `source/core/src/i18n/catalogue/vi/<area>.ts` with the complete Vietnamese
   object `satisfies AreaShape<typeof en>`, following [contracts/glossary.md](contracts/glossary.md) (fully
   Vietnamese, neutral tone, no "bạn", Xóa ≠ Gỡ, Ghi chú ≠ Bình luận).
4. Remove the first-line `/* i18n-pending: <area> */` header from each converted file.
5. `npm run typecheck`, `npm run lint`, `npm run sdk:test` green; manually check the area in Tiếng Việt at minimum
   window width (FR-013).

---

## Phase 1: Setup

- [X] T001 Create the folder skeleton `source/core/src/i18n/` (`index.ts`, `types.ts`, `language.ts`, `translate.ts`, `format.ts`, `pending.ts`, `catalogue/en/index.ts`, `catalogue/vi/index.ts`) and `source/core/tests/i18n/`, and re-export `./i18n` from `source/core/src/index.ts`
- [X] T002 [P] Write the dev inventory script `source/scripts/i18n-inventory.mjs` (no dependency; walks `source/app/{screens,components,hooks}`, `App.tsx`, `source/app/platforms/electron/**` except `e2e/`, `spikes/`, and `source/core/src`; prints per file the JSX text nodes and string literals that look like interface text — letter + space or capitalised word — skipping `console.*`, imports, CSS class strings, test ids); add `"i18n:inventory": "node source/scripts/i18n-inventory.mjs"` to `package.json`
- [X] T003 [P] Write `docs/implementation_plan/app_i18n.md` (map of the feature: modules, area list, how to add a text, how to add an area, glossary link) — kept updated by later tasks

---

## Phase 2: Foundational (blocks every story)

### Core i18n module (contract [i18n-core-api.md](contracts/i18n-core-api.md))

- [X] T004 Define types in `source/core/src/i18n/types.ts`: `UiLanguage = 'vi' | 'en'`, `UiLanguagePreference = 'system' | UiLanguage`, `Message = string | PluralMessage`, `PluralMessage = { one?: string; other: string; zero?: string }`, `AreaMessages` (nested), `AreaShape<T>` (same keys as `T`, leaves `string` or `PluralMessage` with `other`), `MessageKey` = every dotted leaf path of `EN_CATALOGUE`, `Params = Readonly<Record<string, string | number>>`, and a param type that makes `count` REQUIRED for plural keys
- [X] T005 Implement `resolveUiLanguage(pref, deviceLocales: readonly string[])` and `localeTag(lang)` in `source/core/src/i18n/language.ts` exactly per the table in [data-model.md](data-model.md) (`system` + first locale starting with `vi`, case-insensitive → `vi`; anything else, empty or unreadable → `en`; `vi` → `vi-VN`, `en` → `en-US`)
- [X] T006 Implement `translate`, `createTranslator` in `source/core/src/i18n/translate.ts`: lookup by dotted path in the language catalogue, fall back to English when the area is pending or the key missing; `{name}` substitution done in ONE pass on the message (inserted values never re-parsed); missing param → `''` + one `console.warn` per key; unknown key → `''` + one warning (never the raw key); plural form via cached `Intl.PluralRules(localeTag(lang))` with `Number(params.count)`, falling back to `other`
- [X] T007 [P] Implement `pendingArea(reason)` (throws on empty reason) and the derived `PENDING_VI_AREAS: readonly { area; reason }[]` in `source/core/src/i18n/pending.ts`, computed from `catalogue/vi/index.ts`
- [X] T008 [P] Implement formatters in `source/core/src/i18n/format.ts` (`formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `formatBytes` B/KB/MB/GB 1 decimal with locale separator, `formatDuration(seconds, 'clock' | 'long')`; long form words come from the `common.duration.*` catalogue keys), with `Intl` instances cached per language
- [X] T009 Create every English area as an empty stub and register it in `source/core/src/i18n/catalogue/en/index.ts` — areas: `common`, `chrome`, `library`, `import`, `settings`, `reader.chrome`, `reader.sidebar`, `reader.annotations`, `reader.tools`, `reader.pdf`, `reader.text`, `reader.phone`, `reader.logic`, `audiobook.player`, `audiobook.transcription`, `appHooks`, `main.messages`, `main.shell`, `exports` (one file per area, `.` → `-` in file names); create the matching `catalogue/vi/<area>.ts` files each exporting `pendingArea('not translated yet')` and register them in `catalogue/vi/index.ts`; add `common` entries for shared words (OK, Cancel, Close, Save, Delete, Remove, Retry, Open, Undo, Redo, `common.duration.*`) and translate `common` fully (vi), since every area depends on it
- [X] T010 [P] Unit tests `source/core/tests/i18n/language.test.ts` (whole resolve table incl. `VI-vn`, `en-GB`, `fr`, `[]`) and `source/core/tests/i18n/translate.test.ts` (placeholder substitution, value containing `{x}` / `<b>` / `%` shown literally, plural en `one`/`other` at 0/1/2, vi `other`, fallback to English for a pending area, unknown key → `''` not the key, missing param → `''`)
- [X] T011 [P] Unit tests `source/core/tests/i18n/format.test.ts` (vi `1,5 MB`, en `1.5 MB`, vi date day/month/year order, percent, durations clock + long in both languages)
- [X] T012 [P] Catalogue completeness test `source/core/tests/i18n/catalogue-completeness.test.ts`: every English area has exactly one Vietnamese file; each Vietnamese file is either a pending marker with a non-empty reason or has exactly the English keys; per key the set of `{placeholders}` is identical; no empty message; plural messages have `other` (en also `one`); slot tags `<x>…</x>` identical per key

### Renderer i18n (contract [renderer-i18n.md](contracts/renderer-i18n.md))

- [X] T013 Create `source/app/i18n/uiLanguageStore.ts` (zustand: `language: UiLanguage`; `initUiLanguage(pref)` resolves with `navigator.languages` and sets state without side effects; `setUiLanguagePreference(pref)` resolves, sets state, then calls the bridge `setUiLanguage(pref)` fire-and-forget)
- [X] T014 [P] Create `source/app/i18n/useT.ts` (`useT()` subscribed to the store, `getT()` reading the store at call time, `useFormat()` binding the T008 formatters) and `source/app/i18n/TransText.tsx` (renders a message whose `<slot>…</slot>` markers are replaced by `slots[slot](text)` React nodes; plain text elsewhere)
- [X] T015 Wire boot + changes: in `source/app/main.tsx` call `initUiLanguage(appearance.language)` inside the existing pre-render `try` block (before `ReactDOM.createRoot`) and send the preference once after mount; in `source/app/theme/appAppearanceStore.ts` `commit()` call `setUiLanguagePreference(language)` (covers `setLanguage` AND `reset()`); make `resolveAppLanguage` in `source/app/theme/appAppearance.ts` delegate to core `resolveUiLanguage(language, navigator.languages)` and update the stale comment at its line ~168 ("UI strings themselves are not translated yet")

### Main i18n + IPC (contract [ui-language-ipc.md](contracts/ui-language-ipc.md))

- [X] T016 Add `setUiLanguage: 'app:setUiLanguage'` to `AppChannels` in `source/app/platforms/electron/ipc/channels.ts`, `UiLanguagePreferenceDto` + `SetUiLanguageResultDto` and `app.setUiLanguage` to `DesktopApi` in `source/app/platforms/electron/ipc/api-types.ts`, expose it in `source/app/platforms/electron/preload.ts`
- [X] T017 Create `source/app/platforms/electron/i18n/main-i18n.ts`: mirror file `{userData}/ui-language.json` `{ "version": 1, "preference": "system" }` via `prefs/json-prefs-file.ts` (missing / unreadable / invalid → `system`), `loadMainUiLanguage()`, `getMainUiLanguage()` (resolved with `app.getPreferredSystemLanguages()`), `setMainUiLanguagePreference(pref)`, `tMain(key, params)`, `onMainUiLanguageChange(listener)` (fires only when the effective language changes)
- [X] T018 Register the `app:setUiLanguage` handler in `source/app/platforms/electron/ipc/app.ipc.ts` (anything but `system|vi|en` → `{ ok: false, code: 'INVALID_ARGUMENT' }` and nothing changed; write failure → apply in memory and answer `{ ok: false, code: 'WRITE_FAILED' }`; else `{ ok: true, effective }`) and call `loadMainUiLanguage()` in `source/app/platforms/electron/main.ts` at `ready`, before the tray, windows and reminder worker start
- [X] T019 [P] Add `setUiLanguage` to `source/app/bridge/app.ts` (swallows `NOT_AVAILABLE_ON_PLATFORM` and any rejection) and `app.setUiLanguage` → `NOT_AVAILABLE_ON_PLATFORM` in `source/app/platforms/native/bridge/unavailable.ts` (so `create-api.ts` still satisfies `Window['api']`)
- [X] T020 [P] Spike `source/app/platforms/electron/spikes/i18n-main.mjs` + `"spike:i18n:main"` script (stubbed `electron`, temp userData): mirror read / write / corrupt file → `system`; handler validation and `WRITE_FAILED` path; `onMainUiLanguageChange` fires once per effective change; `tMain` vi / en
- [X] T021 List every Main file changed in this phase in `source/scripts/desktop-main-changes.json` with the reason "spec 012 i18n" (`npm run check:desktop-baseline`)

### Lint guard (research R3)

- [X] T022 Write the ESLint rule `source/scripts/eslint-rules/no-ui-literals.mjs` (reports JSX text containing a letter and string literals / template literals without expressions in the attributes `title`, `aria-label`, `placeholder`, `alt`, `label`, `description`, `message`, `confirmLabel`, `cancelLabel`; skips a file whose first line is `/* i18n-pending: <area> */`; honours `// i18n-ignore: <reason>` / `{/* i18n-ignore: <reason> */}` on the line or the line before, reason required) and its `RuleTester` test `source/scripts/eslint-rules/no-ui-literals.test.mjs` (wire the test into `npm test`)
- [X] T023 Enable the rule as `readmate/no-ui-literals: 'error'` for `source/app/{screens,components,hooks}/**/*.tsx` and `source/app/App.tsx` in `eslint.config.mjs`; run `npm run i18n:inventory` and add the matching `/* i18n-pending: <area> */` first-line header (area from the T009 list) to every file that has findings, so `npm run lint` stays green
- [X] T024 Run `npm run check`; fix anything red. **Checkpoint**: foundation ready, app behaves exactly as before (all areas pending → English)

**As built (2026-11-11), where it differs from the tasks above** (all checks green: `npm run check`, `spike:i18n:main`
9/9, `spike:settings:reset` 14/14, `check:desktop-baseline` 25/25, `tests/i18n` 44 tests):

- T006 / analysis D1: core has no `console` (R1) — warnings go through `setI18nWarningHandler()`, set by
  `source/app/i18n/uiLanguageStore.ts` and `platforms/electron/i18n/main-i18n.ts`.
- T007: `PENDING_VI_AREAS` is derived in `source/core/src/i18n/registry.ts` (not `pending.ts`, which the Vietnamese
  files import — that would be a cycle).
- T013 / T015: no `initUiLanguage()` call in `main.tsx`. `useUiLanguageStore` is DERIVED from
  `useAppAppearanceStore` (which already reads localStorage synchronously when its module loads), so the first frame
  is already in the right language and Reset App Settings is covered by the same subscription. The IPC send lives
  in `AppAppearanceBridge` (once at start + on every change), keeping the appearance store free of IPC.
- T018: validation is `handleSetUiLanguage()` in `main-i18n.ts` (so the spike tests the real logic);
  `app.ipc.ts` only registers it.
- T019: the Mobile entry is `setUiLanguage: notAvailable('setUiLanguage')` in
  `source/app/platforms/native/bridge/app.ts` (the `app` methods live there, not in `unavailable.ts`).
- T022 / analysis U1: the rule test runs in `desktop:lint` (`node --test … && eslint …`), like the other
  `source/scripts/*.test.mjs`. The rule has an `includePending` option used only by the inventory.
- T023: 112 `.tsx` files got a header; the folder → area table is in `docs/implementation_plan/app_i18n.md` (it also
  assigns `shortcuts/**`, `theme/appAppearance.ts` labels and `utils/annotationTransferMessages.ts`, analysis C1/C2).
- Extra: `spikes/reset-app-settings/sdk-stub.mjs` re-exports the real core i18n (`appAppearance.ts` now imports
  `resolveUiLanguage` from `@core`).

---

## Phase 3: User Story 1 — Use the whole app in Vietnamese (P1) 🎯 MVP

**Goal**: picking Tiếng Việt turns every interface text of the main window into Vietnamese, live, without losing the
open book or position.
**Independent test**: quickstart steps 1–3 and 8 — live switch on an open PDF, walk-through, 10 restarts, minimum
width.

Each task below follows the **area conventions** at the top.

- [X] T025 [P] [US1] Area `chrome`: `source/app/App.tsx`, `source/app/components/chrome/**`, `source/app/screens/Splash/**` (titlebar, menubar, `PhoneNav.tsx`, splash / loading, route errors)
- [X] T026 [P] [US1] Area `library`: `source/app/screens/Library/**` (book, browse, cloud, collections, continue, layout, shelves, logic stores' messages) and `source/app/hooks/library/**`; keep the existing `LibraryBookTable.tsx` date call for US4 (only its label texts here)
- [X] T027 [P] [US1] Area `import`: `source/app/components/import/**` (Import menu, URL / cloud / Audiobook ZIP dialogs, `AudiobookZipJobPanel`, refusal messages)
- [X] T028 [P] [US1] Area `settings`: `source/app/screens/Settings/**` (all sections: about, advanced incl. Reset App Settings confirmation, appearance, keyboard — key names stay literal with `i18n-ignore`, layout, notifications, privacy, storage) and the `SECTION` descriptions in `SettingsScreen.tsx` / `logic/settingsNavStore.ts`; in `source/app/theme/appAppearance.ts` translate only the `System Default` label (keep "Tiếng Việt" / "English" native, FR-009) — `APP_LANGUAGES` labels become keys resolved at render
- [X] T029 [P] [US1] Area `reader.chrome`: `source/app/screens/Reader/components/chrome/**`, `source/app/components/reader/chrome/**`, `components/reader/pageturn/**`, `components/reader/interaction/**`, `screens/Reader/components/canvas/**` (toolbar tools + tooltips, More menu, fold menu, zoom, page indicator)
- [X] T030 [P] [US1] Area `reader.sidebar`: `source/app/screens/Reader/components/sidebar/**`, `rightPanel/**`, `settings/**` (TOC, bookmarks, notes list, attachments tab, reading settings panel)
- [X] T031 [P] [US1] Area `reader.annotations`: `source/app/screens/Reader/components/highlights/**`, `components/dialogs/**`, `source/app/components/annotation-transfer/**`, `screens/Reader/logic/annotationTransferStore.ts`, `logic/highlights/**`, `logic/pdfExport/**` (annotation menus, delete confirmations, import preview incl. "not placed" reasons, export dialogs)
- [X] T032 [P] [US1] Area `reader.tools`: `source/app/screens/Reader/components/translation/**`, `components/sign/**`, `components/txt/**`, `logic/search/**`, `logic/wordCount/**`, `logic/readAloud/**`, `logic/translation/**`, `source/app/components/reader/tts/**` (Translate panel chrome — not language names from the translation engine list, which stay as provided —, search, word count, read aloud, signature panel)
- [X] T033 [P] [US1] Area `reader.pdf`: `source/app/components/reader/renderers/pdf/**`, `screens/Reader/logic/pdf*/**`, `logic/attachments/**` (typewriter "Not in the file" reasons, shapes, ink, attachment details / blocked / delete / signed dialog texts produced by these stores; the dialog component `components/dialogs/PageAttachmentDialogs.tsx` belongs to T031)
- [X] T034 [P] [US1] Area `reader.text`: `source/app/components/reader/renderers/{epub,md,txt}/**`, `screens/Reader/logic/txtDocument/**`, `logic/mdHighlights/**` (read-only notices, save failures, size limits)
- [X] T035 [P] [US1] Area `reader.phone`: `source/app/screens/Reader/phone/**`
- [X] T036 [P] [US1] Area `reader.logic`: remaining messages in `source/app/screens/Reader/logic/hooks/**`, `reader-core/**`, `session/**`, `book/**`, `bookRelink/**`, `bookSignature/**`, `bookIndex/**`, `floatingPanel/**`, `prefs/**`, `snapshot/**`, `zoom/**`, `rightPanel/**`, `screens/Reader/*.tsx`, `screens/ReaderRoute.tsx`, `source/app/hooks/reader/**` (missing file / relink / open errors → `MessageRef` where stored in state)
- [X] T037 [P] [US1] Area `audiobook.player`: `source/app/screens/AudioBook/**` except transcription (player, chapters panel, tracks, Notes incl. grouped-by-track headers, `AudioNoteMenu`, sleep timer, speed)
- [X] T038 [P] [US1] Area `audiobook.transcription`: `TranscribeDialog.tsx`, the Transcript tab in `AudioSidebar.tsx`, `screens/AudioBook/logic/transcriptStore.ts` (job states, `INTERRUPTED`, errors by code)
- [X] T039 [P] [US1] Area `appHooks`: `source/app/hooks/app/**` (update checks, global errors, notifications inside the window)
- [X] T040 [US1] Area `main.messages`: in `source/app/platforms/electron/ipc/*.ipc.ts` and the services they call, replace every user-visible `errorMessage` / `message` string returned to the renderer with `tMain('main.messages.…')` (codes / reasons unchanged, FR-011; `console.*` stays English); run `npm run i18n:inventory` on `platforms/electron` to find them; add the changed files to `source/scripts/desktop-main-changes.json`
- [X] T041 [US1] Live-switch robustness: verify (and fix where needed) that changing the language does not remount `ReaderRoute` / `AudioBookScreen` or reset their stores (no `key={language}` anywhere, no route navigation in the setter); document the result in `docs/implementation_plan/app_i18n.md`
- [X] T042 [US1] Run `npm run check` and quickstart steps 1–3 + 8 in Tiếng Việt; log any English text found as a fix in the area that owns it. **Checkpoint**: US1 complete — main window fully Vietnamese

---

## Phase 4: User Story 2 — "System Default" follows the device (P2)

**Goal**: with Theo hệ thống, the interface is Vietnamese on a Vietnamese device and English on any other.
**Independent test**: quickstart step 4.

- [X] T043 [US2] Confirm both processes use the same rule: renderer `initUiLanguage` / `setUiLanguagePreference` pass `navigator.languages` (falling back to `[navigator.language]`) and Main passes `app.getPreferredSystemLanguages()` (falling back to `[app.getLocale()]`) in `source/app/i18n/uiLanguageStore.ts` and `source/app/platforms/electron/i18n/main-i18n.ts`; add the fallback cases to `spike:i18n:main`
- [X] T044 [P] [US2] Add to `source/core/tests/i18n/language.test.ts` the explicit-choice-wins cases (`en` with `vi-VN` device → `en`; `vi` with `fr` device → `vi`) and a test that `loadAppAppearance` still defaults to `system` for a fresh install (in `source/core/tests` only if the parse helper is in core; otherwise in the `spike:settings:reset` checks — `source/app/platforms/electron/spikes/`)
- [X] T045 [US2] Mobile WebView: check `navigator.languages` is what the phone reports (Android WebView) and that `main.ts` in `source/app/platforms/native/` reaches the same `initUiLanguage` path through `@app/main`; note the RN host start-failure screen (`routes/index.tsx`) stays English (research R13) in `docs/implementation_plan/app_i18n.md`

---

## Phase 5: User Story 3 — Texts outside the window follow the language (P2)

**Goal**: tray menu, native dialogs, desktop notifications, Reading Reminders (and the readable Markdown export) use
the chosen language and follow a change without restart.
**Independent test**: quickstart steps 5 and 7.

- [X] T046 [US3] Tray: build the menu in `source/app/platforms/electron/background/background-mode.ts` from `tMain('main.shell.tray.open')` / `…quit` (keep "Readmate" literal inside the message as `{app}`), and rebuild it from `onMainUiLanguageChange`
- [X] T047 [P] [US3] Reading Reminders: title / body in `source/app/platforms/electron/reminders/reminder-schedule.ts` from `tMain` at notification creation (the emoji stays in the message); check other `new Notification` sites with `grep` in `platforms/electron` (only `reminders/reading-reminders.ts` today)
- [X] T048 [US3] Native dialogs: every `dialog.showOpenDialog` / `showSaveDialog` / `showMessageBox` in `source/app/platforms/electron/ipc/{import,library,overlay,attachments,annotation-transfer,transcription,zip-import}.ipc.ts` — `title`, `buttonLabel`, `message`, `detail`, `buttons`, filter `name`s via `tMain('main.shell.dialogs.…')`; extensions unchanged
- [X] T049 [US3] Fill and translate area `main.shell` (`catalogue/en/main-shell.ts`, `catalogue/vi/main-shell.ts`) for T046–T048 and area `main.messages` vi (`catalogue/vi/main-messages.ts`) if not completed in T040
- [X] T050 [US3] Readable export (FR-012, research R11): give `buildReadableMarkdown` in `source/core/src/annotation-transfer/readable-markdown.ts` a `labels: ReadableMarkdownLabels` parameter (chapter / page / section / notes / attachment `📎 name (size), page n` / date line) instead of hard-coded English; build the labels from area `exports` in the Main export service (`source/app/platforms/electron/annotation-transfer/`) with `getMainUiLanguage()`; restorable JSON untouched; update the existing tests in `source/core/tests/annotation-transfer/` to pass English labels and add one Vietnamese case ("Chương 3", "Trang 12")
- [X] T051 [P] [US3] `source/core/src/audio/audio-timeline.ts`: move its user-visible labels to the catalogue (area `audiobook.player`) via a labels parameter or by returning keys; update its tests in `source/core/tests/audio/`
- [X] T052 [US3] Extend `spike:i18n:main` (`source/app/platforms/electron/spikes/i18n-main.mjs`): tray template labels in vi then en after a change with no restart; reminder notification text in both; one dialog options object per IPC file in both languages; update `source/scripts/desktop-main-changes.json` for T046–T050

---

## Phase 6: User Story 4 — Dates, numbers and sizes look native (P3)

**Goal**: dates, numbers, sizes, durations and plurals follow the chosen language.
**Independent test**: quickstart step 6.

- [X] T053 [P] [US4] Replace the `toLocale*` / bare `Intl.*` calls with `useFormat()` / core formatters in `source/app/screens/Reader/components/sign/SignInfoPanel.tsx`, `sidebar/TocSidebar.tsx`, `chrome/WordCountPanel.tsx`, `chrome/ReaderSearchPanel.tsx`, `source/app/screens/Library/components/browse/LibraryBookTable.tsx`, `source/app/screens/AudioBook/components/AudioSidebar.tsx`
- [X] T054 [P] [US4] Replace ad-hoc byte / duration / percent helpers in `source/app` and `source/core/src` (find with `grep -rn "KB\|MB\|toFixed(" source/app source/core/src`) with `formatBytes` / `formatDuration` / `formatPercent` — Settings → Storage, import panels, attachment details, audio player time labels (clock style stays `h:mm:ss`)
- [X] T055 [US4] Audit counted texts in all areas: every "N items" message is a plural message with `count` (en `one`/`other`, vi `other`); fix any `count === 1 ? … : …` string building left in `source/app` (`grep -rn "=== 1 ?" source/app`)

---

## Phase 7: Polish & cross-cutting

- [ ] T056 Layout pass in Tiếng Việt at the minimum window width and the phone layout (`npm run dev:mobile`): fix clipped / overlapping labels locally (`truncate` + `title` with full text, or wrap) in toolbar overflow, tab bars, Settings sidebar, Library table headers, dialogs (FR-013, SC-006)
- [ ] T057 [P] Glossary review of every `source/core/src/i18n/catalogue/vi/*.ts` against [contracts/glossary.md](contracts/glossary.md) (terms, Xóa / Gỡ, Ghi chú / Bình luận, no "bạn", sentence case, no trailing period on buttons); add `source/core/tests/i18n/glossary-anchors.test.ts` checking anchor keys (`library.title` = "Thư viện", `common.delete` = "Xóa", `common.remove` = "Gỡ", `reader.sidebar.toc.title` = "Mục lục", `settings.appearance.language.system` = "Theo hệ thống") and that no Vietnamese message matches `/\bbạn\b/i`
- [ ] T058 [P] Startup cost check (SC-007): compare cold start (window shown) before / after on the built app, five runs each, record figures in `docs/implementation_plan/app_i18n.md`; if > 5 %, split the Vietnamese catalogue into a lazily imported chunk loaded before first render only when needed
- [ ] T059 Release gate: add `source/core/tests/i18n/i18n-release-gate.test.ts` asserting `PENDING_VI_AREAS` is empty and that no file under `source/app` starts with `/* i18n-pending:`; run `npm run i18n:inventory` one last time and resolve every remaining finding (translate or `i18n-ignore` with reason)
- [ ] T060 [P] Docs: finish `docs/implementation_plan/app_i18n.md`; add a short "App interface language (spec 012)" paragraph to `CLAUDE.md` (where the catalogue lives, `useT` / `getT` / `tMain`, the lint rule and pending header, the release gate, `app:setUiLanguage` + `ui-language.json`, rule for new IPC results = code + params); add `AppChannels.setUiLanguage` to the IPC section list
- [ ] T061 Final `npm run check` + `npm run check:desktop-baseline` + `npm run spike:i18n:main`; walk through [quickstart.md](quickstart.md) manual steps 1–9 (E2E stays manual and is not run by the agent)

---

## Dependencies & execution order

- **Phase 1** → **Phase 2** (T004 → T005/T006 → T009; T013 → T014/T015; T016 → T017 → T018; T022 → T023) → T024
  checkpoint.
- **US1 (Phase 3)** needs Phase 2. Its area tasks T025–T039 are independent of each other. T040 needs T017. T041–T042
  after the areas.
- **US2 (Phase 4)** needs Phase 2 only (independent of US1; visible effect is larger once US1 areas exist).
- **US3 (Phase 5)** needs Phase 2 (T017/T018). T049 after T046–T048. T050 independent of the rest of US3.
- **US4 (Phase 6)** needs T008; T053 touches files also converted in T026/T029/T030/T032/T037 — do it after those.
- **Polish** after all stories; T059 is last-but-one, T061 last.

## Parallel examples

- Phase 2: T007, T008 together; then T010, T011, T012 together; T014 alongside T016; T019, T020 together.
- US1: T025–T039 can be split across agents — each touches only its own source folders, its own
  `catalogue/en/<area>.ts` and `catalogue/vi/<area>.ts`, and the pending headers of its own files (the indexes were
  filled in T009, so no shared file is edited).
- US3: T047 and T051 alongside T046; US4: T053 alongside T054.

## Implementation strategy

1. **MVP** = Phase 1 + 2 + US1 (T001–T042): the main window is fully Vietnamese and switches live. Because of the
   release gate (clarification 1) the MVP is merged but NOT released until US3 (tray, dialogs, reminders, export) and
   T059 are done.
2. Then US2 (small) and US3 → releasable once T059 passes.
3. US4 + Polish complete the feature; every merged step keeps `npm run check` green with untranslated areas falling
   back to English behind their pending markers.

**Totals**: 61 tasks — Setup 3, Foundational 21, US1 18, US2 3, US3 7, US4 3, Polish 6.
