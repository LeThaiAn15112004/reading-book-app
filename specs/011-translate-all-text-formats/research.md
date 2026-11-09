# Research: Translate in every text format

All findings come from reading the current code (2026-11-09). No NEEDS CLARIFICATION is left.

## R1. Why Translate mode does nothing on TXT / Markdown and is missing on PDF

- **Finding**: Translate mode is a flag in `useTranslationStore.mode` (`screens/Reader/logic/translation/translationStore.ts`).
  `ReaderScreen` turns it on from the toolbar (`case 'translate'`: closes floating UI, sets the tool to `select`, `setMode(true)`)
  and passes it ONLY to `EpubRenderer` (`translateModeActive` + `onTranslateDragEnd`). `TxtRenderer`, `MdRenderer` and
  `PdfRenderer` never receive it, so a finished selection there just stays selected.
  The toolbar entry is gated by the `translate` capability (`components/reader/capabilities.ts`): `epub`, `txt`, `md` have
  it, `pdf` does not. The comments above `txt` and `md` still say "translate (out of scope)" — stale.
- **Decision**: Give the three renderers the same pair of props as EPUB — a boolean "translate mode is on" and a
  callback "a selection was finished in translate mode" — and add `translate` to the `pdf` capability list.
- **Rationale**: Each renderer already has exactly one place that decides what a finished selection means, driven by
  the armed markup tool: `TxtRenderer.finishPress`, `MdRenderer.onPointerUp`, `PdfRenderer` pointer-up (`markupToolRef`
  + `selectionChangedSince`). Translate mode is the same decision with a different callback, so it slots in there with
  no new gesture code. Markup tools and Translate mode are already mutually exclusive in `ReaderScreen` (`selectTool`
  turns the mode off; turning the mode on sets the tool to `select`), so a renderer never sees both at once.
- **Alternatives considered**:
  - Listening to `selectionchange` in `ReaderScreen` for all formats: fires mid-drag, needs debouncing, and loses the
    "only a selection THIS press made" guard PDF relies on. Rejected.
  - Opening the existing selection context menu automatically and pre-clicking Translate: two UIs flash; rejected.

## R2. Language hint of a selection, per format

- **Finding**: `TranslationSelection = { text, lang }`. EPUB fills `lang` from the nearest `lang` / `xml:lang` attribute
  (`openEpubjs.ts` `selectionLang`). PDF sets `lang: ''` (`pdfSelection.ts`: "No language metadata is read from the PDF").
  TXT and Markdown call `openForSelection({ text, lang: '' })`. Nothing in `books` / `metadata_json` stores a language
  for any format.
- **Decision**:
  - EPUB: unchanged (selection DOM language).
  - PDF: read the document's catalog `/Lang` once per opened document — pdf.js 5.4.624 (the version in the repo)
    exposes it as `getMetadata().info.Language` (`Language: catalog.lang` in the worker) — and put it in every
    `PdfSelectionInfo.lang`.
  - TXT and Markdown: no language source exists (no metadata, no detection — spec Assumptions). `lang` stays `''`,
    which falls through to the remembered choice or the default.
- **Rationale**: No import / migration change; the PDF value is read where the document is already loaded.
- **Alternatives considered**: Reading `/Lang` at import into `metadata_json` — needs Main changes and a backfill for
  existing books; Markdown front-matter `lang:` — not a standard, rarely present; automatic language detection —
  out of scope by spec.

## R3. Where to remember the hand-picked source language (FR-007a)

- **Finding**: Per-book reader state lives in `books.reading_state_json`. Two write paths exist:
  `patchSessionPreferences` / `updateAudioProgress` are `json_patch` merges (other keys survive), but
  `overwriteSessionState` (`core/src/db/overlay/statements.ts`, used by `saveSessionState`, i.e. the reading-position
  autosave) REPLACES the whole JSON with the keys `readingStateOfSession` builds. A new key written by a merge would be
  erased by the next autosave.
- **Decision**: Store it as a new key `translationSourceLang` (a catalog code, e.g. `vi`) in `reading_state_json`:
  - written by a dedicated `json_patch` (new statement `patchTranslationSource`), `null` removes it;
  - read by a dedicated statement;
  - `overwriteSessionState` changed to carry the stored `translationSourceLang` over into the new JSON (SQL
    `json_set` / `json_patch` with the old value), so the autosave never drops it.
  Exposed through two new channels in the existing `TranslationChannels` group:
  `translation:getSourceLanguage` and `translation:setSourceLanguage`.
- **Rationale**: Per-book state belongs to the book's row (CLAUDE.md "Per-book reading state … lives in
  `books.reading_state_json`"); it survives restarts and disappears with the book row (FR-007a) at no extra cost; no
  migration (JSON column). The `translation` group is already "not available" on Mobile, so the Mobile bridge needs no
  real implementation.
- **Alternatives considered**:
  - Renderer `localStorage` keyed by book id: CLAUDE.md reserves it for app-level preferences; it would not be removed
    with the book and would be wiped by Reset App Settings. Rejected.
  - Adding the field to `ReadingSessionState` / `SaveReadingSessionStateInput`: every autosave would have to carry it
    and the session hook would own translation state — larger change, races with the autosave. Rejected.
  - New table: unnecessary for one value per book.

## R4. Starting source language — one rule for every format

- **Finding**: `open()` in the store: `sourceLocked ? sourceLang : normalize(info.lang) ?? 'en'`. `setSourceLang` and
  `swapLanguages` set `sourceLocked = true`; `resetForNewBook` clears it.
- **Decision**: A pure core function `resolveTranslationSource({ remembered, selectionLang, fallback })` returning the
  first valid catalog code in the order remembered → normalized selection language → fallback (FR-007). The store loads
  the remembered value when the book changes (`resetForNewBook` → `translationApi.getSourceLanguage(bookId)`) and
  saves it whenever the user changes the source by hand (`setSourceLang`, `swapLanguages`). A failed read/save
  degrades to today's per-session behaviour (no toast loop; one console warning).
- **Rationale**: The precedence is the only new rule; making it pure puts it under vitest in `source/core/tests`
  (the Desktop UI has no test runner). The core already owns `normalizeTranslationLanguage` / `findTranslationLanguage`.
- **Alternatives considered**: Keeping the rule inline in the zustand store — untestable without a spike.

## R5. TXT read-only while Translate mode is on (clarification Q1)

- **Finding**: `TxtRenderer` sets `input.readOnly = !editable || markupTool !== null` — the same mechanism the markup
  tools use, which already blocks typing, paste, cut and IME. But its keydown handler calls `onUndo` / `onRedo` on
  Ctrl/Cmd+Z / Y and `beforeinput` `historyUndo` / `historyRedo` without checking `readOnly`, so undo could still change
  the text while a markup tool (and later Translate mode) is armed.
- **Decision**: Add `translateMode` to the read-only condition, and make the undo / redo paths no-ops while the box is
  read-only. Leaving the mode restores the old condition on the next layout effect (no reload).
- **Rationale**: Reuses the existing read-only switch; closes the undo hole for markup tools at the same time.

## R6. Markdown selection text

- **Finding**: `readMdSelection(article)` returns the rendered text of the selection (what `Copy` and the context-menu
  Translate already use), not raw Markdown.
- **Decision**: Use it unchanged for Translate mode (FR-009).

## R7. Checks available

- **Finding**: Core logic → vitest (`npm run sdk:test`). Main SQL → spikes on the migrated schema, re-launched with
  Electron's binary because better-sqlite3 is built for Electron's ABI (pattern of `spike:audio:migration`). Any Main
  file change must be listed in `source/scripts/desktop-main-changes.json` for `check:desktop-baseline`. E2E is
  manual-only and is not run by the agent.
- **Decision**: core unit tests for R4; one spike `spike:translation:source` (get / set / clear, survives an
  `overwriteSessionState`, removed with the book, foreign / invalid codes refused); manual quickstart for the UI.
