# PDF Freehand Ink, Pen Tools & Eraser — implementation plan

Status: **Phases 0–2 implemented (Phase 2: 2026-10-23), Phase 2 pending review. Phases 3–5 not started.** See "Implementation status" at the end of this file.
Scope: freehand Ink strokes, pen styles/settings, and an Ink-only Eraser on the PDF surface. Shapes, FreeText, stamps and
other PDF features are out of scope.

Paths are relative to `source/apps/` unless they start with `docs/`.

---

## 1. Current-state audit

### 1.1 Does any of it exist? — No, only a placeholder

| Question | Finding | Evidence |
|---|---|---|
| Freehand drawing | **Not built.** An empty stub with a TODO. | `reading-book-desktop/src/screens/Reader/logic/hooks/pdfAnnotationTools.ts:4-29` (`beginFreehandStroke(): PdfAnnotationRect[] { return [] }`; its header proposes "rects approximating a stroke or an SVG path in `NoteStyle`") |
| Pen styles / thickness / opacity UI | **Not built.** `NoteStyle` already has the open keys `colorHex`, `strokeWidth`, `opacity` but nothing writes them for PDF. | `book-reader-sdk/src/domain/annotation/note.ts:96-103` |
| Eraser | **Not built.** No eraser identifier anywhere in `source/**/*.{ts,tsx}`. | grep for `eraser`/`freehand`/`pointerType`/`stylus` |
| `freehand` note type | Exists in `NoteType` only as a legacy value. Highlight queries explicitly exclude it. | `note.ts:105-115`; `reading-book-desktop/electron/persistence/sqlite-overlay-store.ts:205-214` (`HIGHLIGHT_TYPE_PREDICATE` lists 7 types, no `freehand`) |
| Ink inside PDF files | Deliberately **ignored on import** and **preserved untouched** in the file. | `book-reader-sdk/src/app-models/pdf-embedded-annotations.ts:39` (`EMBEDDED_PDF_ANNOTATION_SUBTYPES = Highlight, Underline, Squiggly, StrikeOut, Text`); `readPdfJsAnnotation` returns `null` for any other subtype (`:177-180`); `docs/implementation_plan/pdf_annotation_reader_compatibility.md` §5 ("Ink … not imported, but are preserved in the file"); `book-reader-sdk/tests/app-models/pdf-embedded-annotations.test.ts:110,147` |

### 1.2 Installed versions

- `pdfjs-dist` **5.4.624** (`reading-book-desktop/package.json`; installed `node_modules/pdfjs-dist/package.json` agrees). Its worker contains `InkAnnotation` and `inkLists`, so a *foreign* Ink annotation can be read; we do not use pdf.js's own annotation editor layer.
- Electron **^39.8.10**, React **^18.2.0**, zustand **^5.0.15**, vitest **^3.2.7** (SDK only).
- No ink/stroke-smoothing dependency is present. **Plan adds none** (see §3.4).

### 1.3 Reusable architecture (this is the "smallest viable path")

| Piece | Where | Reuse |
|---|---|---|
| Per-page plane. Each page is a `relative` slot (`data-page-number`) sized `size × cssScale`; annotation layers are React children of the slot and paint in **percent of the slot**. Zoom, resize and canvas virtualization never move marks. | `src/reader/renderers/pdf/PdfRenderer.tsx:1331-1349`, `PdfAnnotationLayer.tsx:1-10, 28-40` | The ink layer is a sibling of `.rb-pdf-annot-layer`, same positioning model. An SVG with `viewBox="0 0 1 1" preserveAspectRatio="none"` gives zoom independence for free. |
| Normalized storage space: 0–1 against the displayed page box (viewport scale 1, `/Rotate` and crop box applied, top-left origin, y down). | `note.ts:38-51`; `PdfRenderer.tsx:552` (`page.getViewport`) | Same space for ink points. Rotation/crop already handled by one transform. |
| Row persistence. PDF markup = a `notes` row, `page-rect` locator + `note_json.pdfAnnotation`. Strict validator at the IPC boundary. | `book-reader-sdk/src/app-models/pdf-highlight.ts:181-210` (`parsePdfAnnotation`: ≤2000 rects, 512 KiB cap); `electron/ipc/overlay.ipc.ts:297-335` (`saveHighlight`, `validStyleKinds`) | New optional `pdfInk` payload beside `pdfAnnotation`, validated the same way. No new table. |
| Undo/redo. Session-only add/remove/replace history, 50 entries, per book. | `book-reader-sdk/src/annotations/history.ts:1-77`; used by `pdfHighlightsStore.ts:148,298,432,455-463` | Reuse as-is. Ink add/erase/split are expressed as add/remove/replace actions. |
| Store + optimistic persistence + rollback toast. | `src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts` (`createFromSelection`, `deleteHighlight`, `historyHandlers`) | Mirror in a new `pdfInkStore` (kept separate, like the PDF store is separate from the EPUB one — the header at `:135-141` states the reason). |
| Pointer plumbing. One root `onPointerDown/Move/Up/Cancel`, `isPrimary` guard, pointer capture for the hand tool, `gestureRef`. | `PdfRenderer.tsx:1165-1283, 1368-1378` | Add an `ink` branch before the pan/selection logic. |
| Tool model + toolbar. `InteractionTool` union, capability-gated toolbar (`hidden, never disabled`). | `book-reader-sdk/src/app-models/reader-session.ts:19-35`; `src/reader/capabilities.ts:7-59`; `src/screens/Reader/components/chrome/ToolsMenu.tsx` | New tools `pen`, `eraser`; new capability `inkAnnotations` on the `pdf` surface only. |
| Write path. Incremental update, original bytes untouched, read-back verified. | `electron/pdf-sync/pdf-incremental-writer.ts:215-383`; `pdf-annotation-write.ts:46-72, 74-108` (`verify`) | Add an `Ink` branch to the writer and the verifier. |
| Planner (Readmate rows ↔ file annotations, three-way merge). | `book-reader-sdk/src/app-models/pdf-annotation-export.ts:21-71, 162-245`; `pdf-annotation-two-way.ts` | Extend `PdfWriteSubtype` and `SUBTYPE_FOR_STYLE`. |
| Reader-compat evidence and spike harness. | `docs/implementation_plan/pdf_annotation_reader_compatibility.md`; `reading-book-desktop/spikes/pdf-annotations/` (`spike:pdf:*` scripts in `package.json:36-41`) | New spike `spike:pdf:ink`, same register-alias pattern. |

### 1.4 Facts that constrain the design

1. **The geometry type cannot hold a stroke.** `PdfAnnotation` is axis-aligned rects (`note.ts:58-68`); `parsePdfAnnotation` rejects anything else. The stub's idea of "rects approximating a stroke" would be lossy, would write wrong Highlight-style quads, and is rejected here.
2. **The writer is text-markup specific.** `quadsFor`, `appearanceContent` and `annotationDict` emit `/QuadPoints` + `/Rect`, and branch on `Highlight|Underline|Squiggly|StrikeOut|Text` (`pdf-incremental-writer.ts:66-122, 164-190`). Ink needs `/InkList` and a path appearance stream.
3. **Style kinds are a closed set** in three places that must change together: `HighlightStyleKind` (`highlight-location.ts:17`), `HIGHLIGHT_STYLE_KINDS` + the SQL predicate (`sqlite-overlay-store.ts:211-224`), and `validStyleKinds` in `overlay.ipc.ts:311`. Unknown `note.type` silently falls back to `'highlight'` (`:236-238`) — an Ink row read by an old build would be shown as a bogus highlight, so Ink must not reuse `HighlightStyleKind`/the highlight list (see §3.2).
4. **Embedded rendering is already suppressible.** `PdfRenderer.tsx:689-704` sets `annotationStorage.setValue(id, {noView:true})` so the file's own appearance is not drawn under the app's. Ink rows written back into the file will be drawn by pdf.js's canvas too (annotationMode `ENABLE_STORAGE`, `:567`), so a written stroke would be painted twice (SVG + canvas) unless handled (§5.4).
5. **Foreign annotations are safe today** because the scanner never returns them and the planner only removes what it scanned or what is named `readmate:*` (`pdf-annotation-export.ts:200-237`). This property must be preserved and extended, not weakened: the eraser and the planner must touch only `readmate:`-named Ink.
6. **No stylus/pressure code exists** (no `pointerType`/`pressure` use). `PointerEvent` in Electron 39 (Chromium) provides `pointerType`, `pressure`, `tiltX/Y`, `getCoalescedEvents()`, and the pen eraser button (`buttons & 32`) — available without dependencies.
7. **Undo is highlight-store scoped.** Cmd/Ctrl+Z is wired to the PDF highlight store (`useReaderPdfHighlights.ts:107-108`). Ink needs its own store's history, and the key handler must dispatch to whichever store last changed (§6).
8. **Background write is debounced and per-window** (`pdf-annotation-sync-service.ts`, 500 lines; write latency measured 0.46–2.7 s in the compat doc §3). A stroke must not trigger a write per pointer move — only on pointer-up (commit).

---

## 2. Product scope

### 2.1 MVP (milestones 1–3)

- Pen tool with **three styles**: *Pen* (opaque, round), *Marker/Highlighter* (translucent, wide, multiply), *Pencil* (see §3.1: rendered as a thin, slightly translucent stroke — a visual preset, **not** a texture).
- Color (reusing the highlight palette + custom), thickness (4 presets + slider), opacity (Marker/Pencil only; Pen fixed at 1).
- Active-tool state in the toolbar, last-used settings per style remembered across restarts.
- Select a stroke (click), delete (Delete key / menu), recolor/rethickness **of the selected stroke only**.
- **Eraser, stroke level**: a click/touch (or drag across) removes whole strokes it touches.
- Undo/Redo for draw, delete, erase.
- Persistence in SQLite, reload on reopen, correct at any zoom and page `/Rotate`.
- Mouse + pen/touch via Pointer Events.
- Write-back into the PDF as standard `/Ink` annotations (milestone 3), with reader interop checks.

### 2.2 Advanced (milestone 4+, behind its own approval)

- **Partial eraser** (split strokes into surviving segments).
- Pressure-sensitive width (variable width) — *display and storage*, not required for Ink interop.
- Brush: **not planned** (see §3.1). Pen-barrel eraser button and "stroke eraser vs. point eraser" toggle.
- Move/resize a stroke (explicitly deferred; Ink has no resize handles in MVP).

### 2.3 Non-goals

Shapes, FreeText, stamps, text recognition, ink-to-text, importing foreign Ink as editable rows (they stay untouched in the file, as today), eraser acting on anything that is not a Readmate-created Ink stroke.

---

## 3. Recommended architecture

### 3.1 Pen styles: visual and storage implications

Every style is **one** PDF subtype (`/Ink`) plus app-side style metadata. Styles are *presets over three numbers* (color, width, opacity) and a blend flag; they are not separate subtypes.

| Style | Look | How it is stored | PDF mapping | Interop honesty |
|---|---|---|---|---|
| **Pen** | Opaque, round caps/joins, constant width | `style: { colorHex, strokeWidth, opacity: 1 }`, `penStyle: 'pen'` | `/Ink`, `/InkList`, `/C`, `/BS /W`, `/CA 1`, appearance stream `w J=1 j=1 S` | Faithful in all readers |
| **Marker / Highlighter** | Wide, translucent, overlaps darken (multiply), square-ish caps | `penStyle: 'marker'`, opacity default 0.35, width default larger, `blend: 'multiply'` | `/Ink` + `/CA` (opacity) + appearance `/BM /Multiply` (as the writer already does for Highlight, `:243`) | Readers that ignore `/BM` in appearance streams show plain alpha (still legible). Acrobat has an Ink-based "Highlight" convention (`/IT /InkHighlight`); we will **not** set `/IT` in MVP — claim nothing we have not tested |
| **Pencil** | Thin, slightly translucent, round caps | `penStyle: 'pencil'`, opacity default 0.8, width default smaller | `/Ink` with `/CA 0.8` | **No grain texture.** A pencil texture cannot be represented faithfully in a standard Ink annotation; faking it in the app SVG only would make the app and every other reader disagree. So Pencil = a thin, soft preset. Labeled honestly in UI tooltips ("Pencil (thin, soft)") |
| **Brush** (calligraphic, pressure → width, tapered ends) | Variable-width filled outline | would need a *filled polygon* appearance or many segments | An `/Ink` annotation is a constant-width stroked polyline (`/BS /W`). A variable-width stroke is a polygon the other reader cannot re-edit and which no longer matches `/InkList` | **Deferred.** Only revisit in the Advanced phase, as "pressure width written as a filled-polygon appearance with `/InkList` as the centerline"; the centerline remains the source of truth. Not in MVP |

Rule: **`/InkList` is the source of truth that other readers see; the appearance stream is a rendering of it.** Anything the app displays that `/InkList` + `/BS` + `/C` + `/CA` cannot express must not be sold as interoperable.

Why not a separate subtype per style? `/Highlight` is a text-markup subtype tied to `/QuadPoints` over text; a "marker" drawn freehand has no text quads. Using `Highlight` for marker strokes would make Acrobat/Foxit treat it as text markup and misrender/lose it. Ink is the correct carrier.

### 3.2 Data model

New, additive, no migration needed (all inside `notes.note_json`, which "never requires a schema migration" per `note.ts:134-137`):

```ts
// book-reader-sdk/src/domain/annotation/note.ts  (planned)
export type InkPenStyle = 'pen' | 'marker' | 'pencil'

export interface PdfInkStroke {
  /** 0-based page. A stroke never spans pages. */
  pageIndex: number
  /** One or more polylines (an InkList can hold several; a split stroke becomes several rows or several lists — see §7). Normalized 0–1 in the displayed page box. */
  paths: Array<Array<[number, number]>>   // [x, y], rounded to 5 decimals like `normalizePdfHighlightRects`
  penStyle: InkPenStyle
  /** Stroke width as a fraction of the page WIDTH (zoom-independent). Conversion to PDF user-space points happens in the writer only. */
  width: number
}
// INoteState gets: pdfInk?: PdfInkStroke ; NoteType gets 'ink' (new value; 'freehand' stays legacy/unused)
// color/opacity live in the existing `style.colorHex` / `style.opacity` (note.ts:96-103).
```

Decisions:

- **New `NoteType` value `'ink'`**, *not* `HighlightStyleKind`. `HighlightStyleKind`/`HIGHLIGHT_TYPE_PREDICATE` feed the highlights sidebar, tag filter, exports and the planner's highlight logic. Ink rows are queried by their own predicate (`type = 'ink'`) via a new `listInk(bookId)` store method and new channels `overlay:listInk / saveInk / deleteInk`. This avoids the silent "unknown type → highlight" fallback (`sqlite-overlay-store.ts:236-238`) and keeps the Notes sidebar free of strokes unless we decide otherwise (open question Q3).
- **Width as a fraction of page width** keeps thickness stable across zoom, matches how rects are normalized, and maps to PDF points via `width * pageWidthInUserUnits` in the writer. Pages of different size therefore scale ink thickness with the page, which is the same as every other normalized quantity here; pressing "same visual thickness on every page" is a UI preset concern, not a storage one.
- **Points are not simplified in storage beyond capture-time decimation** (§3.4) and rounded to 5 decimals. Limits (validated in Main, like `PDF_ANNOTATION_MAX_RECTS`): ≤ 5 000 points per stroke, ≤ 64 paths, serialized ≤ 256 KiB, every point finite and inside `[0,1]` (±1e-6).
- **Rows are immutable per appearance.** Changing the tool's current color/width/style never touches stored rows; only an explicit edit of a *selected* stroke replaces that one row (replace history entry). This satisfies "changing tool settings must not retroactively alter existing strokes" by construction: settings live in the tool store; a stroke copies them at pointer-down.
- **Identity in the file**: `/NM = readmate:<noteId>` (same as today, `pdf-annotation-export.ts:52,91`). A stroke is single-page so there is no `:p<n>` suffix.
- Locator: a `page-rect` at the stroke's bounding box (so jump/sidebar code could reuse `pdfAnnotationLocation`-style logic); validated by an `isConsistentPdfInk` mirroring `isConsistentPdfHighlight` (`pdf-highlight.ts:247`).

### 3.3 Rendering

- New `PdfInkLayer` (sibling of `PdfPageAnnotations`) per page slot: one `<svg viewBox="0 0 1 1" preserveAspectRatio="none">` with a `<path>` per stroke (`vector-effect: non-scaling-stroke` is *not* used; stroke width is in normalized units so it scales with the page, matching the stored `width`). `pointer-events: none`; hit-testing is done by the renderer (as `annotationAt` does today), so text selection under strokes keeps working in non-ink tools.
- Live stroke: a separate overlay `<svg>`/`<canvas>` on the page under the pointer, updated in `requestAnimationFrame`, committed to a normal React-rendered path on pointer-up. Strokes of other pages are not re-rendered while drawing.
- **Non-uniform scaling caveat**: the slot is `floor(w*cssScale) × floor(h*cssScale)`; `preserveAspectRatio="none"` plus a width stored as a fraction of page *width* gives a very slightly non-round stroke from rounding only; acceptable (<1 px). If visible, the path is drawn in a `0 0 W H` viewBox with `H = 1/aspect` instead — note it in Phase 1 acceptance.
- Performance: paths are memoized per stroke id; layers render only for pages that have strokes (as `marksByPage.has(...)` does at `PdfRenderer.tsx:1342`); stroke `d` strings are computed once per stroke. See §9.

### 3.4 Capture

- Pointer Events on the existing root handler. In ink mode: `pointerdown` (primary, button 0, or pen) → `setPointerCapture`, `preventDefault`, start a stroke on the page slot under the pointer; `pointermove` appends from `event.getCoalescedEvents()` when available (full stylus sample rate); `pointerup` commits; `pointercancel`/`lostpointercapture`/window blur discards or commits (decision: **commit what exists** if ≥ 2 points, matching how the existing blur handler ends gestures, `PdfRenderer.tsx:1156-1163`).
- A stroke belongs to the page where it **started**; points outside that page are clamped to its box (clamping at the page edge is acceptable and simple; strokes are never split across pages).
- Coordinates: `(clientX - slotRect.left) / slotRect.width`, `(clientY - slotRect.top)/slotRect.height` using the slot's `getBoundingClientRect()` → already includes zoom (CSS scale) and scroll. Because storage is the *displayed* page box, `/Rotate` needs no extra handling in the renderer; it matters only in the writer (via `page.transform`, already inverted in `inverse()`, `:57-62`).
- Smoothing/decimation: drop points closer than ~0.15 px at current scale (min-distance filter) then Ramer–Douglas–Peucker (ε ≈ 0.3 px at capture zoom, converted to normalized) on pointer-up; render with a quadratic mid-point curve in the SVG path. ~40 lines of own code; no dependency.
- Touch: set `touch-action: none` on the page root **only while the pen tool is active** (otherwise scrolling by touch breaks); multi-touch while drawing is ignored by the existing `isPrimary` guard (`:1166`).
- Pen input: `pointerType === 'pen'` is accepted without a hold-to-draw dwell. Palm rejection: when a pen has been seen in the last 1.5 s, ignore `pointerType === 'touch'` draws (Advanced). **Stylus support is "where Chromium/Windows ink provides Pointer Events"; hardware behavior (Surface Pen, Wacom) is unverified until tested (§10 manual list).**

### 3.5 Tool picker and UI

- Two new tools in `InteractionTool`: `'pen'` and `'eraser'`; capability `inkAnnotations` added to `SURFACE_CAPABILITIES.pdf` only (`capabilities.ts:59`). Hidden — not disabled — on EPUB/TXT/MD, per the file's own contract.
- Toolbar: one **Pen** button (popover: Pen / Pencil / Marker, color swatches reusing the highlight palette, thickness slider with live preview dot, opacity slider for Marker/Pencil) and one **Eraser** button. Active tool = same pressed-state styling as highlight/underline tools; tool is sticky until toggled off, another tool is chosen, or Escape (existing contract at `reader-session.ts:13-17`).
- Cursor: a CSS cursor sized to the pen width is overkill; use a crosshair for pen and a ring (SVG data-URL via `cursors.ts` approach) for the eraser sized to the eraser radius.
- Settings persistence: **renderer localStorage**, per the app's rule for application-level preferences (`CLAUDE.md` "App preferences"): key `readmate.pdfInkPrefs.v1`, a zustand store with `DEFAULT_PDF_INK_PREFS` and `reset()`, and one line added to `APP_SETTINGS_RESETTERS` so "Reset App Settings" clears it (`screens/Settings/logic/resetAppSettings.ts`). Stored: last tool style; per style: `colorHex`, `width`, `opacity`; eraser radius/mode. Defaults: Pen #1E88E5, 2 px-equiv; Marker #FFEB3B, 14 px-equiv, 0.35; Pencil #424242, 1.5 px-equiv, 0.8. (Pixel-equivalents are shown in UI; stored as page-width fractions at a 612 pt reference page.)
- Following the project rule (`memory: prefer-zustand-for-custom-hooks`), logic lives in zustand stores, with the React hook only an adapter, as `useReaderPdfHighlights.ts` does.

### 3.6 Selection and edit

- Click with the **Select/Hand/Pen-off** tools on a stroke selects it (hit test = distance from the click to any segment ≤ `max(width/2, 6px)`, evaluated per page against the stroke's cached bounding box first). Selected stroke shows an outline and a small floating menu (color, width, delete) positioned like the existing annotation menu (`openHighlight` → `activeHighlight.rect`). Editing = `replace` history entry with a new row snapshot (`updatedAt` bumped).
- While the **Pen** tool is active, clicks draw (no selection) — avoids accidental drags.
- No move/resize in MVP.

---

## 4. Eraser

**Eraser targets only Readmate-created Ink rows.** Enforced structurally, not by convention:

- The eraser's candidate set is `pdfInkStore.strokes` — rows of `type: 'ink'` loaded from SQLite. PDF text, page content, highlights, sticky notes and foreign annotations are *not in that set* and therefore cannot be hit or deleted. There is no code path from the eraser to `pdfHighlightsStore`, to the canvas, or to the file's other annotations.
- Writer-side double guard: removals are generated only for objects whose `/NM` starts with `readmate:` **and** whose row exists as ink (`noteIdFromReadmateName`, `pdf-annotation-export.ts:96-101`, plus a subtype check `Ink`). A foreign `/Ink` (e.g. drawn in Acrobat) is never scanned nor removed.
- **No white-painting.** Erasing deletes data (row, then the PDF annotation on the next write) or rewrites the path; it never overlays anything.

### 4.1 MVP — stroke eraser

- Pointer down on the page under eraser tool starts an "erase gesture"; every pointer move tests the segment `[prev, current]` swept by a circle of radius `r` (default 10 px, setting 6–30) against strokes of that page: stroke id is a hit if any segment of its polyline passes within `r + width/2` (bounding-box prefilter first). Hits are highlighted (opacity 0.4) during the gesture; on pointer up, **all hit strokes are deleted in one history entry** (`remove` actions grouped; see §6 for the group extension). A plain click erases the single topmost stroke at that point.
- Cancel (Escape / pointercancel) un-highlights and deletes nothing.
- Acceptance: erasing never changes `highlights`, `notes` of other types, or any non-ink annotation (test-enforced, §10).

### 4.2 Advanced — partial eraser

Algorithm (pure functions in the SDK, e.g. `src/ink/erase.ts`):

1. For each candidate stroke, take the eraser's swept path (polyline of eraser centers) and radius `r_e` (the stroke's own `width/2` is added to `r_e`).
2. Walk each stroke polyline; for each segment compute entry/exit parameters `t` against the capsule around the eraser path (segment–capsule intersection). Split segments at those `t` values; classify sub-segments as *inside* (dropped) or *outside* (kept).
3. Consecutive kept points form surviving sub-polylines; discard pieces with < 2 points or total length < `width`.
4. Result per stroke: 0 pieces → delete row; 1 piece → `replace` row (same id, new `paths`); ≥ 2 pieces → `replace` the original with piece 1 and `add` new rows (new ids) for the others (so every row remains one annotation = one `/NM`; an `/InkList` may hold several lists but we keep one-row-one-annotation to preserve identity mapping).
5. Round to 5 decimals; re-validate with the same parser.

All resulting add/replace/remove actions of one eraser gesture are one grouped undo step (§6). Edge cases to test: stroke fully inside eraser, eraser tangent to a segment, eraser crossing a self-intersecting stroke, zero-length segments, 2-point strokes, eraser starting outside the page.

---

## 5. Persistence, sync and PDF export / interoperability

### 5.1 Flow

`pointerup` → store applies optimistic row + history entry → `overlayApi.saveInk` (new channel, validated in Main with `parsePdfInk`) → `SqliteOverlayStore` upsert → existing per-window sync coordinator picks the pending row up and writes it into the book's file under the **existing** eligibility gate (`pdf-write-eligibility.ts`: user-owned, writable, not encrypted, not signed unless confirmed, unchanged since read). A file that fails the gate keeps the data pending in SQLite exactly as text annotations do — no new policy.

### 5.2 Writer changes (`pdf-incremental-writer.ts`)

- Add `'Ink'` to `PdfWriteSubtype` (`pdf-annotation-export.ts:21`) and a sibling type `PdfWriteInk` (points instead of rects) rather than widening `PdfWriteAnnotation`, to keep the text-markup path unchanged.
- Annotation dictionary: `/Type /Annot /Subtype /Ink /Rect [bbox + width/2] /InkList [[x1 y1 x2 y2 …]] /C [r g b] /CA <opacity> /BS << /W <pts> /S /S >> /F 4 /NM (readmate:<id>) /T (Readmate) /M /CreationDate /P <page> /AP << /N <ref> >>`. Points converted via the existing `inverse(page.transform)` (`:57-62`) so `/Rotate`, crop box and non-origin boxes work as for quads.
- Appearance stream: `BBox = Rect`, `ExtGState << /CA /ca [/BM /Multiply for marker] >>`, `<r g b> RG <w> w 1 J 1 j` + `m/l/S` polylines (straight segments from the decimated points; curve smoothing is an in-app display nicety only unless proven to round-trip). `Length` computed by `streamObject` (`:126-128`).
- **Replace** keeps the object number (existing mechanism `:259-272`); **remove** drops it from `/Annots` and its popup (existing `:302-321`). No change.

### 5.3 Planner/scan/verify changes

- `planPdfAnnotationWrite`: ink rows come from a separate `inkRows` input; only `readmate:` Ink items in the scan are candidates for replace/remove; ledger/`kept` logic is **not** used for ink (nothing is imported from foreign Ink in MVP, so there is no "file's own version stays" case).
- Scanner (`pdf-annotation-scan.ts`) must return Ink items **only for the purpose of identity and verification of Readmate-named annotations**; `parseScannedPdfAnnotation` must keep rejecting foreign Ink for the *import* path. Concretely: a second read function `readReadmateInk(raw)` accepts `subtype === 'Ink'` AND `/NM` startsWith `readmate:`. Foreign Ink remains invisible to the import pipeline (current behavior, tested at `pdf-embedded-annotations.test.ts:110,147` — those tests stay green).
- `verify()` (`pdf-annotation-write.ts:46-72`) gains an ink check: exactly one found per `/NM`, subtype `Ink`, same page, ink point count equal, first/last point within 0.01 normalized, color within ±1/255 (existing `sameColor`), and "nothing else disappeared" already protects foreign annotations.

### 5.4 Double painting and the "hidden" mechanism

Once a stroke is in the file, pdf.js's canvas draws its appearance stream too, so it would appear twice (canvas + SVG) — slightly shifted by antialiasing, and doubled opacity for translucent styles. Mitigation reuses the existing mechanism: after a scan reports the object id of a Readmate ink, add it to `hiddenEmbeddedObjectIds` → `annotationStorage.setValue(id, {noView:true})` (`PdfRenderer.tsx:689-704`). Because the ids only exist after the first write, the SVG layer remains the display of record; the canvas copy is hidden as soon as its id is known. Phase 3 acceptance includes a pixel check that opacity is not doubled.

### 5.5 Interoperability risks (what is *not* promised)

- Exactly like text markup (`pdf_annotation_reader_compatibility.md` §2): the only engine verified automatically will be pdf.js read-back and PDFium-rendered captures; **Foxit, Acrobat, SumatraPDF stay "Not tested" until a person runs the kit** (extend `build-compat-kit.mjs` with ink fixtures: pen/marker/pencil, rotated page, page with crop box, multi-stroke). The plan must not state those readers work.
- Readers differ on whether they regenerate the appearance from `/InkList` (editing the stroke elsewhere may change its look to their default) or use `/AP`. Setting both consistently minimizes surprises.
- Opacity/blend: `/CA` is widely honored; `/BM Multiply` in an appearance ExtGState is less certain → marker must remain legible without it.
- A reader that holds an older copy and saves later can drop Readmate's ink; the existing "external change" rules apply (deletion of untouched rows, conflicts for edited ones). **Conflict rows for ink** are not in MVP: since foreign edits of Readmate ink are not imported, an external edit of a `readmate:` Ink leads to Readmate's next replace overwriting it. This is a known limit to document, or Phase 5 (optional): import `readmate:` Ink changes via `/InkList` comparison. Decision requested (Q4).
- Signed PDFs: unchanged gate — writing asks first, and Readmate never claims a signature remains valid.
- Encrypted/unsupported-trailer PDFs: strokes live in SQLite only; user sees the existing toast statuses (`applyEmbeddedSync` switch).
- `managed_copy` books (URL/cloud downloads) never receive writes: ink stays in Readmate by design, consistent with text annotations.
- Page `/Rotate` and crop box: covered by the same transform path as quads; **must** be verified with `/Rotate 90`, `/Rotate 180` + crop box fixtures (the compat kit already has these for text markup).
- Export-to-new-file (`overlay:exportAnnotatedPdf`) shares the planner, so ink is included automatically once §5.3 is done, with the same pdf.js read-back.

---

## 6. Undo / Redo

- Reuse `createUndoHistory` (`annotations/history.ts`) in `pdfInkStore`, separate stack from the highlights store (they are different entity types; a shared stack would need a union type and would couple the stores). Limit 50 entries, session-only, cleared on book change (`resetForNewBook`), identical to today.
- **Add one new action kind: `batch`** (`{ kind:'batch', actions: HistoryAction<T>[] }`) to `history.ts` + `applyHistoryStep` (undo applies inverses in reverse order; redo in order). Needed so one eraser sweep that deletes 5 strokes — or one partial erase that replaces 1 and adds 2 — is **one** undo step. This is a small, additive, unit-testable SDK change; existing kinds are untouched.
- Entries: draw = `add`; select-delete = `remove`; stroke-eraser = `batch[remove…]`; partial-erase = `batch[replace, add…]`; edit selected stroke = `replace`.
- Persisting undo: every restore/remove also persists (as `historyHandlers` does, `pdfHighlightsStore.ts:537-551`), so reopening shows the reverted state and the next write-back removes/restores the PDF annotation accordingly.
- Keyboard routing: Ctrl/Cmd+Z / Shift+Ctrl+Z currently call the highlight store. Define a tiny coordinator: the **most recently mutated** store (ink vs highlights) receives undo; track with a `lastMutation` stamp set by each store's `push`. A UI "undo/redo" pair in the toolbar mirrors it. Edge case test: draw → highlight → undo undoes the highlight, undo again undoes the stroke.
- Undo of a stroke whose PDF write already happened: the restore path persists the row; the next sync plans `remove`/`add` against the file; verified by the existing read-back.

---

## 7. Lifecycle matrix

| Lifecycle step | Behavior | Verified by |
|---|---|---|
| Create | pointer-down→up, one row per stroke, optimistic, rollback toast on failed save (as `createFromSelection`) | store test with fake bridge |
| Select | click on stroke with non-ink tool; outline + menu | store + hit-test unit tests |
| Edit (color/width/style) | `replace` of selected row only | store test; "tool settings change leaves rows byte-identical" test |
| Delete | Delete key / menu / eraser → `remove`; failure restores (as `deleteHighlight`) | store test |
| Page change / scroll | strokes are children of the page slot; independent of canvas virtualization | manual + DOM test |
| Close book / restart | rows in SQLite; `loadInk(bookId)` on open | spike with real SQLite |
| Zoom | normalized coordinates and percent layout; width as page-width fraction | geometry unit test at 3 zoom levels |
| Rotation `/Rotate` & crop box | displayed-page box is the storage space; writer uses `page.transform` | writer round-trip fixtures |
| Page sizes differ | per-page normalization; width converted with that page's width | writer test with mixed-size fixture |
| External reader | standard `/Ink` + `/AP`; matrix in §5.5 | spike + manual kit |
| Large stroke counts | §9 | perf budget tests |

---

## 8. Compatibility & risks to existing PDF annotation workflows

| Risk | Impact | Mitigation |
|---|---|---|
| Ink rows accidentally enter text-annotation queries/UI | Ghost highlights, wrong exports | Separate `type='ink'`, separate predicate, separate IPC; test that `listHighlights` never returns ink rows |
| Widening `HighlightStyleKind` | Silent fallback to `'highlight'` for unknown types in old builds; planner breaks | Don't widen; new type |
| Planner removes foreign Ink or other annotations | User data loss in their file | Ink candidates require `readmate:` NM + subtype Ink; `verify()` "nothing disappeared" check; test with a fixture containing foreign Ink, FreeText, Link and a Stamp |
| Scan change leaks foreign Ink into import | Foreign Ink turned into rows, then rewritten | Separate `readReadmateInk`; existing import tests must stay green |
| Per-move writes | File thrash, sync loops | Write only on commit; sync debounce unchanged; reuse `StableFileWatcher` self-write suppression (verify during Phase 3) |
| Double painting after write | Visible doubled opacity | `noView` hiding (§5.4) + pixel test |
| Pointer handling conflicts with Hand/selection logic in `PdfRenderer.tsx` (1394 lines, shared gesture state) | Broken pan/selection/page-turn taps | Ink branch is exclusive (returns before pan/selection), covered by manual checklist; keep new logic in a separate module (`pdfInkGesture.ts`) with a thin hook-in |
| Touch scrolling disabled | Users can't scroll on touch screens in pen mode | `touch-action:none` only while pen/eraser active; toolbar clearly shows the tool is on |
| `books.sha256` kept in step with the file after writes | Wrong relink/dup detection | Reuse existing post-write path unchanged |
| Large payloads over IPC | Slow/rejected saves | Caps in §3.2, decimation at capture |
| Undo shortcut collision with highlights | Wrong item undone | Last-mutation routing (§6) + test |

---

## 9. Performance

- Capture: coalesced events batched per animation frame; min-distance filter; live path built incrementally (append to a typed array, one `d` string update per frame).
- Render: only pages containing strokes mount an ink SVG; each stroke's `d` is memoized by `(id, updatedAt)`; selection/erase highlight toggles a data attribute, not a re-render of all paths. If a page holds > ~500 strokes, rasterize non-selected strokes into a cached `<canvas>` per page (Advanced trigger, measured first).
- Hit-testing: per-stroke bounding boxes, optional grid index per page when strokes > 200. Eraser tests only the page under the pointer.
- Budgets to assert in a node perf test (SDK, not E2E): decimate 5 000 raw points < 5 ms; hit-test 1 000 strokes × 100 points < 8 ms per move; partial-erase one sweep over 100 strokes < 30 ms. Numbers are initial targets to confirm on a baseline run, not claims.
- Persistence: one IPC save per stroke on pointer-up; eraser batch → one `deleteInk` call with ids (batch channel) to avoid N round-trips and N sync wakeups.

---

## 10. Tests

### 10.1 Unit (SDK, vitest, `tests/**/*.test.ts` mirroring `src/`) — run with `npm test` in `book-reader-sdk`

- `tests/ink/parse-pdf-ink.test.ts`: `parsePdfInk` accepts valid; rejects NaN/Infinity, out-of-box points (beyond epsilon), > 5 000 points, > 64 paths, 1-point paths, negative/zero width, unknown `penStyle`, oversize payload.
- `tests/ink/ink-geometry.test.ts`: normalize client→page coords at zooms 0.5/1/2 (same stored points); width fraction→points on pages of different size; rotation via transform inverse (90/180/270) with a fixture matrix.
- `tests/ink/decimate-smooth.test.ts`: min-distance filter, RDP keeps endpoints, idempotence, stays within tolerance.
- `tests/ink/hit-test.test.ts`: point near/far; stroke width included; bounding-box prefilter; topmost wins.
- `tests/ink/erase.test.ts`: stroke eraser hit set; **partial eraser**: middle cut → 2 pieces; end trim → 1 piece; full cover → 0; tangent; self-intersection; tiny remnants dropped; ids preserved on first piece.
- `tests/annotations/history.test.ts` (extend): `batch` undo/redo order and `canUndo/canRedo`, push clears redo, limit.
- `tests/app-models/pdf-annotation-export.test.ts` (extend): ink rows plan `add/replace/remove`; only `readmate:` Ink is touched; foreign `Ink`, `FreeText`, `Link` scanned items are never in `remove`.
- `tests/app-models/pdf-embedded-annotations.test.ts` (existing at `:110,147`): must stay green unchanged — regression guard for import behavior.
- `tests/persistence`: ink row JSON round-trip; unknown `note.type='ink'` is not returned by highlight list predicates (mirror at the SQL level in the spike).
- `tests/integration/reader-flow.test.ts`: update if the public API gains ink exports, per `CLAUDE.md`.

### 10.2 Integration spikes (standalone node scripts; not E2E; no window)

- `spike:pdf:ink` (new, same register-alias pattern as `spike:pdf:export`): generate fixtures (plain, `/Rotate 90`, `/Rotate 180` + crop box, mixed page sizes, a page with existing foreign Ink + FreeText + highlight); write ink via `writeAnnotationsToPdf`; read back with pdf.js; assert subtype/page/`/InkList` points/color/width/opacity within tolerance, original bytes are a strict prefix of the output (incremental update), foreign annotations still present; erase (remove) then write again and assert only the `readmate:` object left `/Annots`; undo (re-add) round trip.
- Renderer-store spike (like `spike:txt:store`): the real `pdfInkStore` against a fake overlay bridge: create/undo/redo/erase/partial-erase/failed-save rollback; "settings change doesn't mutate rows".
- SQLite spike on the real migrated schema: save/list/delete ink, restart persistence, not visible via highlight queries.
- Extend `spike:pdf:compat-kit` with ink fixtures for the manual reader checks.

### 10.3 Checks that already gate every change (from `CLAUDE.md`)

`book-reader-sdk`: `npm run typecheck`, `typecheck:tests`, `npm test`, `npm run build`. `reading-book-desktop`: `npm run typecheck`, `npm run lint`, `npx vite build`, `npm run e2e:typecheck` (compile only).

### 10.4 Safe manual verification (no E2E run)

E2E is **not** run (it is manual-only per `CLAUDE.md` and must not take focus). Manual checklist for a person running `npm run dev`:

1. Draw each style on a text page; zoom 50 % → 300 %; strokes stay on the same page spot and keep proportional thickness.
2. Switch tools/colors: older strokes do not change. Close and reopen the book, restart the app: strokes identical.
3. Rotated page (`/Rotate 90`, `/Rotate 180` fixtures from the kit): the stroke appears at the same visual spot after write-back and in another viewer.
4. Eraser: crossing two strokes removes only strokes; highlights, sticky notes, PDF text and a foreign Ink drawn in another reader remain.
5. Undo/redo sequences: draw, erase-sweep, highlight, undo ×3, redo ×3.
6. Open the saved file in Edge/Chromium, then Foxit/Acrobat if available; record results in the compat doc as *Verified/Not tested* — never assumed.
7. Mouse, touch screen, and pen (if hardware exists): pressure/tilt ignored in MVP; touch-scroll works when the pen tool is off.
8. Read-only file, encrypted PDF, signed PDF, URL-imported (managed) PDF: strokes remain in Readmate with the same toasts as text annotations.

---

## 11. Ordered implementation phases

Each phase ends green on §10.3 and is independently shippable.

**Phase 0 — Contracts (no UI).**
SDK: `PdfInkStroke`, `NoteType 'ink'`, `parsePdfInk`/`packPdfInk`, geometry (client↔normalized, width conversion), decimation, `HistoryAction 'batch'`. Tests §10.1.
*Accept:* all new unit tests pass; existing SDK tests unchanged and green; no desktop change.

**Phase 1 — Draw, render, persist (Pen only, mouse + pointer).**
Main: `overlay:saveInk/listInk/deleteInk` (validated), `SqliteOverlayStore` ink methods (type predicate separate from highlights). Renderer: `pdfInkStore`, `PdfInkLayer`, ink branch in `PdfRenderer` pointer handlers (isolated in `pdfInkGesture.ts`), `pen` tool + `inkAnnotations` capability, minimal toolbar button, color/width, localStorage prefs + reset hook, undo/redo for draw, Delete selected.
*Accept:* draw/reload/restart/zoom/rotate manual checks 1–2; hit-test/selection works; text selection and hand pan unaffected in other tools; `listHighlights` never returns strokes; store + SQLite spikes pass.

**Phase 2 — Styles & settings polish.**
Marker and Pencil presets, opacity, thickness slider, per-style remembered settings, edit-selected-stroke (replace history), cursor feedback, tool popover with clear active state.
*Accept:* tool settings changes leave existing rows byte-identical (test); remembered settings survive restart; Reset App Settings clears them; visual check of multiply overlap for marker.

**Phase 3 — Eraser (stroke level, MVP).**
`eraser` tool, sweep hit-test, grouped delete (`batch`), batch delete IPC, hover highlight, Escape cancel, undo/redo.
*Accept:* erase test matrix (§10.1) green; manual check 4 (nothing but ink removed); one undo step restores a whole sweep.

**Phase 4 — Write-back & export.**
`Ink` in writer/planner/scan(verify)/`verify()`, `noView` hiding of written ink, export path, `spike:pdf:ink`, extend compat kit, update the compat doc status table only with what was actually run.
*Accept:* spike passes on all fixtures (rotation, crop box, mixed sizes, foreign annotations preserved, original bytes prefix); no double painting (pixel check); read-only/encrypted/signed/managed statuses behave as for text annotations; PDFium capture reviewed; Foxit/Acrobat marked *Not tested* unless a person tests.

**Phase 5 (Advanced, separate approval).**
Partial eraser (algorithm §4.2), pen-eraser button & palm rejection, pressure width (display + optional filled-polygon appearance), raster cache for >500 strokes, optional import of external edits of `readmate:` Ink (conflicts).
*Accept:* partial-erase unit matrix, perf budgets measured, interop re-run.

Dependencies: 0 → 1 → 2 and 3 (parallel after 1) → 4 → 5.

---

## 12. Open questions for the owner

- **Q1** Pencil = thin/soft preset (honest) vs. simulated texture (not interoperable). Recommendation: preset only.
- **Q2** Ink width defaults and whether thickness is also exposed in px or only as presets (S/M/L/XL + slider).
- **Q3** Should strokes appear in the Notes/Highlights sidebar? Recommendation: **no** in MVP (high volume, no text); show a per-page count in the PDF page layout panel later if wanted.
- **Q4** External edits of a Readmate-written Ink in another reader: ignore (Readmate overwrites on its next change) or import with conflict handling (Phase 5)?
- **Q5** Marker via `/IT /InkHighlight` for Acrobat's "highlight pen" semantics — only after real Acrobat testing.
- **Q6** Stylus hardware available to test (Surface/Wacom)? Pressure and palm rejection depend on it.

---

## 13. Recommended first milestone

**Milestone 1 = Phase 0 + the Phase 1 slice "Pen only, persist, no write-back, no eraser".**

Concretely: SDK contracts + tests, Main ink IPC + SQLite methods behind a separate `type='ink'` predicate, `pdfInkStore` with undo/redo, `PdfInkLayer`, the pointer branch in `PdfRenderer`, one Pen button, color + width with remembered settings. Strokes are saved in SQLite only (the writer is untouched), so **no user file is modified** in this milestone and the highest-risk part (PDF write-back) is deferred until the data model has proven itself.

Why this first: it validates the riskiest UX assumptions (coordinate fidelity across zoom/rotation, pointer coexistence with Hand/Select, rendering cost) and the data model with the smallest blast radius on the existing annotation pipeline — nothing in the planner, scanner or writer changes. Exit criteria: §11 Phase 0 and Phase 1 acceptance, plus `listHighlights`/export/import tests proving existing workflows are unchanged.

**Implementation of Phase 0 + Phase 1 was approved with the recommended answers to Q1–Q4 (Pencil = preset only; strokes not in the Notes sidebar; external edits of Readmate ink ignored; widths as presets). Later phases wait for a separate approval.**

---

## 14. Implementation status (Phase 0 + Phase 1)

**Persistence: SQLite only.** Strokes live in the app database (`notes` rows, `type: 'ink'`). **Nothing is written into the PDF file and no PDF interoperability exists yet** — another reader will not show these strokes. That is Phase 4. The Ink IPC handlers deliberately never call `pdfAnnotationSync().notifyAppChange`, so drawing cannot wake the PDF write-back.

### Done

| Phase | Item | Where |
|---|---|---|
| 0 | `PdfInkStroke`, `InkPenStyle`, `NoteType 'ink'`, `INoteState.pdfInk` | `book-reader-sdk/src/domain/annotation/note.ts` |
| 0 | Strict `parsePdfInk(/Ref)`, caps (5 000 points, 64 paths, 256 KiB, width 0.0005–0.1), locator, bounds | `book-reader-sdk/src/ink/pdf-ink.ts` |
| 0 | client→page coordinates, min-distance filter, RDP, SVG path data, hit test | `book-reader-sdk/src/ink/ink-geometry.ts` |
| 0 | `batch` history action (one undo step for several actions) | `book-reader-sdk/src/annotations/history.ts` |
| 1 | `overlay:listInk/saveInk/deleteInk` (channels, DTOs, preload, bridge, validated handlers) | `electron/ipc/*`, `electron/preload.ts`, `src/bridge/overlay.ts` |
| 1 | `SqliteOverlayStore.listInk/saveInk/deleteInk` with its own `INK_TYPE_PREDICATE` (never part of the highlight predicate; an ink save cannot convert another row or touch another book) | `electron/persistence/sqlite-overlay-store.ts` |
| 1 | `pdfInkStore` (optimistic save + rollback, undo/redo, per-book reset), `pdfInkPrefsStore` (`readmate.pdfInkPrefs.v1`, wired into Reset App Settings), shared Ctrl+Z `pdfUndoRouter`, `useReaderPdfInk` | `src/screens/Reader/logic/` |
| 1 | `PdfInkLayer` (per-page SVG), pen pointer capture with coalesced events in `PdfRenderer`, click-to-select, Pen toolbar button (`inkAnnotations` capability, PDF only), colour/thickness panel, Delete key | `src/reader/renderers/pdf/`, `src/screens/Reader/` |

Not done on purpose: Pencil / Marker / Brush UI, eraser, edit of a selected stroke (Phase 2), PDF write-back / export / scan changes (Phase 4).

### Deviations from the plan (smallest safe adjustment)

1. **SVG viewBox is `0 0 1 heightRatio`, not `0 0 1 1`.** With a square viewBox stretched over a non-square page (`preserveAspectRatio="none"`) a round pen turns elliptical. Using page-width units on both axes (as the stored `width` already is) keeps it round. All distances (decimation, hit test) use the same units.
2. **Undo routing is an order log, not "last mutation" stamps.** Stamps could not order three interleaved edits correctly (ink, highlight, ink); `pdfUndoRouter` records which store made each edit and replays/undoes in that order.
3. **Selection halo and "Delete stroke" button** were added to the panel so a selected stroke can be removed without the keyboard; editing a selected stroke stays in Phase 2.
4. Pen colours are a fixed set of five (`PDF_INK_COLORS`) rather than the highlight palette (those are pastel highlighter colours, poor for a pen).

### Checks that ran (all passing unless noted)

SDK: `npm run verify` — typecheck, test typecheck, **455 tests (30 files)**, build. New: `tests/ink/pdf-ink.test.ts` (7), `tests/ink/ink-geometry.test.ts` (8), `tests/annotations/history.test.ts` (3).
Desktop: `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck`, `npx vite build`.
Spikes (node only, no window): new `spike:pdf:ink` (12 checks: IPC + SQLite, isolation from highlights/bookmarks, restart, corruption) and `spike:pdf:ink-store` (12 checks: the real stores — draw, restore after leaving the book, settings not touching saved strokes, undo/redo persisted, shared Ctrl+Z with highlights, rollback on refused save/delete, stale load). Regression: `spike:pdf:annotations` (39), `spike:pdf:export` (9), `spike:pdf:two-way` (21), `spike:pdf:live` (18), `spike:pdf:attachments`, `spike:reader:toolbar` (36), `spike:settings:reset` (14).
Spike expectations updated because the code legitimately changed: toolbar (PDF now has `inkAnnotations` and the `pen` tool), Reset App Settings (new `pdf-ink` group; the group list and the written-keys list were also missing `pdf-view`, which predates this work), and the reset stub (exports the two constants the pen store needs).

Known failing, **not caused by this work**: `spike:pdf:embedded` fails at its 5-type import check (it expects a Squiggly annotation to import as `underline`; the working tree imports it as `squiggly`). That comes from uncommitted changes that predate Phase 0/1 and touch nothing in the ink code. Not investigated further.

**Not run (by design):** Electron / desktop E2E, so the drawing gesture itself has not been exercised in a real window. Pointer handling, SVG painting at real zoom levels, page rotation and stylus input are covered only by code review and the manual list below.

### Known limitations

- Ink is invisible to other PDF readers and is not exported (Phase 4).
- One pen style, five colours, four thicknesses; no pressure, no palm rejection, no eraser.
- Points are smoothed for display with quadratic curves, but stored/decimated as polylines (what Phase 4 would write).
- A stroke belongs to the page it started on; points outside it clamp to its edge.
- Touch/pen input uses Pointer Events but is untested on hardware.
- Strokes do not appear in the Notes sidebar (Q3).

### Manual verification (no E2E)

1. `npm run dev` in `source/apps/reading-book-desktop`, open a PDF. The toolbar's Annotation group has a **Pen** button (PDF only; absent on EPUB/TXT/MD).
2. Arm the Pen, draw on a page: a live stroke follows the pointer, then stays. Change colour/thickness in the panel and draw again — earlier strokes keep their look.
3. Zoom in/out (toolbar, Ctrl+wheel) and scroll: strokes stay on the same page spot and scale with the page; they stay round on a non-A4 page.
4. Switch to another page and back; close the book and reopen it; quit and restart the app: strokes are restored.
5. Switch to Hand/Select and click a stroke: it gets a halo; Delete (or "Delete stroke") removes it. Click blank page: selection clears.
6. Ctrl+Z / Ctrl+Shift+Z: draw, highlight some text, draw again — undo goes newest-first across both, redo in the opposite order. Reopen the book after an undo: the reverted state persists.
7. Highlights, underlines, sticky notes and bookmarks are untouched; existing text selection and Hand panning still work with the Pen off.
8. Settings → Advanced → Reset App Settings restores the pen to blue / medium.
9. Open the PDF in another reader: the strokes are **not** there (expected until Phase 4).


### Addition after review: move a stroke with the Hand tool

Requested after Phase 1 review (a drawn stroke can be repositioned). With the **Hand** tool, a click selects a stroke (halo); a press on the **selected** stroke then drags it (move cursor, live preview) and the release saves the new position. A press on an unselected stroke still pans, so selecting is deliberate. The stroke stays on its page and is clamped so it can never leave the page box; points are shifted by the same amount, rounded like stored points, so shape and pen width are unchanged.

- SDK: `translateInkPaths` (clamp + shift) in `src/ink/ink-geometry.ts`, 3 unit tests.
- Store: `pdfInkStore.moveStroke` — one `replace` history entry (undo/redo, Ctrl+Z shared router), saved through the same `saveInk`; a zero move or unknown id records nothing.
- Renderer: `PdfRenderer` `onInkMove` + a separate drag state next to the pen draft; cancel / blur / lost pointer capture snaps back without saving. Cursor flag `data-pdf-ink-hover` → `cursor: move` (`index.css`).
- Still SQLite only — nothing is written into the PDF file; undo/redo of a move is persisted.
- Checks: `spike:pdf:ink-store` now 13 checks (adds the move case); new real-window E2E `e2e/specs/pdf-ink-move.spec.ts` (hidden window, real mouse): draw → Hand pans an unselected stroke without moving it → click selects → drag moves it by the pointer delta with live preview → undo / redo → drag past the page edge clamps → app restart restores the position. It passes (≈3 min).


### Phase 2 — styles and settings polish (implemented, pending review)

**Still SQLite only** — nothing is written into the PDF file; Pencil / Marker have no external-reader compatibility claim (Phase 4).

| Item | Where |
|---|---|
| Presets Pen / Pencil / Marker (defaults, ranges, `blend`), `clampInkOpacity`, `clampInkWidth`, `restyleInk` | `book-reader-sdk/src/ink/ink-pen-styles.ts` (+ import-free `ink-limits.ts`) |
| Per-style preferences (`tool` + `styles.{pen,pencil,marker}`), same key `readmate.pdfInkPrefs.v1`; the Phase 1 `{ pen, tool }` format is still read | `src/screens/Reader/logic/pdfInk/pdfInkPrefsStore.ts` |
| Freehand dropdown: style selector, colour picker + `#RRGGBB` field, thickness slider with pt value, opacity slider (Pencil/Marker only; Pen shows "always fully opaque"), selected style highlighted | `FreehandSettingsPopover.tsx` + shared `InkStyleControls.tsx` |
| Edit the SELECTED stroke (style, colour, thickness, opacity) from its own panel: one `replace` history entry, only that row re-saved | `PdfInkPanel.tsx`, `pdfInkStore.updateStroke` |
| Marker multiply blend (`mix-blend-mode`) in the page layer, style on the live preview and saved strokes; cursor per style | `PdfInkLayer.tsx`, `PdfRenderer.tsx`, `index.css` |

Behaviour decisions:
- Pencil = thin, 80 % opacity line (no texture). Marker = 16 pt-ish wide (0.016 of page width), 35 % opacity, multiply. Brush / Calligraphy not offered.
- Dropdown settings apply to the NEXT stroke only. Editing a saved stroke happens only in its own "Selected stroke" panel, so tool settings never retroactively change strokes. Switching a stroke's style re-derives width/opacity (`restyleInk`): Pen → always opaque; Pencil ↔ Marker keeps a chosen opacity.
- Sliders and the system colour picker commit on release, so one adjustment is one undo step.
- Toolbar order is unchanged from the previous request (Hand, Select, Search, Annotation, Freehand ▾, Eraser, Snapshot, Word Count); the Freehand button and its arrow are separate buttons and the arrow never arms the tool. Eraser stays a disabled placeholder (Phase 3).

Checks that ran: SDK `npm run verify` (typecheck, test typecheck, **465 tests**, build; 7 new in `tests/ink/ink-pen-styles.test.ts`); desktop typecheck, lint, `e2e:typecheck`, `vite build`; `spike:pdf:ink-store` **21 checks** (defaults, per-style memory, HEX validation, clamping, restart + legacy-format load, reset writes defaults, settings never touch saved rows, edit changes only one row, undo/redo/Ctrl+Z restore the look); `spike:pdf:ink` 12; `spike:reader:toolbar` 36; `spike:settings:reset` 14; `spike:pdf:annotations` 39, `export` 9, `two-way` 21, `live` 18, `attachments` 39 (one run failed once on a temp-folder check and passed twice on rerun — unrelated timing flake).
Spike harness changes: reset-settings stub now exports the pen presets and its loader maps `./x.js` to `.ts`; toolbar spike title updated.

**Real-window E2E (hidden window, approved afterwards):** `e2e/specs/pdf-ink-styles.spec.ts` passes (≈30 s) together with `pdf-ink-move.spec.ts` (both ran: 2 passed). It checks with real mouse / keyboard input: the dropdown arrow opens settings without arming the tool or drawing; Pen / Pencil / Marker only (no Brush); each style's defaults; opacity slider absent for Pen; invalid HEX flagged and not applied, valid HEX applied; a Pen, a Marker (wider, 40 %, `multiply`) and a Pencil (thin, 80 %) stroke drawn with their own looks; changing tool settings leaves saved strokes identical; selecting one stroke with Hand and editing its colour and style changes only that stroke and leaves the tool settings alone; undo / redo walk the edit back and forth; after an app restart the strokes keep their looks and every style's remembered settings come back. The colour picker's native OS dialog is not driven (the HEX field is).
The run found one real bug, now fixed: with focus on a button inside the Freehand popover, Escape disarmed the tool and left the popover open (the reader's Escape handler ran first). `useReaderNavigation` now leaves Escape to the popover when focus is inside it.
The existing E2E `pdf-annotations.spec` failures noted earlier were not re-run and are unchanged.

Known limitations: no eraser, no brush, no pressure; colour picker is the system one (Chromium); the selected-stroke panel sits bottom-right and may overlap the footer on a very short window; Marker multiply is a display effect only until the write-back phase decides how to store it.

### Brush (MVP, added after Phase 2)

Requested as an extra drawing style. **Still SQLite only; not written into PDF files; no external-reader compatibility claim.**

- **Model:** `InkPenStyle` gains `'brush'`; the parser accepts it. Nothing else in the stroke changes (same centre-line, `width` as a fraction of the page width, colour and opacity in `style`), so existing Pen / Pencil / Marker rows are untouched and need no migration. A build older than this one cannot parse a `brush` row and would hide it (it is never converted into another style).
- **Look:** the Brush is the same centre-line painted as three concentric round-capped layers inside one group (widths 100 % / 72 % / 42 %, alphas 0.3 / 0.5 / 0.9), with the stroke's opacity on the group — a soft, rounded mark whose edge fades. Pen, Pencil and Marker stay one solid path. Width is constant: no pressure, no bristles, no variable width. `inkStrokeLayers(style)` (SDK) is the single definition; `PdfInkLayer` paints saved strokes, the live preview and the eraser preview from it.
- **Defaults:** `#8E24AA`, width 0.012 of the page width (≈ 7 pt), opacity 85 % (editable 30–100 %), width range 0.004–0.04, normal blend.
- **Settings:** a fourth entry `styles.brush` under the same `readmate.pdfInkPrefs.v1` key, independent from the other styles. Preferences saved before the Brush existed load with the Brush defaults. Reset App Settings restores it with the rest.
- **UI:** a fourth button in the Freehand dropdown and in the selected-stroke panel (same colour / thickness / opacity controls), its own cursor. Switching a stroke to Brush from the Pen takes the Brush opacity default; from Pencil / Marker it keeps a chosen opacity.
- **Eraser / history:** a Brush stroke is an ordinary Readmate Ink row, so the Stroke Eraser removes it as a whole (reach = eraser radius + half its width), as one undo step; draw / edit / delete / move undo and redo as for every stroke.
- **Checks:** SDK `npm run verify` — 482 tests (new: Brush presets / layers / clamping / restyle / parser, zoom-independent path data and hit test, eraser on a Brush stroke); `spike:pdf:ink-store` 32 checks (adds independent Brush settings, restart + pre-Brush preferences, saved look, undo / redo, edit, Stroke Eraser); desktop typecheck, lint, `e2e:typecheck`, `vite build`; `spike:reader:toolbar` 36, `spike:settings:reset` 14, `spike:pdf:ink` 12, `spike:pdf:annotations` 39, `export` 9, `two-way` 21. Real-window E2E (hidden window, approved): `e2e/specs/pdf-ink-brush.spec.ts` passes, and `pdf-ink-styles` (now expecting four styles) and `pdf-ink-move` still pass (3 passed, ≈34 s). The Brush spec checks, with real mouse / keyboard input: Brush defaults and independent settings (colour, opacity, thickness) next to the Pen's; a Brush stroke rendered as a group of three concentric round layers (narrower = denser) while the Pen stays one solid path; saved strokes unchanged when settings are switched; zoom keeps the stroke's place, proportions and stored width; undo / redo; the Stroke Eraser removing the Brush as a whole (Pen stays) and undo restoring it; restart restoring both strokes and the Brush settings.
- **Limitations:** the soft edge is a display effect — when write-back exists (Phase 4) a Brush stroke can only be written as a constant-width `/Ink`, so other readers will show it as a plain stroke of that colour / width / opacity; the layered painting has not been looked at in a real window; no pressure sensitivity.
