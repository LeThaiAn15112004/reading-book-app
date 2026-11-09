# Translate in every text format (spec 011)

Spec: `specs/011-translate-all-text-formats/` (spec, plan, research, contracts, quickstart, tasks).

## What changed

- **Translate mode in every text renderer.** The toolbar Translate tool (`useTranslationStore.mode`) reaches EPUB,
  PDF, TXT and Markdown. Each renderer takes `translateModeActive` + a "selection finished" callback
  (`onTranslateDragEnd` for EPUB, `onTranslateSelection` for the others) and decides in the same place it decides
  for an armed markup tool: `TxtRenderer.finishPress`, `MdRenderer.onPointerUp`, `PdfRenderer` pointer-up (same
  "only a selection THIS press made" guard). The selection stays visible. `ReaderScreen` passes
  `translation.openForSelection`. PDF got the `translate` capability; Mobile still removes it (`MOBILE_EXCLUDED`).
  Contract: `specs/011-translate-all-text-formats/contracts/renderer-translate-mode.md`.
- **TXT is read-only while Translate mode is on** (`readOnly` like an armed markup tool) and undo / redo are ignored
  in that mode only — the TXT history also holds highlight steps, so Ctrl+Z with a markup tool armed still undoes a
  mark.
- **Language hint of a selection:** EPUB = the text's `lang` attribute (unchanged); PDF = the document's catalog `/Lang`
  (pdf.js `getMetadata().info.Language`, read once per document in `PdfRenderer`, added to both the selection menu and
  Translate mode); TXT / Markdown = none.
- **Remembered source language per book:** `books.reading_state_json.translationSourceLang` (a catalog code; no
  migration). Written by `translation:setSourceLanguage` (`json_patch`, `null` removes it, `books.updated_at`
  untouched), read by `translation:getSourceLanguage`; `SqliteOverlayStore.get/setTranslationSource` refuse
  audiobooks, unknown books and codes outside the catalog. `overwriteSessionState` (the full overwrite used by core
  services and Mobile) carries the key over; the renderer autosave (`saveSessionPreferences`) is a merge anyway. The
  value goes with the book row. Contract: `contracts/translation-source-ipc.md`.
- **Starting source:** core `resolveTranslationSource({ remembered, selectionLang, fallback })` — remembered →
  normalized selection language → `en`. The store loads the remembered value on book change (`resetForNewBook(bookId)`;
  a late answer re-runs a translation already started with the fallback) and saves it on a hand pick or a Swap.

## Checks

- `npm run sdk:test` — `tests/services/translation/resolve-translation-source.test.ts`,
  `tests/db/overlay-statements.test.ts` (patch / remove / overwrite carry-over on node:sqlite).
- `npm run spike:translation:source` — the real handlers + store on the migrated schema (13 checks).
- `npm run spike:reader:toolbar` — PDF now has Translate in the navigate group.
- Manual: `specs/011-translate-all-text-formats/quickstart.md`.
