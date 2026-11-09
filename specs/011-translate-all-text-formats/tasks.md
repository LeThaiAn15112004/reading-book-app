# Tasks: Translate in every text format

**Input**: Design documents from `specs/011-translate-all-text-formats/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: The spec does not ask for TDD. The tasks include only the checks the project already uses for this kind
of change: one vitest file for the new pure core function, one Main spike for the new SQL, and the manual
[quickstart.md](quickstart.md) rows. Desktop E2E is manual-only and is NOT run by the agent.

**Organization**: by user story (spec priorities P1 → P3); each story can ship on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 / US2 / US3 from spec.md
- Paths are from the repository root; `@app` = `source/app`, `@core` = `source/core/src`

---

## Phase 1: Setup

**Purpose**: confirm a green starting point so later failures belong to this feature.

- [X] T001 Run `npm run typecheck`, `npm run lint`, `npm run sdk:test` and `npm run check:desktop-baseline` from the repository root and note any pre-existing failure in `specs/011-translate-all-text-formats/tasks.md` under Notes (do not fix unrelated failures)

---

## Phase 2: Foundational

None. The three stories touch different renderers and layers; the only shared file, `source/app/screens/Reader/ReaderScreen.tsx`, is edited in one task per story (T005, T010, T026), done sequentially.

---

## Phase 3: User Story 1 — Translate mode works in TXT and Markdown (Priority: P1) 🎯 MVP

**Goal**: with the toolbar Translate tool on, a finished selection in a TXT or Markdown book opens the translation panel; the TXT text is read-only while the mode is on.

**Independent test**: [quickstart.md](quickstart.md) rows 1–5 and 13 on a TXT and a Markdown book.

### Implementation for User Story 1

- [X] T002 [P] [US1] In `source/app/components/reader/renderers/txt/TxtRenderer.tsx` add props `translateModeActive?: boolean` and `onTranslateSelection?: (selection: TxtSelectionInfo) => void` (keep them in `propsRef` like the other callbacks). In `finishPress`, after `const selection = readSelection()`: if `selection` and `propsRef.current.translateModeActive`, call `onTranslateSelection(selection)`, and return WITHOUT collapsing the selection (analysis I2: the reader must see what is translated). Change the read-only layout effect to `input.readOnly = !editable || markupTool !== null || translateModeActive === true` with `translateModeActive` in its dependency list (contract: [renderer-translate-mode.md](contracts/renderer-translate-mode.md), TXT only)
- [X] T003 [US1] In `source/app/components/reader/renderers/txt/TxtRenderer.tsx` make undo / redo no-ops while Translate mode is on: in the `beforeinput` handler (`historyUndo` / `historyRedo`) and in the keydown Ctrl/Cmd+Z / Shift+Z / Y handler, skip `onUndo` / `onRedo` (after `preventDefault`) when `translateModeActive` is true. NOT for armed markup tools: the TXT history also holds highlight steps, and Ctrl+Z must still undo a mark (research R5, corrected during implementation)
- [X] T004 [P] [US1] In `source/app/components/reader/renderers/md/MdRenderer.tsx` add props `translateModeActive?: boolean` and `onTranslateSelection?: (selection: MdSelectionInfo) => void`; mirror `translateModeActive` in a ref like `markupToolRef` and add the callback to `handlersRef`. In `onPointerUp`, after the `tool === 'insert'` branch and after `const selection = readMdSelection(article)`: if `selection` and the translate ref is true, call `h.onTranslateSelection?.(selection)` and return (before the `tool && selection` markup branch). Do not clear the native selection
- [X] T005 [US1] In `source/app/screens/Reader/ReaderScreen.tsx` pass to `<TxtRenderer>`: `translateModeActive={translation.mode}` and `onTranslateSelection={(selection) => { txt.closeSelectionMenu(); translation.openForSelection({ text: selection.text, lang: '' }) }}`; pass to `<MdRenderer>`: `translateModeActive={translation.mode}` and `onTranslateSelection={(selection) => { setMdSelectionMenu(null); translation.openForSelection({ text: selection.text, lang: '' }) }}` (depends on T002, T004)
- [X] T006 [P] [US1] In `source/app/components/reader/capabilities.ts` fix the stale comments above `txt` and `md` that say translate is out of scope / "not yet" (both surfaces already list `'translate'`; say Translate mode and the selection menu both work, and that TXT is read-only while Translate mode is on)
- [ ] T007 [US1] Run `npm run typecheck` and `npm run lint`, then walk [quickstart.md](quickstart.md) rows 1–5 and 13 for TXT and Markdown in `npm run dev`; record results under Notes in this file

**Checkpoint**: US1 is shippable on its own.

---

## Phase 4: User Story 2 — Translate mode on PDF (Priority: P2)

**Goal**: the PDF toolbar offers Translate; with it on, a selection on the text layer opens the panel.

**Independent test**: [quickstart.md](quickstart.md) rows 6–8 and 13 on a PDF with a text layer and a scanned page.

### Implementation for User Story 2

- [X] T008 [P] [US2] In `source/app/components/reader/capabilities.ts` add `'translate'` to the `pdf` entry of `SURFACE_CAPABILITIES` (keep `MOBILE_EXCLUDED` unchanged so Mobile still hides it)
- [X] T009 [P] [US2] In `source/app/components/reader/renderers/pdf/PdfRenderer.tsx` add props `translateModeActive?: boolean` and `onTranslateSelection?: (selection: PdfSelectionInfo) => void`, each mirrored in a ref (`translateModeRef`, `onTranslateSelectionRef`) like `onMarkupSelectionRef`. In the pointer-up handler, after the `tool === 'insert'` branch, add: if `translateModeRef.current && !gesture.pan && rootRef.current && selectionChangedSince(gesture.selectionAtDown)`, read `readPdfSelection(rootRef.current)`; if non-null call `onTranslateSelectionRef.current?.(selection)` and return. A page with no text layer yields no selection → nothing happens (FR-010)
- [X] T010 [US2] In `source/app/screens/Reader/ReaderScreen.tsx` pass to `<PdfRenderer>`: `translateModeActive={translation.mode}` and `onTranslateSelection={(selection) => { pdfSelectionMenu.close(); translation.openForSelection(selection) }}`; confirm the toolbar `case 'translate'` path (sets tool `select`, `setMode(true)`) and `selectTool` (turns the mode off when any PDF tool — pen, eraser, shape, typewriter, fileAttachment, markup — is picked) need no PDF-specific change (depends on T008, T009)
- [X] T011 [US2] Run `npm run spike:reader:toolbar`; if it asserts the PDF tool list or fold order, update its expectations in `source/app/platforms/electron/spikes/` to include Translate for PDF (same group/position as EPUB) and re-run until green
- [ ] T012 [US2] Run `npm run typecheck` and `npm run lint`, then walk [quickstart.md](quickstart.md) rows 6–8 and 13 for PDF in `npm run dev`; record results under Notes

**Checkpoint**: US1 + US2 work independently.

---

## Phase 5: User Story 3 — Sensible, remembered source language (Priority: P3)

**Goal**: the starting source language is, in order, the user's remembered choice for that book → the book's own language (EPUB selection language, PDF `/Lang`) → the default `en`; a hand-picked source is remembered per book across restarts.

**Independent test**: [quickstart.md](quickstart.md) rows 9–11, plus `npm run sdk:test` and `npm run spike:translation:source`.

### Core

- [ ] T013 [P] [US3] In `source/core/src/services/translation/translation-languages.ts` add and export `resolveTranslationSource(input: { remembered: string | null | undefined; selectionLang: string | null | undefined; fallback: string }): string` returning the first of: `remembered` if `findTranslationLanguage(remembered)` is truthy; else `normalizeTranslationLanguage(selectionLang)` if it is a catalog code; else `fallback` (data-model "Starting source language"). Make sure it is re-exported through `source/core/src/services/translation/index.ts` so `@core` exposes it
- [ ] T014 [P] [US3] Add `source/core/tests/services/translation/resolve-translation-source.test.ts` (vitest, imports from `../../../src/...`): remembered wins over selection language; invalid / unknown remembered code is ignored; selection language is normalized (e.g. `fr-FR` → `fr`); empty selection language → fallback; nothing valid → fallback. Run `npm run sdk:test`
- [ ] T015 [P] [US3] In `source/core/src/db/overlay/statements.ts` add `selectTranslationSource(bookId)` = `SELECT file_format, json_extract(reading_state_json, '$.translationSourceLang') AS code FROM books WHERE id = ?` and `patchTranslationSource(bookId, patchJson)` = `UPDATE books SET reading_state_json = json_patch(reading_state_json, ?) WHERE id = ?` — it must NOT bump `books.updated_at` (contract). Change `overwriteSessionState` to `SET reading_state_json = json_patch(?, json_object('translationSourceLang', json_extract(reading_state_json, '$.translationSourceLang')))` keeping its parameters and its `updatedAt` guard unchanged ("absent stays absent": a NULL value makes `json_patch` drop the key)
- [ ] T016 [US3] Run `npm run sdk:test` (incl. `source/core/tests/contracts/`) and `npm run mobile:test`, since `overwriteSessionState` is shared with Mobile's store; fix any fixture that compares the statement text (depends on T015)

### Main (Desktop)

- [ ] T017 [US3] In `source/app/platforms/electron/persistence/sqlite-overlay-store.ts` add `getTranslationSource(bookId): { ok: true; code: string | null } | { ok: false; code: 'invalid_request' | 'not_found' }` and `setTranslationSource(bookId, code: string | null): same ok shape`. Rules (data-model): `bookId` trimmed non-empty, else `invalid_request`; no row → `not_found`; audio format (`isAudioFormat(file_format)`) → `invalid_request`; on read, a stored value that is not a catalog code → `code: null`; on write, `code` must be `null` or a code accepted by `findTranslationLanguage`, else `invalid_request` and nothing written; write `JSON.stringify({ translationSourceLang: code })` through `patchTranslationSource` (`null` removes the key) (depends on T015)
- [ ] T018 [US3] In `source/app/platforms/electron/ipc/channels.ts` add `getSourceLanguage: 'translation:getSourceLanguage'` and `setSourceLanguage: 'translation:setSourceLanguage'` to `TranslationChannels`; in `source/app/platforms/electron/ipc/api-types.ts` add `TranslationSourceResultDto = { ok: true; code: string | null } | { ok: false; code: 'invalid_request' | 'not_found' }`, `TranslationSourceSaveResultDto = { ok: true } | { ok: false; code: 'invalid_request' | 'not_found' }`, and `getSourceLanguage(bookId: string): Promise<TranslationSourceResultDto>` / `setSourceLanguage(input: { bookId: string; code: string | null }): Promise<TranslationSourceSaveResultDto>` on `DesktopApi['translation']` (contract [translation-source-ipc.md](contracts/translation-source-ipc.md))
- [ ] T019 [US3] In `source/app/platforms/electron/ipc/translation.ipc.ts` register the two handlers (remove-then-handle like the existing ones): validate that `bookId` is a string and `code` is a string or `null` (anything else → `{ ok: false, code: 'invalid_request' }`), then call the store methods from T017; obtain the overlay store the same way `source/app/platforms/electron/ipc/overlay.ipc.ts` does (change `registerTranslationIpc` / its call in `source/app/platforms/electron/ipc/index.ts` only if a dependency must be passed) (depends on T017, T018)
- [ ] T020 [US3] In `source/app/platforms/electron/preload.ts` expose `translation.getSourceLanguage` / `translation.setSourceLanguage` via `ipcRenderer.invoke` on the new channel constants (depends on T018)
- [ ] T021 [US3] Add every Main-process file changed by T017–T020 (`sqlite-overlay-store.ts`, `channels.ts`, `api-types.ts`, `translation.ipc.ts`, `preload.ts`, `ipc/index.ts` if touched) to `source/scripts/desktop-main-changes.json` with reason "spec 011: remembered translation source language", then run `npm run check:desktop-baseline`
- [ ] T022 [US3] Create the spike `source/app/platforms/electron/spikes/translation/run-translation-source.mjs` (re-launch with the app's Electron binary in `ELECTRON_RUN_AS_NODE` mode, as `source/app/platforms/electron/spikes/audio/run-audio-migration.mjs` does) and add `"spike:translation:source"` to the root `package.json`. On a temp DB migrated with the real migrations, with the real `SqliteOverlayStore`, assert: get on a fresh book → `null`; set `vi` → get `vi`; other `reading_state_json` keys unchanged and `books.updated_at` unchanged; `saveSessionState` (full overwrite) keeps `vi`; set `null` removes the key; set `xx-invalid` → `invalid_request`, value unchanged; unknown book → `not_found`; audiobook → `invalid_request`; deleting the book row removes the value. Run it (depends on T017)

### Renderer

- [ ] T023 [P] [US3] In `source/app/bridge/translation.ts` add `getSourceLanguage(bookId)` and `setSourceLanguage(bookId, code)` thin wrappers over `api.translation` and export the DTO types; verify the Mobile bridge needs no change (`source/app/platforms/native/bridge/index.ts` builds the whole `translation` group with `unavailableGroup<DesktopApi['translation']>`) by running `npm run mobile:typecheck:web` (depends on T018)
- [ ] T024 [US3] In `source/app/screens/Reader/logic/translation/translationStore.ts`: (a) add `bookId: string | null`; change `resetForNewBook` to `resetForNewBook(bookId: string | undefined)` that closes the popover, sets `sourceLocked: false`, `sourceLang: FALLBACK_SOURCE`, then (when `bookId`) calls `translationApi.getSourceLanguage(bookId)` and, only if the store's `bookId` is still the same when it resolves and the result is `{ ok: true, code: string }`, sets `sourceLang: code, sourceLocked: true`; a failed read logs one `console.warn` and keeps today's behaviour; (b) in `open()`, compute the source with `resolveTranslationSource({ remembered: get().sourceLocked ? get().sourceLang : null, selectionLang: info.lang, fallback: FALLBACK_SOURCE })` from `@core`; (c) in `setSourceLang` and `swapLanguages`, after updating state, call `translationApi.setSourceLanguage(bookId, newSource)` fire-and-forget with a `console.warn` on failure (no toast) (depends on T013, T023)
- [ ] T025 [US3] In `source/app/screens/Reader/logic/hooks/useReaderTranslation.ts` call `resetForNewBook(bookId)` in the book effect and `resetForNewBook(undefined)` in its cleanup (depends on T024)
- [ ] T026 [US3] PDF language hint: in `source/app/components/reader/renderers/pdf/pdfSelection.ts` let `readPdfSelection` take the document language (`lang` parameter, default `''`) instead of the hard-coded `lang: ''`, and update its doc comment; in `source/app/components/reader/renderers/pdf/PdfRenderer.tsx` read `(await pdfDocument.getMetadata()).info?.Language` once per opened document into a ref (string, trimmed, `''` when absent or on error) and pass it to every `readPdfSelection` call, so both the selection menu and Translate mode carry it (research R2)
- [ ] T027 [US3] Run `npm run typecheck`, `npm run lint`, `npm run sdk:test`, `npm run spike:translation:source`, then walk [quickstart.md](quickstart.md) rows 9–11 in `npm run dev`; record results under Notes

**Checkpoint**: all three stories work.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T028 [P] Write `docs/implementation_plan/translation_all_formats.md` (short map: the renderer contract, TXT read-only + undo guard, PDF `/Lang`, `translationSourceLang` in `reading_state_json` and why `overwriteSessionState` carries it, the two channels, the spike) and add a pointer to it plus `spike:translation:source` to the spike list in `CLAUDE.md`
- [ ] T029 Regression: walk [quickstart.md](quickstart.md) rows 12 (EPUB unchanged) and 14 (over 20,000 characters refused in every format); record results under Notes
- [ ] T030 Run the whole gate `npm run check` from the repository root and fix anything this feature broke

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (T001) → then US1, US2, US3 in any order or in parallel; Polish after the stories you ship.

### User story dependencies

- **US1 (P1)**: none.
- **US2 (P2)**: none on US1 (different renderer). Shares `ReaderScreen.tsx` and `capabilities.ts` with US1: do T005 / T006 and T008 / T010 one after the other, not at the same time.
- **US3 (P3)**: none on US1 / US2 for its core, Main and store parts. T026 edits `PdfRenderer.tsx` and `pdfSelection.ts`: do it after T009 if US2 is also in flight.

### Within each story

- US1: T002 ∥ T004 ∥ T006 → T003 (after T002, same file) → T005 → T007
- US2: T008 ∥ T009 → T010 → T011 → T012
- US3: T013 ∥ T014 ∥ T015 → T016; T015 → T017 → T018 → T019 / T020 → T021; T017 → T022; T018 → T023 → T024 → T025; T026 independent; all → T027

### Parallel opportunities

- T002, T004, T006, T008, T009, T013, T014, T015 touch different files and can start together.
- T023 (renderer bridge) can run alongside T019–T022 (Main).

## Parallel Example: User Story 1

```text
T002  TxtRenderer.tsx — props, finishPress branch, readOnly condition
T004  MdRenderer.tsx  — props, onPointerUp branch
T006  capabilities.ts — comments
then  T003 (TxtRenderer undo guard) → T005 (ReaderScreen wiring) → T007 (checks)
```

## Parallel Example: User Story 3

```text
T013 + T014  core helper + its vitest file
T015         statements.ts
then  T017 → T018 → {T019, T020, T023} → T021 / T022 / T024 → T025 ; T026 anytime
```

## Implementation Strategy

### MVP first (User Story 1 only)

1. T001
2. T002–T007
3. Stop and validate with quickstart rows 1–5, 13: the visible broken tool on TXT / Markdown is fixed.

### Incremental delivery

1. US1 → commit + push.
2. US2 (PDF tool) → commit + push.
3. US3 (language: core → Main → renderer) → commit + push.
4. Polish (T028–T030).

## Notes

- Commit after each finished story (user preference: commit + push the working branch after each finished task). `main` currently refuses direct pushes, so push to a feature branch.
- Never run Desktop E2E as routine verification.
- `spike:reader:toolbar`: after T011 every toolbar / capability check passes; it then stops at "8. sidebar tabs — rail: placeholder keeps Page layout" (expects a `transcript` tab) — unrelated to this feature (`SIDEBAR_TABS`), pre-existing, not fixed here.
- Pre-existing failures from T001: none (typecheck, lint, sdk:test, check:desktop-baseline all green on 2026-11-09).
