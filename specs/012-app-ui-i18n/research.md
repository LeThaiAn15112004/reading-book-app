# Research: App interface in Vietnamese and English (i18n)

All decisions below were taken from the codebase as it stands on `011-translate-all-text-formats` (2026-11-11).

## Current state (measured)

- `theme/appAppearance.ts`: `AppLanguage = 'system' | 'vi' | 'en'`, saved in `reading-book.app-appearance.v1`
  (localStorage), `resolveAppLanguage()` (System → `vi` when `navigator.language` starts with `vi`, else `en`),
  `applyAppearanceAttributes()` only sets `<html lang>`. Reset App Settings already resets it.
- `main.tsx` reads the appearance **synchronously before React mounts** — the language is known before the first frame.
- No i18n library in `package.json`; no translated text anywhere.
- Rough inventory of English UI literals (multi-word, heuristic grep): `screens/` ≈ 740, `components/` ≈ 120,
  `hooks/` ≈ 50, `platforms/electron/` ≈ 340 (incl. `ipc/` ≈ 55; some are logs), `core/src` ≈ 55. With single-word
  labels the total is estimated at **1 500 – 2 000 messages**. The exact list comes from the inventory step (R9).
- Main-owned visible text: tray menu (`background/background-mode.ts`: "Open Readmate", "Quit Readmate"), Reading
  Reminder notification (`reminders/reminder-schedule.ts`: "📚 Time to read", body), 11 `dialog.show*` calls in 7 IPC
  files (titles, `buttonLabel`, filter names), and the `errorMessage` strings IPC results return to the renderer
  (e.g. `import.ipc.ts`: "Could not open the file picker.", "Import cancelled.").
- Core user-visible text: `annotation-transfer/readable-markdown.ts` (`Chapter N`, page / section labels),
  `audio/audio-timeline.ts` labels.
- Date / number formatting: 8 `toLocale*` / `Intl.*` call sites with no locale argument (follow OS, not the setting).
- Mobile: the WebView runs the shared UI; the RN host shows one start-failure screen (`routes/index.tsx`) and
  imports no core (OD-1).

## R1 — Translation mechanism: own small module in core, no dependency

- **Decision**: a small i18n module in `source/core/src/i18n/` (pure TypeScript, ~200 lines): typed catalogues,
  `{name}` placeholders, plural forms through `Intl.PluralRules`, English fallback, and `Intl`-based formatters.
  A thin React layer in `source/app/i18n/` (zustand store + `useT()` hook), a thin Main layer in
  `platforms/electron/i18n/`.
- **Rationale**: the same catalogue must be used by the renderer (Desktop + Mobile WebView), Electron Main and core
  (`readable-markdown.ts`). Core may import nothing but relative paths and `zustand/vanilla` (R2), so any library
  would be unusable there. TypeScript catalogues give compile-time key checking (`t('library.empty.title')` with a
  wrong key is a type error) and `satisfies` gives excess/missing-key errors for Vietnamese. `Intl` is an ECMAScript
  global, allowed by R1 (`lib: ES2022`). The feature needs only two languages, interpolation and `one`/`other`
  plurals — no ICU select, no runtime loading.
- **Alternatives**: *i18next + react-i18next* — mature, but a new runtime dependency, unusable in core, keys untyped
  without extra codegen, JSON catalogues lose `satisfies` checks. *FormatJS / react-intl* — full ICU, React-only, heavy
  for two languages. *Lingui* — macro/compile step to add to Vite + Babel (Expo) + Main builds. Rejected: all add a
  dependency and none reach core or Main more simply.

## R2 — Catalogue shape and the completeness gate (FR-015, clarification 1)

- **Decision**: English catalogue = one `as const` TS object per **area** (`common`, `chrome`, `library`, `import`,
  `reader.*`, `audiobook.*`, `settings.*`, `main.*` …). Vietnamese area files are written
  `export const vi = { … } satisfies AreaShape<typeof en>` — so a Vietnamese area that exists must have exactly the
  English keys (missing or extra key = compile error). An area not yet translated is absent from the Vietnamese index
  and **must** be listed in `PENDING_VI_AREAS` (one array, with a comment per entry). A core test enforces:
  every English area is either in `vi` or in `PENDING_VI_AREAS` (not both); placeholders `{x}` are identical per key;
  plural messages give every form the language needs; no message is empty. A **release-gate test**
  (`tests/i18n/i18n-release-gate.test.ts`, like `audiobook-transcription-gate.test.ts`) asserts
  `PENDING_VI_AREAS.length === 0`; it is added by the last task of the feature (release = that test green). Until
  then the completeness test above runs on every `npm run check`.
- **Rationale**: hard failure (clarification 1) while still allowing area-by-area merges with an explicit, written
  pending list. TypeScript does the per-key work; the test does the cross-area work.
- **Alternatives**: JSON files + script diff (loses typing); `Partial<>` Vietnamese types (silently allows gaps —
  exactly what the gate forbids).

## R3 — Catching texts that never entered the catalogue

- **Decision**: a local ESLint rule `readmate/no-ui-literals` (in `source/scripts/eslint-rules/`, wired in
  `eslint.config.mjs`): reports JSX text containing a letter, and string literals in JSX attributes `title`,
  `aria-label`, `placeholder`, `alt`, `label`, `description`, `message`, `confirmLabel`, `cancelLabel`. Enabled per
  folder as each area is converted (list in the config = complement of `PENDING_VI_AREAS`); at release it covers all
  of `source/app/screens`, `components`, `hooks`. Escape hatch: `// i18n-ignore: <reason>` for real non-texts
  (keyboard key names, format names, `·` separators). Main strings are covered by the inventory (R9) and review, not
  by the rule (they are plain `.ts` values).
- **Rationale**: the catalogue test only proves the catalogue is complete; it cannot see a string never moved into it.
  `--max-warnings 0` lint is already in `npm run check`.
- **Alternatives**: `eslint-plugin-i18next` (new dependency, noisier defaults); `react/jsx-no-literals`
  (`eslint-plugin-react` not installed, no attribute list control).

## R4 — Effective language and System Default (FR-004, FR-005)

- **Decision**: one core function `resolveUiLanguage(preference, deviceLocales: readonly string[]): 'vi' | 'en'`
  (first device locale starting with `vi` → `vi`; `en`-something or anything else → `en`). Renderer passes
  `navigator.languages`; Main passes `app.getPreferredSystemLanguages()`. Re-evaluated at start only.
  `resolveAppLanguage` in `appAppearance.ts` delegates to it. Because `main.tsx` already reads the preference before
  React mounts, the i18n store is initialised there too → the first frame is already in the right language.
- **Rationale**: one rule for both processes; no flash; no behaviour change for existing users.

## R5 — Main process language (FR-006)

- **Decision**: the preference stays in renderer localStorage (spec assumption). Main keeps a **mirror**:
  `{userData}/ui-language.json` (`json-prefs-file.ts`, like `background-prefs.json`) holding the *preference*
  (`system|vi|en`). New channel `app:setUiLanguage(preference)` (AppChannels) — the renderer sends it at boot and on
  every change; Main saves the mirror, resolves the effective language, and notifies listeners (tray menu rebuild).
  At Main start, before any window, it reads the mirror (missing → `system`) so the tray and an early reminder are
  right on the very first launch after a change. Reset App Settings goes through the same store setter → same IPC.
- **Rationale**: the tray exists before / without the renderer (Run in Background); the reminder worker runs in Main.
  Matches the existing Main-owned prefs pattern. Mobile: `app.setUiLanguage` → `unavailable.ts` (no tray, no Main);
  the bridge wrapper ignores `NOT_AVAILABLE_ON_PLATFORM`.
- **Alternatives**: Main reads renderer localStorage (no API; fragile); move the preference to Main entirely (a
  storage migration + IPC round-trip on boot → risks the first-frame language).

## R6 — Messages produced in Main and returned to the renderer (FR-011)

- **Decision**: Main **translates its own messages** with `tMain()` using its current effective language; the
  machine-readable reasons (`code`, `reason`, `state` fields already on IPC results) are unchanged. Main message texts
  live in the shared catalogue under `main.*` areas.
- **Rationale**: dozens of IPC results already carry an `errorMessage` string that the renderer shows verbatim;
  changing every DTO to `{key, params}` would touch all four IPC places per feature for no user gain. The mirror keeps
  Main's language in step with the renderer (set before any user action can produce a message).
- **Alternatives**: Main returns keys + params, renderer translates — cleaner in theory, a very large DTO change;
  kept as the rule only for **new** IPC results (documented in the contract).

## R7 — React integration and live switching (FR-003)

- **Decision**: `source/app/i18n/uiLanguageStore.ts` (zustand, per project preference for custom hooks) holds the
  effective language, subscribed to `useAppAppearanceStore.language`. `useT()` returns a `t` bound to it; a language
  change re-renders every component using `useT()` — no remount, no route change, so the open book, scroll position,
  player and jobs are untouched. Non-React code (stores, helpers) uses `getT()` at the moment it builds a message.
  State that outlives a render and is shown later (toasts, panel errors) should hold `{ key, params }`
  (`MessageRef`) and be translated when rendered; transient dialog texts may keep the language they were opened in
  (spec edge case).
- **Rationale**: zustand selectors give precise re-rendering; no React context provider tree change at the root.

## R8 — Formatting (FR-010, US4)

- **Decision**: core `i18n/format.ts`: `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`,
  `formatBytes` (B/KB/MB/GB, 1 decimal, locale separator), `formatDuration` (h:mm:ss stays numeric; long form "2 giờ
  5 phút" / "2 h 5 min" via catalogue), all taking the effective language (`vi` → `vi-VN`, `en` → `en-US`). The 8
  existing `toLocale*` call sites and the ad-hoc byte/duration helpers move to them.
- **Rationale**: one place, testable in vitest (Node ships full ICU).

## R9 — Inventory and conversion order

- **Decision**: a throw-away inventory script (`source/scripts/i18n-inventory.mjs`, prints candidate literals per
  file) drives the work; conversion goes area by area, each area = English catalogue + call-site changes +
  Vietnamese catalogue + enabling the lint rule for its folders + removing it from `PENDING_VI_AREAS`. Order:
  `common` + `chrome` → `library` + `import` → `settings` → `reader` (shared chrome, then per format) → `audiobook`
  → `main.*` (tray, reminders, dialogs, IPC messages) → core (`readable-markdown`, `audio-timeline`).
- **Rationale**: high-traffic screens first; every merged step keeps `npm run check` green.

## R10 — Glossary and tone (FR-016, clarification 2)

- **Decision**: `contracts/glossary.md` is the authoritative term list (copied to
  `docs/implementation_plan/app_i18n.md` at the end). Vietnamese is reviewed against it; a small core test checks a
  handful of anchor keys use the glossary term (e.g. `library.title` = "Thư viện").

## R11 — Readable Markdown export (FR-012, clarification 3)

- **Decision**: `buildReadableMarkdown` (core) gets a `labels` parameter (a typed object produced by `t` for the
  current language) instead of hard-coded English; the Main export service passes Main's current language labels.
  The restorable JSON is untouched. Existing tests call it with English labels and keep passing.

## R12 — Layout with longer Vietnamese labels (FR-013, SC-006)

- **Decision**: no global CSS change up front. Every converted area is checked at the minimum window width and in
  the phone layout (quickstart); fixes are local (`truncate` + `title` with the full text, or wrapping). Fixed-width
  controls found by the inventory (tab bars, toolbar overflow labels, sidebar headers) are listed in the tasks.

## R13 — Mobile

- **Decision**: the WebView side gets everything through the shared UI (same store, same catalogue, `navigator.languages`
  of the phone). The RN host start-failure screen stays English (it shows a raw error to report; no core in the host,
  OD-1) — noted as an exception in the contract.

## R14 — Performance (SC-003, SC-007)

- **Decision**: both catalogues are bundled (estimated 150–250 KB raw, far less gzipped); lookups are object property
  reads; `Intl.*Format` / `PluralRules` instances cached per language. Language switch = one store update + re-render
  of subscribed components (target < 1 s, measured in the quickstart). No lazy loading.
