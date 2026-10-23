# PDF graphic objects (hover / select / edit objects made by other readers)

Shapes, lines, ink and text boxes that already live **inside** a PDF (Square, Circle, Ink, Line, PolyLine,
Polygon, FreeText, Stamp annotations written by Foxit / Acrobat / …) get the same three states as the app's
own freehand Ink: **hover** (bounding outline only), **selected** (outline + resize handles + compact
toolbar with HEX colour and Delete), **deselected** (click on empty space or Escape).

## What each type offers (only what is safe)

| Type | Resize | Colour | Delete |
|---|---|---|---|
| Square, Circle, Ink | yes | yes | yes |
| Line, PolyLine, Polygon, FreeText, Stamp | – | – | yes |

An object that is not an indirect object in the file, or has a cloudy border (`/BE`), offers nothing.
Square / Circle / Ink get a freshly built appearance stream (`/AP`) so every reader shows the edit; the
other types are only removed from the page's `/Annots`.

## Pieces

- SDK `app-models/pdf-graphic-objects.ts` — `readPdfJsGraphic`, capabilities, op validation, hit test
  (`pdfGraphicAt`: the selected object wins wherever it is hit, else the topmost), `resizePdfGraphicBox`.
- Main `electron/pdf-sync/pdf-graphics.ts` (scan worker kinds `graphics-list` / `graphic-edit`) +
  `appendRawObjects` in the incremental writer. Every edit is ONE incremental update, read back with
  pdf.js and verified (box / colour written, nothing else changed).
- Main `electron/ipc/graphics.ipc.ts` — `graphics:list`, `graphics:apply`. Same gate as the two-way
  write-back: user-owned file, writable, not encrypted, **not signed** (no confirmation flow here), file
  unchanged since it was read; then `books.sha256` is kept in step.
- Renderer: `usePdfGraphicsStore` (mirror of Main's list, no undo history — the file is the source of
  truth), `PdfRenderer` (shared hover / selection with freehand Ink, preview box while dragging a handle,
  re-reads the file's bytes after a write and returns to the same page), `PdfInkSelectionOverlay`.

## Not done

- No app-side undo for these edits (the file is rewritten; use the other reader or the backup).
- Signed PDFs are refused (a toast says why); there is no "write anyway" for graphics yet.
- Line / FreeText resize and colour (their appearance can't be rebuilt without line endings / fonts).
- Manual check in the running app; E2E for the pointer wiring.

Checks: `npm run spike:pdf:graphics`, SDK `tests/app-models/pdf-graphic-objects.test.ts`.
