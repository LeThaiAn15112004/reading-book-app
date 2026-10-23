# PDF Shape tools (rectangle · ellipse · line · arrow)

Status: implemented (first version). Shapes are **first-class annotations**: rows of the existing `notes`
table, items of the existing Notes list, steps of the existing annotation history — not a parallel store.

## 1. What the code looked like (inspection)

| Question | Answer (evidence) |
|---|---|
| Where do annotations live? | `notes` rows, `note_json.type` = the style kind, `group = 'annotation'`, PDF geometry in `note_json.pdfAnnotation` (`sqlite-overlay-store.ts`). `notes.type` has **no** CHECK constraint, so a new kind needs **no migration**. |
| How are they created / listed / edited / deleted? | Renderer `pdfHighlightsStore` → IPC `overlay:saveHighlight` / `listHighlights` / `deleteHighlight` (Main validates) → SQLite. The Notes tab (`TocSidebar`) renders `pdfHighlights.highlights`. Undo/redo = the store's `history` (`add` / `replace` / `remove`). |
| Does saving the row write the PDF? | **Yes, automatically** — `saveHighlight` calls `pdfAnnotationSync().notifyAppChange()`; the always-on two-way sync (`planTwoWaySync`) appends an incremental update to a user-owned, writable, unencrypted, unsigned file. Otherwise nothing is written and the row stays in SQLite (a signed file asks the user, as for text markup). |
| Does creating a PDF annotation create a row? | Only when it is scanned: embedded annotations are imported by `/NM` identity. Shapes drawn by **another** reader are NOT imported (see §4). |
| Select / hover / handles / toolbar | `PdfRenderer` + `PdfInkSelectionOverlay` (shared with freehand Ink and the file's graphic objects, `pdf_graphic_objects.md`). |
| Eraser | Works on `type = 'ink'` rows only (`INK_TYPE_PREDICATE`); a shape id is not an ink row. |

## 2. Representation

`HighlightStyleKind` gained `rectangle | ellipse | line | arrow`. A shape row:

- `note_json.type` = the kind; `style.colorHex` = `#RRGGBB` (+ `AA` opacity byte, the convention of every annotation);
- `pdfAnnotation.rects` = ONE rect (its bounding box, normalized 0–1 over the displayed page box);
- `pdfAnnotation.shape` = `{ strokeWidth, line? }` — pen width (fraction of the page width) and, for a line / arrow,
  its endpoints `[x1,y1,x2,y2]` start → end (the head is at the end). Rectangle / ellipse: the box IS the shape; line / arrow: the
  endpoints' box grown by half the pen and the arrow head (never empty, even for a horizontal line);
- locator = the usual `page-rect` (jump target), `chapterIndex` = 0-based page.

Validation: `parsePdfAnnotation` (SDK) rejects bad `shape` payloads; `overlay:saveHighlight` additionally requires a
shape kind to carry `shape` (with `line` iff line / arrow) and refuses `shape` on any other kind.

## 3. UI / behaviour

- Toolbar: **Shapes** in the Freehand group (between Freehand and Eraser), PDF only (capability `shapeAnnotations`), with a
  dropdown arrow (kind, colour — the shared `InkColorControl` —, thickness, opacity), remembered in `readmate.pdfShapePrefs.v1`
  and reset by Settings → Reset App Settings.
- Drag in any direction → live preview → shape on release (`shapeFromDrag`); a click / degenerate drag creates nothing;
  Escape, window blur, pointer cancel or leaving the tool cancel the gesture. Clamped to the page the drag started on.
- Select / Hand: hover = bounding outline; click = outline + handles (8 box handles for rectangle / ellipse, two endpoint handles
  for line / arrow) + compact toolbar (HEX colour, Delete). Resize / colour / delete go through `pdfHighlightsStore`
  (one history step each, the same row is updated). Click on empty space or Escape deselects. The selection is
  `focusedHighlightId` (no popup); selecting a card in the Notes list jumps to the page, pulses and selects the shape; the
  selected shape's card has the accent border.
- Hit testing is by outline (hollow rectangle / ellipse: the border band; line / arrow: distance to the segment and head), so
  text under a hollow shape stays selectable. Shapes are painted by their own SVG layer and are NOT in the text-markup `annotations`
  prop (their boxes would swallow clicks).
- Notes list: labels + type filters for the four kinds; no "(no excerpt)" line for shapes.

## 4. PDF persistence and interoperability

Written by the existing two-way sync as one incremental update (original bytes untouched, read back with pdf.js):

| Row | PDF |
|---|---|
| rectangle | `/Subtype /Square`, `/Rect` = box, `/C`, `/CA`, `/BS << /W w >>`, own `/AP` |
| ellipse | `/Subtype /Circle`, same |
| line | `/Subtype /Line`, `/L`, `/LE [/None /None]`, own `/AP` |
| arrow | `/Subtype /Line`, `/L` start→end, `/LE [/None /OpenArrow]`, own `/AP` (line + open head) |

`/NM` = `readmate:<row id>` (stable identity; the planner updates the SAME object on edit and removes it on delete — no duplicates
on reopen / re-sync). Opacity is `/CA`; the sync compares colour **and** opacity, pen width, endpoints and kind as fields.

**Foreign shapes** (no `readmate:` `/NM`) are never imported as rows: they stay the file's own *graphic objects*
(`pdf_graphic_objects.md`; hover / select / edit in place). Main's scan drops them, and the graphic scan drops Readmate's own.

PDF.js specifics handled in Main (`pdf-annotation-scan.ts`): `/L`, `/LE`, `/CA` and `/BS /W` are read from the raw dictionary
(PDF.js sorts `/L` into a box, drops `/LE` and `/CA`, and returns the default width for some Lines).

## 5. Limitations (not claimed)

- Cross-viewer rendering is NOT verified with Acrobat / Foxit: the files carry a standard dictionary plus our own appearance
  stream, which is what those viewers display, but only PDF.js was run against them here.
- Only an unrotated page was exercised in the real-file checks; the writer maps every point through the page transform, so
  rotated / cropped pages are expected to work, unverified.
- Fill colour, dashed lines, rounded rectangles, other arrow ends, moving a whole shape and `/Contents` editing from the shape UI
  are out of scope for this version.
- A signed PDF is not written (same gate and confirmation as text markup); the shapes stay in SQLite.
- Managed (URL / cloud) copies keep shapes in SQLite only, as for every annotation.
- The pointer / DOM wiring (gesture, hit test in the live page, handle drags) has no automated browser test (the desktop app has
  no test runner and E2E is manual-only); its pure logic and the stores are covered, see §6.

## 6. Checks

- SDK `tests/app-models/pdf-shape.test.ts` — geometry in every direction, zoom invariance, minimum size, resize, hit test, storage
  validation, PDF write mapping, two-way plan (no duplicates), PDF.js reading.
- `npm run spike:pdf:shape-store` — real stores + Main IPC + SQLite: create / list / reopen / edit / select / jump / delete /
  undo-redo (incl. the shared Ctrl+Z router) / refused save / eraser safety / prefs.
- `npm run spike:pdf:shapes` — real sync service + files: SQLite rows, standard annotations written, geometry equal, no loop or
  duplicates, same object rewritten on edit, removed on delete, reopen, foreign shape untouched, original bytes preserved,
  signed file not written.
- `npm run spike:reader:toolbar`, `spike:settings:reset` — toolbar registry / wiring and Reset App Settings.
