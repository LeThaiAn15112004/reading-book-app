# PDF Inserted Text (caret at an insertion point)

Status: implemented 2026-10-19 — see "Verification" for what was and was not tested.

Goal: with the **Insert Text** tool armed on a PDF, a click marks a precise insertion point with a small
caret (`^`) just under the text line, and an editor takes the text to insert. The PDF text is never
changed. Not Replace Text (strike-out + new text), not a Sticky Note, not Typewriter.

## 1. Audit of the existing architecture

| Topic | What the repo already does |
|---|---|
| Library | `pdfjs-dist` 5.4.624 renders pages and the text layer; there is no PDF editing library in the renderer. |
| Model | A PDF annotation is a `notes` row: `page-rect` locator + `note_json.pdfAnnotation = { pageIndex, rects, contents? }`, rects normalized 0–1 against the displayed page box (`book-reader-sdk/src/app-models/pdf-highlight.ts`). |
| Styles | `HighlightStyleKind` already has `insert`. Before this change it was a text *selection* painted as a dashed underline (`index.css` `.rb-pdf-annot[data-kind='insert']`). |
| Lifecycle | `pdfHighlightsStore` (zustand): create → optimistic row + `overlay:saveHighlight`, edit note/color via `patchHighlight`, delete, undo/redo (`highlightAdd/Remove/Replace`). Main re-validates with `parsePdfAnnotation`. |
| Rendering | `PdfAnnotationLayer.tsx` paints `.rb-pdf-annot` boxes as % of the page slot; `PdfRenderer` hit-tests clicks itself (`annotationAt`, `pdfMarkAt`). |
| Editors | `HighlightEditPopup` (color, note, tags, copy, delete) for existing marks; `NoteTextboxPopup` for `textbox` notes. |
| File sync | `SUBTYPE_FOR_STYLE` in `pdf-annotation-export.ts` does **not** map `replace` / `insert`: they stay in SQLite and are never written into the PDF. `Caret` is listed under "not imported" in `pdf_embedded_annotation_import.md`. |
| Tests | SDK vitest (`tests/app-models/pdf-highlight.test.ts`, `pdf-annotation-*.test.ts`); desktop has spikes and manual-only E2E. |

## 2. PDF representation — decision and evidence

- The PDF spec has **no** `InsertedText` subtype. Insert-style comments are written by readers as a
  `/Subtype /Caret` annotation (spec 12.5.6.11: `/Rect`, `/RD`, `/Sy`, `/Contents`), and Acrobat's
  replace is a StrikeOut + Caret pair linked with `/IRT` + `/RT /Group` + `/IT /Replace`. This is
  taken from the spec and from the earlier note in `pdf_annotation_export.md` / `pdf-annotation-export.ts`.
- **No Foxit-generated PDF is available in the repo** (only signature / search fixtures and the
  generated `build-annotated-pdf.mjs` kit, none with a Caret). So Foxit's exact output
  (`/Rect`, `/IT`, `/Sy`, appearance stream) is **unverified** and no interoperability is claimed.
- Chosen approach: keep the row in SQLite only, exactly like `insert` / `replace` today. Nothing is
  written into the user's PDF and nothing is silently turned into a Note or a Replace. A Caret in a PDF
  stays untouched by import and sync (it is not managed), so unrelated annotations are preserved.
- Follow-up when a Foxit fixture exists: write/import `Caret` with `/Contents`, verify against the file.

## 3. Model (no migration)

- Location and text are kept apart: the **point** is `note_json.pdfAnnotation` (one small rect with a
  new optional flag `caret: true`), the **text to insert** is the row's `note`. Old rows lack the flag and
  keep their dashed-underline look.
- The caret rect is built by `pdfCaretRect` (SDK): `x` = insertion x minus half the width, `y` just
  above the line bottom, `height` ≈ half a line, all normalized to the page box — so zoom, scrolling,
  window size and reopening cannot move it. `rotation` is whatever the displayed page box already
  applies (same model as every other mark).
- `parsePdfAnnotation` accepts `caret` only as `true`; anything else drops the payload. SQLite rows round
  trip through the same JSON, so no schema change and no data rewrite.

## 4. Interaction

1. Tool **Insert Text** armed → click on text. `PdfRenderer` finds the text-layer glyph under the
   pointer (or the nearest glyph on that page when the click lands in a gap), measures the caret
   position inside that glyph run with `caretPositionFromPoint` + a collapsed `Range`, and reports
   `{ page, x, bottom, height }` normalized to the page slot (`pdfInsertionPoint.ts`).
2. The store keeps a **draft** (`pendingInsert`) and shows the caret plus an editor next to it. Nothing
   is saved yet.
3. **Save** with text creates the row (one undo step); **Save** with empty text, **Escape** or a click
   elsewhere cancels the draft — no empty annotation is ever created.
4. Clicking a saved caret opens the usual annotation editor (color, text, delete). Emptying the text
   there keeps the caret, like other marks; Delete removes it.
5. A drag with the Insert tool places the caret at the release point; it no longer creates a selection mark.

## 5. Rendering

`.rb-pdf-annot[data-kind='insert'][data-caret]` draws a small `^` (two 1.5 px strokes in the annotation
color) at the top of its box, centered, under the baseline. The layer already sits under the text
spans with `mix-blend-mode: multiply`, so glyphs stay readable.

## 6. Limits

- The exact in-word character position depends on PDF.js text-layer boxes; for ligatures and glyph
  runs with odd spacing the caret can be off by up to one glyph.
- On pages with `/Rotate` the caret is still drawn screen-down; its tip does not follow rotated text.
- Not written into the PDF file; not shown by other readers.

## 7. Verification (2026-10-19)

Run and passing: SDK `npm run verify` (typecheck, test typecheck, 326 tests incl. 11 new caret tests in
`tests/app-models/pdf-highlight.test.ts`, build); desktop `tsc --noEmit`, `npm run lint`, `npx vite build`;
`spike:pdf:annotations` (26 checks, 5 new for the caret against the real Main IPC + SQLite),
`spike:pdf:export`, `spike:pdf:two-way`, `spike:reader:toolbar`.

Failing, not caused by this change: `spike:pdf:embedded` expects an imported Squiggly to become `underline`
but the importer now yields `squiggly` (nothing under `electron/pdf-sync` was touched here).

E2E (run on request, hidden window): `e2e/specs/pdf-inserted-text.spec.ts` passes — place, Escape / empty
Save / Cancel leave nothing, save, caret on the right line, original text unchanged, hover tooltip, zoom,
scroll away and back, app restart, edit, delete, repeated create + undo. Not covered: rotated pages,
a real Foxit file. Other specs run alongside: `txt-annotations` (3) and two PDF selection specs pass;
the two big flows in `pdf-annotations.spec.ts` fail on a stale toolbar locator ("Annotation" dropdown)
and an EPUB selection menu, and the EPUB one fails the same with the EPUB hover change reverted.

Not run: the rest of the E2E suite and any visible window. The click hit-test, caret and editor are covered by the E2E above (no unit-test runner for them).
Not verified against any Foxit-generated PDF (none in the repo).
