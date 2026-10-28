# PDF Typewriter note

Spec, plan, data model, contracts and tasks: `specs/005-typewriter-note/`. This page is the map of what was built and what was
(and was not) verified.

## What it is

A **Typewriter note** is a text box placed anywhere on a PDF page, with rich text (family, size, colour, bold, italic, underline,
strikethrough, per-paragraph alignment incl. justify), Vietnamese included. It is a first-class annotation row like highlights and
shapes, and it is written into the PDF as a standard `/FreeText` whose text is real text in an embedded font.

## Where things live

| Concern | Where |
|---|---|
| Row layout | one `notes` row, `note_json.type = 'typewriter'`; plain text in `notes.note` (untrimmed, NFC, ≤ 10 000 chars); box in `pdfAnnotation.rects[0]`; rich text in `pdfAnnotation.typewriter` (`PdfTypewriterDoc` v1: `base`, `runs`, `align`). No migration, no new IPC channel |
| Pure logic (SDK) | `book-reader-sdk/src/typewriter/` — doc model + validation, edit operations (`applyStyle`, `applyAlign`, `editText`), layout (`layoutTypewriter`, the SAME lines the app paints and the PDF appearance stream uses), font list + coverage, box geometry |
| Fonts | `apps/reading-book-desktop/assets/fonts/typewriter/` — Noto Sans (4 faces), Noto Serif (4), Noto Sans Mono (2), SIL OFL 1.1; packaged through `electron-builder.json5` `files`. Licences: `THIRD_PARTY_FONTS.md`, `OFL.txt`; coverage notes: `COVERAGE.md` |
| PDF writing (Main) | `electron/pdf-sync/typewriter-pdf.ts` (FreeText + appearance stream + font objects), `pdf-font-embed.ts` (in-repo TrueType reader / subsetter, no package), `typewriter-font-files.ts`; wired through `pdf-incremental-writer.ts` and `pdf-annotation-write.ts` |
| Sync | the scan reads only `readmate:` FreeText as managed rows (a foreign FreeText stays a graphic object); two-way merge in `pdf-annotation-two-way.ts`: the file contributes **text and box only**, the rich-text document is app-authoritative, a different text in the file is a conflict |
| Renderer | `reader/renderers/pdf/PdfTypewriter{Layer,Editor,Selection}.tsx` (model-authoritative `contenteditable`, IME applied on `compositionend`); stores in `screens/Reader/logic/pdfTypewriter/` (prefs, editor session, panel target, file status, format values); Properties sidebar `components/rightPanel/Typewriter{PropertiesPanel,FormatControls}.tsx` inside the existing `ReaderRightSidebar` |
| Preferences | `readmate.pdfTypewriterPrefs.v1` (defaults for NEW notes), reset by Reset App Settings |

## "Not in the file"

When a note cannot be written safely it stays in the app, untouched, and says why (Notes row + Properties panel):
`unsupported_characters` (the list is shown), `font_unavailable`, `does_not_fit`, `file_not_writable` (read-only, encrypted, in use,
signed, changed on disk, app-owned copy). One such note never blocks the other annotations of the same write.

## Checks

SDK `npm run verify` (typewriter, two-way and history tests); desktop `npm run typecheck`, `lint`, `e2e:typecheck`, `npx vite build`;
spikes `spike:pdf:typewriter` (IPC validation + the real writer + pdf.js read-back), `spike:pdf:typewriter-store`,
`spike:pdf:typewriter-perf`, `spike:pdf:typewriter-font`, `spike:pdf:two-way`, `spike:pdf:export`, `spike:pdf:compat-kit -- <dir>`;
E2E (manual-only) `pdf-typewriter.spec.ts`, `pdf-typewriter-format.spec.ts`.

## Verification table (what was and was NOT tested)

| Area | Result | Evidence |
|---|---|---|
| Create, type Vietnamese, commit, empty and drag cases | tested, pass | E2E `pdf-typewriter` |
| Select, move, resize, edit, delete — one undo step each (Hand and Select) | tested, pass | E2E `pdf-typewriter`, `spike:pdf:typewriter-store` |
| Mouse / keyboard text selection in the editor | tested, pass | E2E `pdf-typewriter-format` |
| Formatting, mixed runs, coalesced colour drags, persistence | tested, pass | SDK tests, `spike:pdf:typewriter-store` |
| Properties sidebar (defaults / note / selection, no leaking between targets, close commits) | tested, pass | E2E `pdf-typewriter-format`, store spike |
| IME composition (Telex / VNI) with a real Vietnamese IME | **not tested**: only `insertText` with Vietnamese letters was driven; the `compositionend` path was not exercised by a real IME | — |
| Writing into the PDF: one incremental update, original bytes untouched, text / box / fonts read back with pdf.js | tested, pass | `spike:pdf:typewriter`, E2E (real file) |
| Rotated (90, 180 + crop) and differently sized pages | tested, pass (box position and drawn text through pdf.js) | `spike:pdf:typewriter` |
| Two-way sync, export, conflict on foreign text, delete | tested, pass | `spike:pdf:two-way`, `spike:pdf:export`, SDK tests |
| Pixel-level agreement of file vs app (SC-009: within 1 px) | **not measured**: both use the same layout and font files, but no rendered-pixel comparison was made | — |
| Rendering by a second engine (PDFium) | **not tested** for Typewriter notes (an existing E2E covers PDFium for shapes and markup only) | — |
| Other PDF readers (Foxit, Acrobat, SumatraPDF, Preview …) | **not tested**: the kit is built by `spike:pdf:compat-kit`; results are to be recorded in `pdf_annotation_reader_compatibility.md` (T063) | — |
| Performance | 10 000 chars / 500 runs: layout median ≈ 3–4 ms; one keystroke (edit + re-layout) ≈ 4 ms (target ≤ 16 ms); worst-case page-sized note written in ≈ 0.4 s (target ≤ 1 s). Editor DOM paint not measured | `spike:pdf:typewriter-perf` |
| Regression of other PDF tools | all `spike:pdf:*` pass; E2E ink, shapes, inserted text, fit page, TOC, two-way, PDFium and embedded-annotations pass (the embedded spec had stale expectations — Squiggly marks use `data-kind="squiggly"` since 2026-10-19 — fixed, and it passes with the Typewriter changes in place). **Still red:** one test, `pdf-annotations.spec` › "EPUB highlights still work and never mix with PDF annotations" (EPUB, not PDF). The PDF test of that file was rewritten for the icon toolbar ("Underline" is now a toolbar button) and passes. The EPUB test no longer creates a highlight with its old steps (right-click menu on a script selection) and a real mouse drag with the Highlight tool armed did not create one either in the E2E harness; whether that is a test-harness problem or an EPUB markup regression was not determined. It is outside the Typewriter code paths (PDF only) but was not checked against a clean tree | — |
| `spike:reader:toolbar` | fails on a rail assertion about the audiobook Transcript tab (spec 004) before reaching the Typewriter check; the Typewriter assertions were run separately and pass | — |
