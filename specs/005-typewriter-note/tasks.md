---

description: "Task list for Typewriter Note for PDF"
---

# Tasks: Typewriter Note for PDF

**Input**: Design documents from `/specs/005-typewriter-note/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/typewriter-note.md, quickstart.md

**Tests**: Included. The spec, plan and quickstart explicitly require SDK vitest tests and desktop spikes (quickstart §A, T-01…T-16). E2E is manual-only: no task runs it.

**Organization**: Grouped by user story. All five stories are P1 and form ONE release (spec "Delivery"): nothing ships until US5 (milestone M2) passes. Phase 2 contains the M0 gate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1…US5 (spec.md user stories)
- Paths are relative to the repo root. `SDK` = `source/apps/book-reader-sdk`, `DESK` = `source/apps/reading-book-desktop`.

## Standing rules for every task

- SDK code must not import Electron, DOM, `better-sqlite3`, React or a format engine (SDK `tsconfig`: `lib: ES2022`, `types: []`).
- No new IPC channel and no migration (plan.md). `HighlightDto` only gains an optional field.
- Do not install dependencies and do not run E2E or Electron unless the task says so; a task that needs a new package is marked **[NEEDS APPROVAL]** and stops until the user approves.
- After each task that touches code run the relevant check from quickstart §A; keep `npm run typecheck`, `npm run lint` (desktop) and SDK `npm run verify` green.
- Commit + push after each finished task per the user's `auto-commit-and-push` preference (memory), unless the user says otherwise this session.

---

## Phase 1: Setup

**Purpose**: places for the new code and assets; nothing functional.

- [X] T001 Create SDK module folder `SDK/src/typewriter/` with empty `index.ts`, and test folder `SDK/tests/typewriter/`; export `./typewriter/index.js` from `SDK/src/index.ts`
- [X] T002 [P] Create asset folder `DESK/assets/fonts/typewriter/` with a `README.md` listing the licence/`fsType` check required for every file (M0-6) and an empty `THIRD_PARTY_FONTS.md`
- [X] T003 [P] Create spike script stubs `DESK/spikes/pdf-annotations/run-pdf-typewriter-font.mjs`, `run-pdf-typewriter.mjs`, `run-pdf-typewriter-store.mjs` and add `spike:pdf:typewriter-font`, `spike:pdf:typewriter`, `spike:pdf:typewriter-store` scripts to `DESK/package.json`, copying the command shape of `spike:pdf:shapes` / `spike:pdf:shape-store`

---

## Phase 2: Foundational (M0 gate + shared model) — BLOCKS all stories

**Purpose**: prove the two unproven bets (embedded Unicode font, shared layout) and build the pure model every story uses. No UI.

### M0 spike (gate: criteria M0-1…M0-8 in plan.md)

- [X] T004 Obtain candidate font files (Noto Sans, Noto Serif, one monospace with italics, Regular/Bold/Italic/BoldItalic where they exist) into `DESK/assets/fonts/typewriter/`; record for each: licence text, copyright, `OS/2.fsType`, and presence of all precomposed Vietnamese letters (every vowel × tone, upper+lower, Đ/đ) in `DESK/assets/fonts/typewriter/COVERAGE.md`. Drop any face that fails (M0-1, M0-6). **[NEEDS APPROVAL]** to add font binaries to the repo
- [X] T005 Decide the TrueType reader/subsetter: write a short comparison in `specs/005-typewriter-note/research.md` (D5) between an in-repo module and a package; default to in-repo. If a package is chosen, stop **[NEEDS APPROVAL]** before installing and verify it bundles with `npx vite build` (M0-8)
- [X] T006 Implement `DESK/electron/pdf-sync/pdf-font-embed.ts`: read a TrueType file (cmap formats 4 and 12, `head`, `hhea`, `hmtx`, `maxp`, `OS/2`, `loca`/`glyf` incl. composite glyphs), expose `advance(codePoint)`, `ascent`, `descent`, `unitsPerEm`, and `subsetFace(face, codePoints)` returning a valid TrueType subset plus glyph-id map; also build Type0 / CIDFontType2 (`Identity-H`, `CIDToGIDMap /Identity`, `/W`, `FontDescriptor` with `FontFile2`) and the `/ToUnicode` CMap per contracts §2
- [X] T007 [P] Write the layout prototype used by the spike in `SDK/src/typewriter/typewriter-layout.ts` (final form is T012): wrap at spaces, break over-long words by character, kerning/ligatures off, line height `1.2 ×` tallest font size on the line, `FontMetrics` port `advance(face, codePoint)` / `ascent` / `descent` / `unitsPerEm`
- [X] T008 Implement `DESK/spikes/pdf-annotations/run-pdf-typewriter-font.mjs`: lay out the Vietnamese corpus (≥ 30 sentences covering every tone × vowel mark), write one FreeText through the real incremental writer (extend `DESK/electron/pdf-sync/pdf-incremental-writer.ts` minimally for the spike: dictionary + AP + font objects), read back with pdf.js, and print pass/fail for M0-1…M0-8 including: extracted text equals input, glyph pixels present, original bytes unchanged, per-line width vs. browser measurement (≤ 1 px at 100 %), 10 000-char layout time (< 16 ms), bytes added per note (target ≤ 150 KB)
- [X] T009 Run `npm run spike:pdf:typewriter-font` (from `DESK/`), paste the result table into `specs/005-typewriter-note/research.md` under D3–D5 and update the plan's M0 status. **If any of M0-1…M0-8 fails, STOP and revise plan.md before Phase 3**

### Shared pure model (SDK)

- [X] T010 [P] Implement `SDK/src/typewriter/typewriter-doc.ts` and `SDK/tests/typewriter/doc.test.ts` (T-01, T-02): types `PdfTypewriterDoc`, `TextStyle`, `StyleRun`, `AlignSpan` exactly as data-model §2; `normalizeTypewriterText` (NFC, `\r\n`→`\n`, strip control characters except `\n`); `parseTypewriterDoc(value, text)` enforcing: "`0 ≤ start < end ≤ text.length` for each run; runs sorted by `start`, no overlap, adjacent runs with equal style merged, no empty `style`", "run boundaries never split a surrogate pair or a precomposed letter", "`align[i].start` is 0 or follows a `\n`; sorted, unique", "at most 500 runs and 200 align spans", `size` clamped to `[TYPEWRITER_MIN_SIZE, TYPEWRITER_MAX_SIZE]` (≈ 6–144 pt on a 612 pt page, fractions of width), family in the shipped list, `color` `#RRGGBB`; text 1–10 000 UTF-16 code units, not blank
- [X] T011 [P] Implement `SDK/src/typewriter/typewriter-fonts.ts` and `SDK/tests/typewriter/fonts.test.ts` (T-06): stable family ids (`noto-sans`, `noto-serif`, … as decided in T004), `EmbeddedFontFaceInfo` data (id, bold/italic availability, covered ranges), `faceFor(family, bold, italic)`, `checkCoverage(text, doc)` returning `{ ok: true } | { ok: false, characters }` after the fallback rule (missing in chosen family → default family face; still missing → unsupported); Arabic/Thai/emoji reported, every precomposed Vietnamese letter passes
- [X] T012 Finalise `SDK/src/typewriter/typewriter-layout.ts` with `SDK/tests/typewriter/layout.test.ts` (T-05): `layoutTypewriter(doc, text, boxWidth, pageWidth, metrics)` → `{ lines, height, unsupported }`; alignment per paragraph, justify stretches spaces on every line except the last of a paragraph, over-long word break, height = sum of line heights, deterministic. Tests use a fake `FontMetrics`
- [X] T013 [P] Implement `SDK/src/typewriter/typewriter-edit.ts` and `SDK/tests/typewriter/edit.test.ts` (T-03, T-04): `applyStyle(doc, text, range|null, patch)` (range → runs, merged; `null` → set `base` and clear overrides of the touched keys; toggle on a partly-set range sets all), pending-style helper for a collapsed caret, `applyAlign`, `editText(doc, text, change)` with prefix/suffix run mapping ("runs wholly before the edit stay, runs wholly after shift, runs overlapping the edit are trimmed; inserted text takes the style of the character before the caret (or the pending typing style)"), `effectiveStyle(doc, offset)`
- [X] T014 Export everything from `SDK/src/typewriter/index.ts`; add `typewriter` to `HighlightStyleKind` in `SDK/src/app-models/highlight-location.ts` and to the unions in `SDK/src/domain/annotation/highlight.ts` and `SDK/src/domain/annotation/note.ts`; add `PdfTypewriterGeometry` to `PdfAnnotation` (`typewriter?: PdfTypewriterDoc`); fix every exhaustive switch the compiler reports (research R9) and list the touched files in the task's commit message
- [X] T015 Extend `parsePdfAnnotation` in `SDK/src/app-models/pdf-highlight.ts` and `SDK/tests/app-models/pdf-highlight.test.ts` (T-09): accept `typewriter` only with `rects.length === 1` and a valid doc (call `parseTypewriterDoc` with the row text); reject otherwise; keep the 512 KiB packed limit
- [X] T016 [P] Add `'typewriter'` to `validStyleKinds` in `DESK/electron/ipc/overlay.ipc.ts` and to the SQL type lists (`json_extract(note_json, '$.type') IN (…)` near lines ~216 and ~279) in `DESK/electron/persistence/sqlite-overlay-store.ts`; in `overlay.ipc.ts` validate the payload per contracts §1 (blank text, one rect, valid doc, box inside page, box height ≥ laid-out height → `does_not_fit`)
- [X] T017 [P] Add `typewriter?: PdfTypewriterDoc` to the `pdfAnnotation` shape of `HighlightDto` in `DESK/electron/ipc/api-types.ts` and mirror it in `DESK/src/bridge/` wrappers if they restate the type
- [X] T018 Load-time font access: create `DESK/electron/pdf-sync/typewriter-font-files.ts` (Main: reads the shipped files, caches parsed faces) and `DESK/src/reader/renderers/pdf/typewriterFonts.ts` (renderer: `@font-face` registration from the same files, `FontMetrics` implementation using the parser from T006 compiled for the renderer or an equivalent table dump generated at build time — pick the option M0 proved)
- [X] T019 Extend `SDK/src/app-models/pdf-annotation-export.ts`: add `'FreeText'` to `PdfWriteSubtype`, map `typewriter` → `FreeText` in `SUBTYPE_FOR_STYLE`, add a `typewriter` field (doc + text + box) to `PdfWriteAnnotation`; unit tests in `SDK/tests/app-models/pdf-annotation-export.test.ts` for T-07 up to (not including) the font/AP content

**Checkpoint**: M0 passed and recorded; pure model, validation and plumbing compile; `npm run verify` (SDK), desktop `typecheck`, `lint` green.

---

## Phase 3: User Story 1 — Create a text box and type (P1) 🎯 MVP core

**Goal**: click or drag creates a box; type multi-line Vietnamese text; Escape/outside commits; empty discards.

**Independent Test**: spec US1 — drag a box, type "Xin chào, đây là ghi chú tiếng Việt" + a second line, Escape, close and reopen the book: same box, position, text.

### Tests

- [X] T020 [P] [US1] Add store tests to `DESK/spikes/pdf-annotations/run-pdf-typewriter-store.mjs` (T-13 part): create from click, create from drag, empty draft discarded, non-empty committed as exactly one undo step, undo/redo restore, `does_not_fit` refused with the text unchanged
- [X] T021 [P] [US1] Add Main-side tests to `DESK/spikes/pdf-annotations/run-pdf-typewriter.mjs` (T-10): real `overlay:saveHighlight` / list / patch / delete with `styleKind: 'typewriter'`; rejects blank text, `rects.length !== 1`, box outside page, over 10 000 characters (the "box shorter than the laid-out text" refusal is NOT done in Main: it needs the page aspect ratio only the renderer / writer know — `fitTypewriterBox` sizes the box in the renderer and the writer refuses with `does_not_fit`)

### Implementation

- [X] T022 [US1] Create `DESK/src/screens/Reader/logic/pdfTypewriter/pdfTypewriterPrefsStore.ts` (zustand + `localStorage` key `readmate.pdfTypewriterPrefs.v1`, `{ style: TextStyle, align }`, per-field fallback on invalid values, `reset()`), modelled on `pdfShapePrefsStore.ts`; defaults: first shipped sans family, ≈ 12 pt as fraction of page width, `#000000`, left; register `reset` in `APP_SETTINGS_RESETTERS` in `DESK/src/screens/Settings/logic/resetAppSettings.ts` (T-15)
- [X] T023 [US1] Add `typewriter` to `pdfHighlightsStore` (`DESK/src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts`): `createTypewriter({ pageIndex, box, text, doc })`, optimistic row + `overlay:saveHighlight`, history entry via existing `highlightAdd`; `does_not_fit` and save failures toast and keep the draft
- [X] T024 [US1] Add reader capability `typewriterAnnotations` (PDF only) to `DESK/src/reader/capabilities.ts` and a `typewriter` `ToolDef` (group `annotation`, label `Typewriter`, `requires: ['typewriterAnnotations']`) plus an icon in `DESK/src/screens/Reader/components/chrome/toolRegistry.ts` and `ToolsMenu.tsx`; extend `spike:reader:toolbar` (`DESK/spikes/reader-toolbar/run-toolbar.mjs`) so the tool exists for PDF only
- [X] T025 [US1] Create `DESK/src/reader/renderers/pdf/PdfTypewriterLayer.tsx`: paints saved notes of a page slot from `layoutTypewriter` output (lines → absolutely positioned spans with CSS `font-kerning: none; font-variant-ligatures: none`), positions in percent of the slot like `PdfShapeLayer`; takes no pointer events
- [X] T026 [US1] Create `DESK/src/reader/renderers/pdf/PdfTypewriterEditor.tsx` and `DESK/src/screens/Reader/logic/pdfTypewriter/typewriterEditorStore.ts`: model-authoritative `contenteditable` (intercept `beforeinput`, apply to the doc via `editText`, re-render from the model, map DOM selection ↔ offsets, paste as plain text, IME composition committed on `compositionend`, 10 000-character cap with a message); store holds only editing id, selection range, pending typing style and is cleared on id change
- [X] T027 [US1] Wire creation in `DESK/src/reader/renderers/pdf/PdfRenderer.tsx`: with the Typewriter tool armed, a click creates a draft at the point (default width = 25 % of page width, clamped inside the page) and a drag > 4 px creates a draft with that rectangle (minimum width 4 % of page width); a click on an existing note selects it instead of creating (spec US1-7); Escape/click outside commits non-empty text (box height = laid-out height) and discards empty; the tool stays armed; switching tool, closing the book or quitting commits first
- [X] T028 [US1] Notes list entry: add the `typewriter` kind (label "Typewriter", plain-text preview, jump to page) in `DESK/src/screens/Reader/components/sidebar/TocSidebar.tsx` and the filter in `DESK/src/screens/Reader/logic/highlights/notesFilterStore.ts`
- [X] T029 [US1] Run SDK `npm run verify`, desktop `npm run typecheck`, `npm run lint`, `npx vite build`, `npm run spike:pdf:typewriter`, `npm run spike:pdf:typewriter-store`, `npm run spike:reader:toolbar`, `npm run spike:settings:reset`; fix failures. Then manual quickstart steps B1–B3 (needs the running app: ask the user to run them)

**Checkpoint**: a user can create, type (Vietnamese), commit, reopen. Not releasable yet.

---

## Phase 4: User Story 2 — Select, move, resize, edit (P1)

**Goal**: Select Mode one click selects; Hand Mode double-click selects; move, resize with 8 handles, edit by double-click/Enter/F2.

**Independent Test**: spec US2 — select a saved note, move it, resize from a corner and an edge, double-click to edit a word, click outside; reopen and verify.

### Tests

- [X] T030 [P] [US2] Extend `run-pdf-typewriter-store.mjs`: move, resize, edit-commit each produce exactly one undo step; resize never yields a height below laid-out height; font/width change that leaves the page is refused (`does_not_fit`) with the stored row unchanged; Delete removes and undo restores (T-13)

### Implementation

- [X] T031 [US2] Investigate and document in `specs/005-typewriter-note/research.md` (D9, "verified") the existing rules in `DESK/src/reader/renderers/pdf/PdfRenderer.tsx` around `outlinesOn` / `inkOutlinesAvailable`, `targetAt`, the Hand press logic (~line 2051) and Select text selection, so T032–T035 reuse them; no code change
- [X] T032 [US2] Add Typewriter notes as a target kind in the hover/selection pipeline of `PdfRenderer.tsx` and `DESK/src/reader/renderers/pdf/PdfInkSelectionOverlay.tsx`: hover outline in Hand, Select and while the tool is armed; selection: one click in Select Mode and with the tool, double-click in Hand Mode (a single click in Hand stays the existing pan / center tap); selected note shows outline, 8 handles (`nw n ne e se s sw w`), quick toolbar
- [X] T033 [US2] Moving and resizing in `PdfRenderer.tsx`: press body of the selected note + drag beyond `PAN_DRAG_THRESHOLD_PX` (4 px) moves, clamped inside the page, one history entry on release; press on a handle resizes (width free down to the minimum "width ≥ 4 % of the page width"; height only up from the laid-out minimum; result re-laid-out); pressing on a note never pans or starts PDF text selection; Select Mode: a press on a note wins over text selection, elsewhere unchanged
- [X] T034 [US2] Editing state machine in `PdfRenderer.tsx` + `typewriterEditorStore.ts` per data-model §5: double-click on a selected note (or a second single click in Select Mode), Enter, F2 → EDITING with the caret at the click point (Enter/F2: end); Escape or outside click commits and keeps the note selected; Escape on a selected note deselects; Delete/Backspace on a selected, non-editing note deletes (one undo step); Ctrl/Cmd+Z/Y inside the editor are text-level, outside use the annotation history
- [X] T035 [US2] Overflow rule: implement `does_not_fit` refusal in `pdfHighlightsStore.ts` (`patchTypewriter`) and show a short toast/inline message ("The text does not fit on the page — enlarge the box or reduce the size."); text is never clipped
- [X] T036 [US2] Create `DESK/src/screens/Reader/components/chrome/TypewriterQuickToolbar.tsx` (Edit, Delete — the Properties button is added with the sidebar, T049) shown for the selected note, positioned like the Ink quick toolbar, keyboard-focusable
- [X] T037 [US2] Run the same checks as T029 plus `npm run spike:pdf:shapes`, `spike:pdf:shape-store`, `spike:pdf:ink`, `spike:pdf:ink-store`, `spike:pdf:graphics`; then ask the user to run quickstart steps B4–B7 and B21

**Checkpoint**: full object editing in Hand and Select Mode, no regressions in existing tools.

---

## Phase 5: User Story 3 — Format text (P1)

**Goal**: family, size, colour (picker + HEX), B/I/U/S, alignment; per range, per caret, per box; mixed styles persist.

**Independent Test**: spec US3 — bold red word, italic underlined word, centred first paragraph; restart; identical.

### Tests

- [X] T038 [P] [US3] Extend `SDK/tests/typewriter/edit.test.ts` for T-03/T-04 edge cases: toggle on a partly-bold range, pending style cleared on caret move, whole-box change clears per-range overrides of that key only, alignment applied to the paragraphs touched, edits across run boundaries
- [X] T039 [P] [US3] Extend `run-pdf-typewriter-store.mjs`: each format change is one undo step, coalesced for colour/size drags; mixed formatting survives a store reload from SQLite

### Implementation

- [X] T040 [US3] Implement formatting commands in `typewriterEditorStore.ts` + `pdfHighlightsStore.ts` (`formatTypewriter`): with a stored range → range; collapsed caret → pending typing style; no editor range → whole box; family/size/colour/B/I/U/S/alignment; italic/bold controls disabled with a reason when the family lacks that face (use `faceFor` from T011)
- [X] T041 [US3] Paint underline, strikethrough, colour, alignment and justification in `PdfTypewriterLayer.tsx` / `PdfTypewriterEditor.tsx` from the layout output so the page shows exactly what will be written
- [X] T042 [US3] Create a reusable `DESK/src/screens/Reader/components/rightPanel/TypewriterFormatControls.tsx` (family select, size input in pt for a nominal 612 pt page width, colour via `react-colorful` + HEX field accepting `#1E88E5` and `1e88e5`, rejecting invalid values with the field marked and the previous colour kept, B/I/U/S toggles, alignment group with justify); every control uses `onMouseDown={preventDefault}` so the editor keeps its selection; indeterminate state for mixed values
- [ ] T043 [US3] Run SDK `npm run verify`, desktop `typecheck` + `lint` + `spike:pdf:typewriter-store`; ask the user for quickstart steps B8–B10

**Checkpoint**: rich text works in the app and persists.

---

## Phase 6: User Story 4 — Properties sidebar (P1)

**Goal**: right-click the tool → defaults; right-click a note or Properties → that note; no state leaks; closing keeps edits.

**Independent Test**: spec US4 — set Serif / 18 pt / blue in defaults, create a box, then right-click an old note and see its own values.

### Tests

- [X] T044 [P] [US4] Extend `run-pdf-typewriter-store.mjs` (T-14): panel target select A → B → none → defaults; after each switch no value, selection, pending style or field text of the previous target is visible; defaults persist, invalid stored values fall back, `reset()` restores
- [X] T045 [P] [US4] Extend `DESK/spikes/reader-toolbar/run-toolbar.mjs`: static checks that the Typewriter tool button has an `onContextMenu` handler that calls `preventDefault` and opens the `typewriter` panel, and that `RightPanelId` contains `'typewriter'`

### Implementation

- [X] T046 [US4] Add `'typewriter'` to `RightPanelId` in `DESK/src/screens/Reader/logic/rightPanel/rightPanelStore.ts`; create `DESK/src/screens/Reader/logic/pdfTypewriter/typewriterPanelStore.ts` (`{ mode: 'defaults' } | { mode: 'note', id }`, holds ids only; displayed values read from the row or the prefs store)
- [X] T047 [US4] Create `DESK/src/screens/Reader/components/rightPanel/TypewriterPropertiesPanel.tsx` using `TypewriterFormatControls` (T042): defaults mode writes to `pdfTypewriterPrefsStore` and affects only boxes created afterwards; note mode reads/writes the row through `pdfHighlightsStore`, shows values at the selection when a range is selected, and an "Edit text" action that starts on-page editing; render it inside the existing `ReaderRightSidebar` from `DESK/src/screens/Reader/ReaderScreen.tsx` (extend the `rightPanel` title/content switch near line 1073 — no second sidebar)
- [X] T048 [US4] Right-click on the Typewriter tool button in `DESK/src/screens/Reader/components/chrome/ToolsMenu.tsx`: `onContextMenu` → `preventDefault`, open the panel in defaults mode, do not arm or disarm the tool
- [X] T049 [US4] Right-click on a note in `PdfRenderer.tsx` (existing `onContextMenu` ~line 2171 and `onAnnotationContextMenu` prop in `ReaderScreen.tsx`): select the note and open the panel in note mode; the quick toolbar Properties button does the same; selecting another note refreshes the panel and clears `typewriterEditorStore`; deselecting returns to defaults; closing the panel commits an open edit first; Escape inside the panel returns focus to the page
- [X] T050 [US4] When the panel opens or resizes the reading area, scroll the selected note into view if it is covered (`rightSidebarContentInset` changes the page width; geometry is normalized so only the scroll position needs fixing) in `ReaderScreen.tsx` / `PdfRenderer.tsx`
- [ ] T051 [US4] Run SDK `npm run verify`, desktop `typecheck`, `lint`, `npx vite build`, `spike:pdf:typewriter-store`, `spike:reader:toolbar`, `spike:settings:reset`; ask the user for quickstart steps B11–B14

**Checkpoint**: the whole app-side experience (US1–US4) works; notes not yet written to the file show as "not in the file".

---

## Phase 7: User Story 5 — Saved into the PDF, readable elsewhere (P1) — M2, RELEASE GATE

**Goal**: real text in an embedded font, correct in other readers, with sync, export and clear failure reasons.

**Independent Test**: spec US5 — write a Vietnamese mixed-style note, open the file in the readers available and record results.

### Tests

- [X] T052 [P] [US5] Extend `SDK/tests/app-models/pdf-annotation-two-way.test.ts` (T-08): sync fields for `typewriter` are `kind`, `color`, `text`, `geometry`; the doc is never taken from the file; a foreign `/Contents` change yields a conflict and leaves the doc untouched
- [X] T053 [P] [US5] Complete `run-pdf-typewriter.mjs` (T-11, T-12): single incremental update with original bytes unchanged; pdf.js text equals input; fonts resolve; bold/italic/underline/strike/colour/alignment/justify read back; unrotated, `/Rotate 90`, `/Rotate 180` + crop pages; ineligible files (encrypted, read-only, signed, changed on disk) keep the note pending with `file_not_writable`; unsupported characters give `unsupported_characters` with the list; a broken font gives `font_unavailable`; nothing is dropped in any case
- [X] T054 [P] [US5] Extend `run-pdf-annotation-export.mjs` and `run-pdf-two-way.mjs` with typewriter notes (export includes them; write-back, edit, delete; foreign text change → conflict)

### Implementation

- [X] T055 [US5] Finish the FreeText writer in `DESK/electron/pdf-sync/pdf-incremental-writer.ts` per contracts §2: dictionary (`/Subtype /FreeText`, `/IT /FreeTextTypewriter`, `/Rect`, `/Contents`, `/DA`, `/Q`, `/BS << /W 0 >>`, `/F 4`, `/NM readmate:<id>`, `/T`, `/M`, `/CreationDate`, `/P`), appearance stream from `layoutTypewriter` (per run `BT /Fn size Tf r g b rg x y Td <glyph ids> Tj ET`, word spacing for justified lines, underline/strike as thin filled rectangles), font objects from `pdf-font-embed.ts` (one subset per face per update), page rotation/crop through the existing page transform; remove any spike-only shortcuts from T008
- [X] T056 [US5] Wire the write path: `DESK/electron/pdf-sync/pdf-annotation-write.ts` and the plan code in `SDK/src/app-models/pdf-annotation-export.ts` produce the typewriter write item; `checkCoverage` and layout run before writing; any failure yields a pending note with the reason code from contracts §3 (never a silent skip); the existing read-back verification checks text, box and font resolution and rolls back on failure
- [X] T057 [US5] Scan and ownership: update `DESK/electron/pdf-sync/pdf-annotation-scan.ts` / `pdf-annotation-scan.worker.ts` / `pdf-graphics.ts` and `SDK/src/app-models/pdf-embedded-annotations.ts` so an owned `readmate:` FreeText is read as a managed row (text, box) and never offered as a foreign graphic object; foreign FreeText stays a read-only graphic object
- [X] T058 [US5] Two-way merge: extend `SDK/src/app-models/pdf-annotation-two-way.ts` (`fileSide`, `appSide`, `applyFileFields`) for `typewriter` per T052; the app doc is authoritative; conflict UI path is the existing one
- [X] T059 [US5] Renderer status: show "not in the file" with the reason and action text on the Notes row and in the properties panel (messages per contracts §3: `file_not_writable` → existing messages, `unsupported_characters` → "Remove or replace: …", `font_unavailable` → "Restart the app; your text is kept", `does_not_fit` → "Enlarge the box or reduce the size"); content is never altered
- [X] T060 [US5] Export: make "Export PDF with annotations…" (`DESK/electron/pdf-sync/pdf-annotation-export.ts`) include typewriter notes with the same writer
- [X] T061 [US5] Extend `DESK/spikes/pdf-annotations/build-compat-kit.mjs`: add Vietnamese, mixed-style, justified, centred and right-aligned typewriter notes on the unrotated, `/Rotate 90` and cropped `/Rotate 180` pages, and matching entries in `expected.json`
- [X] T062 [US5] Run SDK `npm run verify`, desktop `typecheck`, `lint`, `npx vite build`, `spike:pdf:typewriter`, `spike:pdf:export`, `spike:pdf:two-way`, `spike:pdf:embedded`, `spike:pdf:live`, `spike:pdf:annotations`, `spike:pdf:compat-kit -- <scratch dir>`
- [ ] T063 [US5] Manual cross-reader check (the user runs it; quickstart B15–B20): record in `docs/implementation_plan/pdf_annotation_reader_compatibility.md` the version and result for every reader actually used, and list readers not run as "not tested". Do not claim compatibility without these records (FR-028, SC-004). A defect found is fixed or the reader is recorded as unsupported

**Checkpoint (release gate)**: spec SC-001…SC-009 verified as far as automated tests and recorded manual runs allow.

---

## Phase 8: Polish and cross-cutting

- [X] T064 [P] Write `docs/implementation_plan/pdf_typewriter.md` (what was built, verification table with what was and was not tested, link to the spec) and add a **Typewriter** paragraph to `CLAUDE.md` in the "Persistence" section next to Shape tools (style kind, doc layout, FreeText + embedded fonts, no new IPC/migration, fonts folder, spikes)
- [X] T065 [P] Add `THIRD_PARTY_FONTS.md` content (licence texts, copyright) and make sure the packaged app includes `DESK/assets/fonts/typewriter/` (check `electron-builder` file patterns in `DESK/package.json` / builder config)
- [ ] T066 Regression pass (quickstart T-16 and B21): run all `spike:pdf:*` scripts listed in `CLAUDE.md` plus `spike:reader:toolbar`, `spike:reader:hand`, `spike:settings:reset`; confirm Shape, Freehand, Eraser, markup tools, PDF text selection, Search, zoom, fit-page and continuous scroll are unchanged
- [X] T067 Performance check: measure 10 000-character re-layout and typing latency in the editor; record in `docs/implementation_plan/pdf_typewriter.md`; if over target, profile and fix before release
- [X] T068 Final cross-check of requirements FR-001…FR-030 and SC-001…SC-009 against what was verified; update `specs/005-typewriter-note/checklists/requirements.md` notes and the "Open items" in `plan.md` (font list, parser choice, readers tested)

---

## Dependencies and order

- Phase 1 → Phase 2 (M0 gate T004–T009 must pass before T010+ is relied on; T010, T011, T013 can start in parallel with M0 since they are pure and independent of the font bytes, but nothing from Phase 3 starts until T009 passes).
- Phase 2 → all stories. T014 before T015/T016/T017/T019. T012 needs T007 and T011.
- US1 (T020–T029) first. US2 needs US1's layer/editor (T025–T027). US3 needs US1's editor (T026) and T013. US4 needs US3's controls (T042). US5 needs T006, T012, T019 and the store/rows from US1; it can start the writer work (T055–T058) in parallel with US2–US4 once T029 is green, but the release needs all of them.
- Phase 8 last.

## Parallel examples

- After T003: T002 ∥ T004's research while T005 is decided; T007 ∥ T010 ∥ T011 ∥ T013 (different SDK files).
- After T014: T016 ∥ T017 ∥ T019.
- US1: T020 ∥ T021 (test scripts) before T022–T028; T025 ∥ T026 (different components).
- US5: T052 ∥ T053 ∥ T054 (test files) before T055–T060; T061 ∥ T057.

## Implementation strategy

1. Complete Phases 1–2; **stop at T009** and report the M0 result to the user. If the Unicode/PDF approach fails, revise the plan (research D5 fallback: glyph outlines) before any UI work.
2. Build US1 → US4 in order, validating each checkpoint (internal milestone M1; not releasable alone).
3. Build US5 (M2). Release only when T062–T063 are done and every claim about other readers has a record.
4. Polish.

MVP scope for demonstrating progress: Phases 1–3 (create and type, Vietnamese, persisted). The **release** scope is all phases, by decision in the spec.
