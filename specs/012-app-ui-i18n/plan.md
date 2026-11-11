# Implementation Plan: App interface in Vietnamese and English (i18n)

**Branch**: `012-app-ui-i18n` (work currently on `011-translate-all-text-formats`) | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-app-ui-i18n/spec.md`

## Summary

The App Language setting (`system | vi | en`) exists but only sets `<html lang>`; every text is English. We add a
small dependency-free i18n module to **core** (typed TypeScript catalogues per area, `{name}` placeholders,
`Intl.PluralRules` plurals, English fallback, `Intl` formatters, `resolveUiLanguage`), a zustand store + `useT()`
hook in the shared UI (initialised in `main.tsx` before React mounts → no flash), and a Main-side translator fed by a
new `app:setUiLanguage` channel plus a `{userData}/ui-language.json` mirror (tray, reminders, native dialogs, Main
`errorMessage` strings, readable Markdown export). The ≈1 500 – 2 000 existing English texts are moved area by area;
each area ships with its Vietnamese catalogue (one fixed glossary, neutral tone). Completeness is enforced by
`satisfies` types, a catalogue test (every area translated or explicitly pending), a new ESLint rule against
hard-coded texts, and a release-gate test (`PENDING_VI_AREAS` empty). Details: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (strict), React 18, Node in Electron Main, React Native host (unchanged)

**Primary Dependencies**: zustand (renderer store), ECMAScript `Intl` (PluralRules, DateTimeFormat, NumberFormat) —
**no new package**

**Storage**: existing `reading-book.app-appearance.v1` (localStorage, unchanged) + new Main mirror
`{userData}/ui-language.json`; no SQLite change, no migration

**Testing**: vitest in `source/core/tests/i18n/*` (`npm run sdk:test`), ESLint rule tests (`RuleTester` in
`source/scripts`), new spike `spike:i18n:main`; manual [quickstart.md](quickstart.md). E2E manual-only.

**Target Platform**: Desktop (Electron, Windows first) + Mobile WebView (shared UI); RN host start-failure screen
stays English (OD-1)

**Project Type**: desktop-app (single repo: `source/core` + `source/app`)

**Performance Goals**: language switch < 1 s visible (SC-003); start time + ≤ 5 % (SC-007); catalogues bundled
(≈150–250 KB raw)

**Constraints**: core purity (R1–R3); IPC four-place sync; Main changes approved in `desktop-main-changes.json`;
user data never translated (FR-009); restorable annotation JSON unchanged

**Scale/Scope**: ≈160 `.tsx` + stores/hooks in `source/app`, 7 Main IPC files with dialogs, tray, reminders,
2 core modules; ≈20 catalogue areas × 2 languages; 1 new IPC channel

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so the gates are the project rules in `CLAUDE.md`:

| Gate | Status |
|---|---|
| R1–R3: core i18n uses only ES2022 globals (`Intl`) and relative imports | PASS |
| R5/R7/R12: app → core only; no cross-host import; Main i18n under `platforms/electron/i18n/` | PASS |
| R9: renderer calls `bridge/app.ts`, never `window.api` | PASS (planned) |
| IPC four places in sync (`channels.ts`, `app.ipc.ts`, `preload.ts` + `DesktopApi`, `bridge/app.ts`) | PASS (planned) |
| Mobile `create-api.ts` still satisfies `Window['api']` (`unavailable.ts` entry) | PASS (planned) |
| App prefs stay renderer-owned; Main mirror follows the existing Main-owned JSON prefs pattern | PASS |
| Reset App Settings covers the language (existing resetter; also re-sends IPC) | PASS |
| No migration; book file never touched | PASS |
| Every Main change listed in `desktop-main-changes.json` | PASS (planned) |
| `npm run check` green after every area; agent does not run E2E | PASS (planned) |

Re-check after Phase 1: unchanged — no new package, layer or process. No Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/012-app-ui-i18n/
├── plan.md              # this file
├── research.md          # R1–R14 decisions
├── data-model.md        # preference, effective language, mirror, catalogue, MessageRef
├── quickstart.md        # automated + manual validation
├── contracts/
│   ├── i18n-core-api.md     # core API
│   ├── renderer-i18n.md     # store, useT, TransText, lint rule
│   ├── ui-language-ipc.md   # app:setUiLanguage + Main i18n consumers
│   └── glossary.md          # English → Vietnamese terms, tone
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
source/core/src/i18n/
├── index.ts              # public exports (re-exported from src/index.ts)
├── language.ts           # UiLanguage, resolveUiLanguage, localeTag
├── translate.ts          # translate, createTranslator, placeholders, plurals, fallback
├── format.ts             # date/number/percent/bytes/duration (cached Intl)
├── types.ts              # Message, PluralMessage, MessageKey (leaf paths), AreaShape
├── pending.ts            # PENDING_VI_AREAS
└── catalogue/
    ├── en/<area>.ts  + en/index.ts
    └── vi/<area>.ts  + vi/index.ts
source/core/src/annotation-transfer/readable-markdown.ts   # labels parameter
source/core/src/audio/audio-timeline.ts                    # labels via catalogue
source/core/tests/i18n/   # language, translate, format, catalogue-completeness, glossary-anchors, release-gate

source/app/i18n/          # uiLanguageStore.ts, useT.ts, TransText.tsx
source/app/main.tsx       # initUiLanguage before render
source/app/theme/appAppearance*.ts   # resolveAppLanguage → core; commit → setUiLanguagePreference
source/app/bridge/app.ts  # setUiLanguage
source/app/{screens,components,hooks}/**   # texts → t()

source/app/platforms/electron/
├── i18n/main-i18n.ts     # loadMainUiLanguage, tMain, onMainUiLanguageChange, mirror file
├── ipc/{channels,app.ipc,api-types}.ts, preload.ts   # app:setUiLanguage
├── background/background-mode.ts   # tray
├── reminders/reminder-schedule.ts  # reminder text
├── ipc/{import,library,overlay,attachments,annotation-transfer,transcription,zip-import}.ipc.ts  # dialogs, messages
└── spikes/i18n-main.mjs  # spike:i18n:main
source/app/platforms/native/bridge/unavailable.ts   # app.setUiLanguage

source/scripts/eslint-rules/no-ui-literals.mjs (+ test) ; eslint.config.mjs
source/scripts/i18n-inventory.mjs   # dev aid, lists remaining literals
source/scripts/desktop-main-changes.json
docs/implementation_plan/app_i18n.md ; CLAUDE.md (short section)
```

**Structure Decision**: single project (spec 009). Translation logic and catalogues in core so renderer, Main and
core share one source; React and Electron glue stay in their layers.

## Delivery order (each step keeps `npm run check` green)

1. Foundation: core i18n + tests, renderer store / `useT` / `TransText`, boot init, `app:setUiLanguage` + Main i18n
   + mirror + spike, ESLint rule (enabled for no folder yet), inventory script. All areas start in
   `PENDING_VI_AREAS`.
2. Areas, each = English catalogue + call sites + Vietnamese catalogue + lint enabled + removed from pending:
   `common`/`chrome` → `library`/`import` → `settings` → `reader` (shared chrome, sidebars, annotations, translation,
   search, then epub / pdf / txt / md specifics) → `audiobook` (player, notes, transcription, zip import) → `main`
   (tray, reminders, dialogs, IPC messages) → core (`readable-markdown`, `audio-timeline`) + formatters at all
   `toLocale*` sites.
3. Layout pass at minimum width + phone (Vietnamese), glossary review.
4. Release gate test added (pending list empty), docs + CLAUDE.md.

## Complexity Tracking

None.
