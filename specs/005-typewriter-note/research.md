# Research: Typewriter Note for PDF

Findings come from reading this repository (no external lookup, nothing run or installed). Facts about PDF and TrueType come from the PDF specification and the existing `docs/implementation_plan/pdf_*.md` write-ups; anything not proven here is labelled **unverified** and is covered by the M0 spike.

## 0. What the repository already has (inspection)

| Topic | Finding | Source |
|---|---|---|
| Annotation model | A PDF annotation is a `notes` row: `page-rect` locator + `note_json.pdfAnnotation` (`pageIndex`, `rects`, optional `caret`, `contents`, `shape`). `parsePdfAnnotation` validates; limits: 2000 rects, `contents` 10 000 chars, packed 512 KiB | `book-reader-sdk/src/app-models/pdf-highlight.ts` |
| Style kinds | `HighlightStyleKind` is a union; allow-lists exist in Main (`overlay.ipc.ts` `validStyleKinds`) and SQL (`sqlite-overlay-store.ts` JSON type lists) | grep results |
| Shapes | `rectangle/ellipse/line/arrow` are first-class rows; geometry in `rects[0]` + `shape`; opacity in `colorHex`. **Shapes have no text and no rich text.** Their selection chrome is shared with Ink | `pdf-shape.ts`, `PdfShapeLayer.tsx`, `PdfInkSelectionOverlay.tsx` |
| Selection and Hand | `PdfRenderer` owns hover/select/resize for Ink, shapes and file graphic objects through one overlay: hover outline, selected outline, handles, compact toolbar, Escape deselect, `PAN_DRAG_THRESHOLD_PX = 4`, outlines active only for pen/shape/eraser/markup tools (`inkOutlinesAvailable`). Hand pans unless the press is on the selected object | `PdfRenderer.tsx` (~l.552, 1551, 1595, 2051); `pdf_toolbar_hand_select.md` |
| Right sidebar | One generic frame `ReaderRightSidebar` + `useRightPanelStore` (`RightPanelId = 'settings'`), docks and shrinks the reading area by `rightSidebarContentInset`; comment says other features reuse it | `rightPanel/*`, `ReaderScreen.tsx` l.1073 |
| Tool settings UI | Shape/Freehand settings are popovers opened from an arrow beside the tool in `ToolsMenu.tsx`. **No toolbar button has a right-click handler today** | `ShapeSettingsPopover.tsx`, `ToolsMenu.tsx` |
| Annotation context menu | `HighlightContextMenu` and `onAnnotationContextMenu` exist for text markup | `HighlightContextMenu.tsx`, `PdfRenderer.tsx` l.2171 |
| Tool prefs | zustand store + `localStorage`, `reset()` in `APP_SETTINGS_RESETTERS` | `pdfShapePrefsStore.ts` |
| History | `pdfHighlightsStore` with session undo/redo of add/remove/replace | `pdfHighlightsStore.ts` |
| PDF writer | Hand-written incremental writer builds raw objects (annotation dict, `/AP` form XObject, text strings via `textString`); only `/ExtGState` resources; **no font objects, no font embedding, no PDF library** in the desktop app (`pdfjs-dist` is read-only) | `pdf-incremental-writer.ts` |
| Write subtypes | `PdfWriteSubtype` = Highlight, Underline, Squiggly, StrikeOut, Text, Square, Circle, Line. `FreeText` is only *read* as a foreign "graphic object" | `pdf-annotation-export.ts`, `pdf-graphics.ts` |
| Ownership rule | `readmate:<id>` `/NM` annotations are never offered as foreign graphic objects | `pdf-graphics.ts` l.132 |
| Fonts | No `.ttf/.otf/.woff` files and no `@font-face`/`@fontsource` in the desktop app; SDK has no dependencies | search of the tree |
| Unicode in a PDF today | `/Contents` is written with `textString` (the compat kit has a Vietnamese sticky note). That only proves the *string* is stored; the visible part of a `/Text` annotation is an icon | `build-compat-kit.mjs` |
| Compatibility evidence | The only engine ever driven is Chromium's PDF viewer (highlights, sticky icon, `/CA`, rotated pages verified). **Foxit, Acrobat, SumatraPDF were not tested.** Vietnamese text in the sticky note was verified in the file with pdf.js, not rendered by a reader | `pdf_annotation_reader_compatibility.md` |
| Inserted text | `insert` rows are SQLite-only; the plan explicitly says "not Typewriter" | `pdf_inserted_text.md` |
| Tests | SDK vitest (`tests/app-models/pdf-*.test.ts`); desktop = spikes; E2E manual-only | `CLAUDE.md` |

Consequence: three things must be built that do not exist at all: **rich text**, **font embedding/Unicode text in an appearance stream**, and a **layout engine** shared by the app and the writer. Everything else (rows, history, sync, selection chrome, sidebar frame, prefs) has a precedent to reuse.

## D1 — Model: new style kind plus a rich-text document inside `pdfAnnotation`

- **Decision**: `typewriter` style kind; plain text in `notes.note`; box in `rects[0]`; rich text as `pdfAnnotation.typewriter` = `{ v, base, runs, align }` (see `data-model.md`). No migration.
- **Rationale**: shapes prove the path (Notes list, history, sync). Keeping plain text separate from style runs keeps `/Contents`, search and sync free of markup. Runs over offsets can represent mixed formatting; a flat style cannot.
- **Alternatives**: separate table (duplicates list/undo/sync, needs a migration); storing HTML/Markdown in `note` (markup leaks into Notes list and `/Contents`); one flat style (rejected by the requirement).

## D2 — Editor: a DOM editor over the page, converting to and from the document model

- **Decision**: an in-place editor positioned over the page slot, implemented as a `contenteditable` element restricted to plain-text semantics (paste as text, `beforeinput` intercepted and applied to the document model, re-rendered from the model). The model — not the DOM — is the source of truth; selection is mapped between DOM ranges and document offsets. IME composition (Vietnamese Telex/VNI) is handled by letting the browser compose and committing the composed text on `compositionend`.
- **Rationale**: Vietnamese typing relies on IME/composition; a custom canvas editor would have to re-implement it. A `<textarea>` cannot show mixed styles (the TXT editor uses a textarea with a backdrop, which suits one style only).
- **Risks**: contenteditable selection mapping and composition are fiddly; mitigated by keeping the model authoritative and testing the offset mapping as pure code in the SDK. No rich-text editor library is added unless the spike for the editor shows the plain approach failing (not assumed).
- **Alternatives**: `<textarea>` + backdrop (single style only); a rich-text library (extra dependency, heavy, still needs mapping to our model).

## D3 — Layout: one deterministic engine shared by the app and the writer

- **Decision**: a pure SDK module (`typewriter-layout.ts`) lays out `TypewriterDoc` into lines of positioned runs given (a) box width, (b) page width, (c) a `FontMetrics` port (advance width per code point per face, ascent/descent). Kerning/ligatures off; line height constant; justify by stretching spaces; wrap at spaces, breaking over-long words by character. The renderer supplies metrics measured from the same shipped font files (parsed once), and Main supplies metrics from the same files. The editor displays lines using CSS that matches (`font-kerning: none`, `font-variant-ligatures: none`, `text-rendering: optimizeSpeed`), and the stored box height comes from the engine.
- **Rationale**: a PDF appearance stream contains explicit lines. If the app wrapped by browser rules and the file by other rules, "what you see is what is saved" would fail (SC-009). Identical font files + identical rules make differences negligible.
- **Alternatives**: measure in the browser and send positioned lines to Main (Main would trust renderer geometry; harder to test; rejected); canvas `measureText` (depends on system rasterizer, can differ by platform).
- **Unverified**: that browser line widths match table advances to < 1 px with kerning off. The spike must measure this (pass criterion in `plan.md`).

## D4 — Fonts shipped with the app

- **Decision**: ship a curated set of static font files (Regular, Bold, Italic, Bold Italic where the family has them) under a permissive licence, with full Vietnamese coverage (Latin Extended Additional U+1E00–1EFF plus the needed Latin-1/Extended-A letters). Initial candidates: **Noto Sans**, **Noto Serif** (both SIL OFL 1.1, Vietnamese supported by design), plus one monospace candidate (**Noto Sans Mono** has no italic; **Roboto Mono** has italics and Vietnamese, Apache-2.0). The final list is set by the spike after checking coverage, `OS/2.fsType` embedding permission, and that bold/italic are real faces.
- **Rationale**: system fonts cannot be shown identically on every machine, may forbid embedding, and are unreadable from the renderer sandbox.
- **Licensing**: OFL and Apache-2.0 allow embedding in documents and redistribution with the app if the licence texts and copyright notices ship in a third-party notices file; to be confirmed against each downloaded font's own licence file. **Not legal advice; unverified until the files are in hand.**
- **Fallback**: if a character is missing from the chosen family, lay it out and write it with the default family (Noto Sans) face and mark the run as "fallback" in the layout result; if still missing, the character is *unsupported* → note stays "not in the file" with a message naming the characters (FR-026). The app also shows such characters with the same fallback so the page does not mislead.
- **Alternatives**: variable fonts (subsetting/instancing is harder); web fonts from a CDN (offline-first app); user font import (new feature, licence risk).

## D5 — Unicode text in the PDF: embedded subset TrueType as Type0/CIDFontType2

- **Decision**: for each (face × used glyphs) write a font subset as an embedded TrueType program in a Type0 composite font with `CIDFontType2`, `Identity-H` encoding, `CIDToGIDMap /Identity`, a `/W` widths array, a `FontDescriptor` with `FontFile2`, and a `/ToUnicode` CMap so that other readers can select, copy and search the text. The appearance stream draws each run with `Tf` + `Tj` of 2-byte glyph IDs. Underline and strikethrough are drawn as thin filled rectangles/lines in the appearance stream; bold/italic are real faces (no synthetic styling). Fonts are shared by all notes written in one update (one subset per face per update; a later update embeds again — simplicity over size).
- **Rationale**: this is the standard, reader-independent way to carry arbitrary Unicode text; it needs no reader-side fonts and keeps the characters as text.
- **Alternatives considered**:
  - *Standard-14 / WinAnsi (Helvetica)*: cannot draw most Vietnamese letters → rejected as the only path.
  - *Glyph outlines as vector paths in the appearance stream*: no font objects or licence-embedding concern, but text is not selectable or searchable and `/Contents` alone is the text → kept only as a documented fallback if embedding proves unsafe for a font.
  - *Rasterised image*: blurry, not text → rejected.
  - *Whole-font embedding*: large files, licence flags → rejected; subset only.
- **Implementation dependency (decision for the spike)**: reading a TrueType font (cmap format 4/12, `hmtx`, `loca/glyf` including composite glyphs for precomposed Vietnamese letters, `head`, `hhea`, `OS/2`) and producing a valid subset. Options: (1) write a small in-repo subsetter (no dependency; glyph-ID-preserving subset keeps `CIDToGIDMap` trivial; the main work is composite glyph handling and table checksums); (2) a maintained library for parsing/subsetting (for example `fontkit`, `opentype.js`, or a HarfBuzz-based subsetter) used only inside Main/host-adapters. Adding a package needs the user's approval and must be checked against Electron's bundling (`music-metadata` is already `external` in `vite.config.ts` because bundling its CommonJS deps broke the Main bundle). **Unverified; M0 chooses.**
- **Why not `pdf-lib`**: it rewrites whole documents; the repo's invariant is a single incremental update that leaves original bytes untouched.

## D6 — FreeText form in the file, including rich text

- **Decision**: `/Subtype /FreeText`, `/IT /FreeTextTypewriter`, `/Rect`, `/Contents` (plain text), `/DA` (a default font string and colour for readers that regenerate), `/Q` (alignment of the first paragraph), `/BS /W 0`, `/NM readmate:<id>`, standard `/T /M /CreationDate /P /F 4`, and `/AP /N` containing the already-laid-out lines with per-run fonts and colours. Rich text beyond `/Contents` is **not** duplicated into `/RC` in v1.
- **Rationale**: other readers display the appearance stream; the app is the authority for styled ranges. `/RC` (XHTML subset) could improve editing in Acrobat but readers handle it unevenly and there is no evidence either way in the repo.
- **Consequence**: editing a Readmate note's *text* in another reader may regenerate its look with a font that lacks Vietnamese; we do not promise external editing. The sync flow treats a changed `/Contents` as a conflict, so the user decides.
- **Unverified** in any reader other than the app's pdf.js read-back: whether Foxit, Acrobat, SumatraPDF, Preview, Chromium show the appearance stream with embedded subset fonts as intended. The compatibility kit is extended and the results recorded (see quickstart).

## D7 — Sync, scan and export

- **Decision**: add `FreeText` to `PdfWriteSubtype` and a `typewriter` mapping in `SUBTYPE_FOR_STYLE`; the writer gets a FreeText branch (dictionary + AP + font objects); the scan keeps treating `readmate:` FreeText as managed (existing ownership rule) and reads back the managed note's `/Contents`, `/Rect` and the embedded fonts' presence for verification. Foreign FreeText remains a read-only graphic object. Three-way merge fields: `kind`, `color`, `text`, `geometry`; the rich-text document is never overwritten from the file. Export uses the same plan.
- **Rationale**: reuses the existing eligibility checks, ledger, conflict state and read-back verification. A write that cannot be encoded is a *pending* state, never a silent skip.

## D8 — Sidebar: new panel id in the existing frame

- **Decision**: `RightPanelId = 'settings' | 'typewriter'`; content `TypewriterPropertiesPanel` rendered in the existing `ReaderRightSidebar`. Target (`defaults` or `note:<id>`) in `typewriterPanelStore`. Right-click on the Typewriter tool button opens it in defaults mode (new `onContextMenu` on the tool button; `preventDefault` on the native menu); right-click on a note selects it and opens note mode; the quick toolbar has a Properties button for keyboard/touch-pad users.
- **Rationale**: the frame already exists and is documented as reusable; the Shape popover pattern is a popover, but the request is for the right sidebar, so the sidebar frame is extended rather than duplicated.
- **Sidebar vs editor focus**: sidebar controls use `onMouseDown={preventDefault}` and keep the editor's selection in `typewriterEditorStore`; formatting commands are applied to the stored range, not to `document.getSelection()` at click time.
- **Layout**: the sidebar docks and shrinks the reading area; after opening, if the selected box is covered, scroll it into view (the page area changes width and the box moves with it, since geometry is normalized).

## D9 — Selection and Hand Mode integration

- **Decision**: add Typewriter notes as another selectable object kind in the same hover/selection pipeline as Ink/shapes (`targetAt`, overlay, handle drags). Selection is active in Hand Mode and while Typewriter is active. Editing is a separate state entered by double-click / Enter / F2 / "Edit text". While editing, pointer events inside the box belong to the editor; outside it, a pointer-down commits.
- **Rationale**: conventions and the 4 px threshold already exist; adding a parallel pipeline would duplicate and drift.
- **Decided (user)**: Select Mode (and the Typewriter tool): one click selects. Hand Mode: double-click selects; a single click is left to the existing pan / center-tap logic. A selected note enters editing by double-click, Enter or F2 (also a second single click in Select Mode). In Select Mode a press on a note wins over PDF text selection; elsewhere text selection is unchanged.
- **To verify in tasks**: the exact rule that decides whether a press on a selected object pans or drags (`PdfRenderer` l.2051), and that Select mode keeps normal PDF text selection when the pointer is not on a note.

## D10 — Overflow, resize, and minimum sizes

- **Decision**: box height is derived from layout (never clipped). Resize handles change width (and height only upward from the content minimum). A font-size or width change that would push the box off the page is refused with a message. Minimum width 4 % of the page width (but at least one average character), maximum = page width.
- **Rationale**: matches "do not silently lose text"; keeps the file, whose AP has fixed lines, consistent with the app.

## D11 — Undo/redo

- **Decision**: reuse `pdfHighlightsStore` history entries (`highlightAdd/Remove/Replace`): create, delete, move, resize, format, and an editing session each produce one entry; keystroke-level undo lives inside the editor only while editing. Redo/undo re-persist and re-sync like other rows.

## D12 — Verification approach

- SDK vitest: document parse/normalise, run mapping on edits, format application (range/whole/caret), layout (wrap, justify, overflow), font coverage check, export plan, three-way merge fields, NFC handling.
- Desktop spikes: `spike:pdf:typewriter-font` (M0), `spike:pdf:typewriter` (Main IPC + SQLite + writer + read-back), `spike:pdf:typewriter-store` (renderer stores against Main), extended `spike:pdf:export`, `spike:pdf:two-way`, `spike:reader:toolbar` (tool/capability/right-click wiring), `spike:settings:reset`.
- Manual compatibility with `spike:pdf:compat-kit` (extended with Vietnamese, mixed-style, justified, rotated-page notes); results recorded per reader. E2E stays manual.

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Embedded subset fonts not shown correctly by some readers | SC-004 fails for that reader | M0 spike + kit; record per reader; outline fallback documented |
| R2 | App and file wrap differently | SC-009 fails | shared layout engine, same font files, kerning off; M0 measures |
| R3 | contenteditable composition/selection bugs with Vietnamese IMEs | core typing broken | model-authoritative editor, offset-mapping tested in SDK, early manual IME test (Telex, VNI) |
| R4 | Font licence or `fsType` blocks embedding | cannot ship a font | check each file in M0; replace the font |
| R5 | New dependency breaks the Electron Main bundle | build fails | prefer small in-repo parser/subsetter; if a package, test with `vite build` and mark `external` if needed |
| R6 | Selection pipeline for a text-bearing object collides with PDF text selection | regressions | gated by tool/mode as for Ink; regression checklist in quickstart |
| R7 | File size growth from repeated font subsets | larger PDFs | subset per update; measure in M0; acceptable limit documented |
| R8 | Complex scripts (RTL, Indic) | unsupported | explicitly out of scope; reported as unsupported characters |
| R9 | `HighlightStyleKind` exhaustive switches across the codebase miss the new kind | runtime holes | typecheck with exhaustive `never` checks; grep list in tasks |
