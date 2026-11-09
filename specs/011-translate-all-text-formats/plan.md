# Implementation Plan: Translate in every text format

**Branch**: `011-translate-all-text-formats` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-translate-all-text-formats/spec.md`

## Summary

Translate mode (toolbar tool) only reaches `EpubRenderer` today; PDF lacks the capability, and TXT / Markdown show the
tool but their renderers never hear about the mode. We give `PdfRenderer`, `MdRenderer` and `TxtRenderer` the same
"mode on" + "selection finished" pair EPUB has, hooked into the single place each renderer already decides what a
finished selection means (the markup-tool commit), and add `translate` to the PDF capability list. TXT goes read-only
while the mode is on (existing `readOnly` switch, plus an undo / redo guard). PDF selections carry the document's
`/Lang`. The hand-picked source language is remembered per book in `books.reading_state_json.translationSourceLang`
through two new `translation:*` channels, with `overwriteSessionState` taught to keep it; the starting-language
precedence is a pure, unit-tested core function. Details: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (strict), React 18, Node in Electron Main

**Primary Dependencies**: zustand (renderer stores), pdf.js 5.4.624 (PDF `/Lang`), better-sqlite3 (Main); existing
on-device translation worker — unchanged

**Storage**: `books.reading_state_json` (JSON column, SQLite) — new key, no migration

**Testing**: vitest in `source/core/tests` (`npm run sdk:test`); new spike `spike:translation:source` (Main, migrated
schema, Electron ABI); manual [quickstart.md](quickstart.md). E2E manual-only.

**Target Platform**: Desktop (Electron, Windows first). Mobile unchanged (`translate` stays in `MOBILE_EXCLUDED`).

**Project Type**: desktop-app (single repo: `source/core` + `source/app`)

**Performance Goals**: panel opens on selection release with no perceptible delay (same path as EPUB today); one
extra IPC read per book open, one write per hand-picked source change

**Constraints**: book file and TXT text never change from Translate mode; translation stays on-device; no new
dependency; EPUB behaviour unchanged

**Scale/Scope**: 4 renderers, 1 store, 1 core helper, 2 IPC channels, 1 changed SQL statement

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so the gates are the project rules in `CLAUDE.md`:

| Gate | Status |
|---|---|
| R1–R3: core stays pure (new helper uses only core catalog functions) | PASS |
| R7/R9/R12: no cross-host imports; only `api.electron.ts` touches `window.api`; renderer uses `bridge/translation.ts` | PASS |
| IPC kept in sync in the four places (channels, handler, preload + `DesktopApi`, bridge) | PASS (planned) |
| Mobile `create-api.ts` still satisfies `Window['api']` (methods added to `unavailable.ts`) | PASS (planned) |
| Book file never mutated; TXT edits only through `txt:commit` (Translate mode writes nothing) | PASS |
| Per-book state in `reading_state_json`; app preferences stay in `localStorage` | PASS |
| No migration needed (JSON key) | PASS |
| Every Main change listed in `desktop-main-changes.json` (`check:desktop-baseline`) | PASS (planned) |
| Agent does not run E2E | PASS |

Re-check after Phase 1: unchanged — the design adds no new layer, package or dependency. No Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/011-translate-all-text-formats/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── renderer-translate-mode.md
│   └── translation-source-ipc.md
└── tasks.md             # /speckit-tasks
```

### Source Code (files touched)

```text
source/core/
├── src/services/translation/translation-languages.ts   # + resolveTranslationSource (next to normalizeTranslationLanguage)
├── src/db/overlay/statements.ts       # + selectTranslationSource, patchTranslationSource; overwriteSessionState keeps the key
└── tests/services/translation/resolve-translation-source.test.ts   # new

source/app/
├── components/reader/capabilities.ts              # pdf += 'translate'; fix stale txt/md comments
├── components/reader/renderers/
│   ├── pdf/PdfRenderer.tsx, pdf/pdfSelection.ts   # translateModeActive + onTranslateSelection; lang = document /Lang
│   ├── md/MdRenderer.tsx                          # translateModeActive + onTranslateSelection
│   └── txt/TxtRenderer.tsx                        # translateModeActive + onTranslateSelection; readOnly + undo/redo guard
├── screens/Reader/ReaderScreen.tsx                # pass the props to PDF / MD / TXT
├── screens/Reader/logic/translation/translationStore.ts   # load / persist remembered source per book
├── screens/Reader/logic/hooks/useReaderTranslation.ts     # pass bookId to the per-book load
├── bridge/translation.ts                          # getSourceLanguage / setSourceLanguage
└── platforms/
    ├── electron/ipc/{channels,api-types,translation.ipc}.ts, electron/preload.ts
    ├── electron/persistence/sqlite-overlay-store.ts   # get / set translation source (book exists, not audio)
    ├── electron/spikes/translation/ (new spike)       # (+ package.json script)
    └── native/bridge/unavailable.ts                   # the two methods → NOT_AVAILABLE_ON_PLATFORM

source/scripts/desktop-main-changes.json           # approve the Main files above
docs/implementation_plan/translation_all_formats.md   # short map (+ CLAUDE.md pointer)
```

**Structure Decision**: Existing single-project layout (spec 009). Logic that can be pure goes to `source/core`; the
renderer changes stay inside the four renderers + `ReaderScreen`; persistence follows the existing
`reading_state_json` merge-patch pattern (`updateAudioProgress`, `patchSessionPreferences`).

## Delivery order (maps to spec priorities)

1. **P1 — TXT + Markdown Translate mode** (renderer props, TXT read-only + undo guard, `ReaderScreen` wiring). Ships alone.
2. **P2 — PDF Translate mode** (capability + renderer props).
3. **P3 — source language**: PDF `/Lang`; core `resolveTranslationSource`; statements + overwrite carry-over; IPC
   pair; store load / persist; spike.

## Risks

- **Autosave erasing the key** — handled by changing `overwriteSessionState`; the spike asserts it. The same statement
  is used by Mobile's store: the change is additive (absent stays absent); core contract tests must still pass.
- **TXT undo while read-only** — existing gap for markup tools too; fixed by the guard (R5). Verify markup tools'
  behaviour is otherwise unchanged.
- **PDF selection across pages** — reuses `readPdfSelection`, already used by context-menu Translate.
