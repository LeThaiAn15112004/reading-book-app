# PDF rendering library — selection & setup

Status: library installed + minimal rendering proof. **Not** the PDF Reader MVP.

## Decision: `pdfjs-dist` (Mozilla PDF.js), pinned to 5.4.624, no `react-pdf`

> Initially installed 6.4.299; downgraded to **5.4.624** (exact pin) after a runtime error —
> see *Runtime fix: `getOrInsertComputed`* below.

| Criterion | pdfjs-dist | react-pdf |
|---|---|---|
| Compat (React 18, TS 5, Vite 8, Electron 39 / Chromium 142) | Ships ESM + its own `.d.ts`; typechecks and bundles as-is | Wraps pdfjs-dist and pins its own version — a second copy/version to keep in sync |
| Rendering in renderer | Canvas, inside our sandboxed renderer | Same engine |
| Local-file loading | `getDocument({ data })` from bytes we already get over IPC | Same |
| Text layer / selection | `TextLayer` class | Same, as components |
| Navigation, zoom, metadata, search | `getPage`, `getViewport({scale})`, `getMetadata`, `getTextContent` (search = our own index over text content) | Same, plus `<Document>/<Page>` components |
| Annotation feasibility | Direct access to `AnnotationLayer`, `getAnnotations`, page/viewport transforms | Adds an abstraction we'd bypass for custom highlight overlays |
| License | Apache-2.0 | MIT (+ Apache-2.0 underneath) |

`react-pdf`'s only gain is JSX components; this codebase already writes imperative engine wrappers
(`EpubRenderer` over epubjs), and custom overlays/locations need direct engine access. One stack: pdfjs-dist.

## Dependencies installed

- `pdfjs-dist@5.4.624` — exact version, no caret (desktop `dependencies`, via the npm workspace root lockfile `source/package-lock.json`).
  It brings optional `@napi-rs/canvas` (Node-only, used by PDF.js outside browsers; unused in the renderer —
  the lockfile growth is its per-platform optional binaries).

## Configuration

- **Worker**: `import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` →
  `GlobalWorkerOptions.workerSrc`. Vite emits `dist/assets/pdf.worker.min-<hash>.mjs`, which electron-builder
  packs with `dist/` into the asar. No CDN at runtime.
- **CSS**: `pdfjs-dist/web/pdf_viewer.css` for `.textLayer` positioning (bundled locally).
- **File access**: unchanged. Renderer calls the existing `library.openBookContent(bookId)`; Main resolves and
  validates the path (`resolveBookFile`) and returns an `ArrayBuffer`. The component passes a *copy*
  (`data.slice(0)`) because PDF.js transfers the buffer to its worker. No new IPC, no path or Node API in the
  renderer, `contextIsolation`/`sandbox` untouched.
- **Component**: `src/reader/renderers/pdf/PdfRenderer.tsx` — opens the doc, renders one page (HiDPI canvas +
  text layer), prev/next, loading + error states; cancels render/text tasks and `destroy()`s the loading task on
  change/unmount. Wired in `ReaderScreen.tsx` only for `bookFormat === 'pdf'`; the EPUB branch is unchanged.
  PDFs were already importable (`pdf.adapter.ts`, `SUPPORTED_FORMATS`) and previously fell back to `ReadingCanvas`.

## Annotation feasibility (what PDF.js does vs. what we must build)

1. **Rendering existing PDF annotations** — supported natively: `page.getAnnotations()` + `AnnotationLayer`
   (links, form widgets, popups); appearance streams are drawn on the canvas by default. Not wired yet.
2. **Creating/editing annotations in the viewer** — PDF.js has an editor layer (`AnnotationEditorLayer`:
   FreeText, Ink, Highlight, Stamp) but it is tied to the full `pdf_viewer` stack and its UI. For our
   highlights/notes we should build our own overlay (like EPUB) from text-layer selections → page-space rects.
3. **Persisting in app storage** — not a PDF.js concern. Use the existing overlay tables keyed by `bookId`
   with the page-rect `Location` the SDS already defines; the book file is never mutated.
4. **Exporting/embedding into the PDF** — PDF.js can `saveDocument()` editor annotations, but that writes a new
   PDF; it is not a general PDF-writing library. Export (to a *copy*, never the original) would need a separate
   evaluated library (e.g. pdf-lib, MIT) — **not installed**; evaluate licensing/responsibilities first.

## Compatibility notes / known limitations

- Do not bump `pdfjs-dist` past 5.4.624 without upgrading Electron (see below); the pin is exact on purpose.
- `cMapUrl`, `standardFontDataUrl`, `wasmUrl` are not configured: CJK PDFs using non-embedded CMaps, PDFs relying
  on non-embedded standard fonts, and JPEG2000/ICC decoding may render incorrectly or log warnings. Fix: copy
  `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}` into the build (e.g. a small Vite copy step) and pass the
  local URLs.
- No zoom UI integration, no position persistence/resume, no TOC/outline, no search, no continuous scroll,
  no theme (dark mode) handling; the Reader toolbar capabilities for PDF are untouched.
- Whole file is held in memory (bytes over IPC) — fine for typical books; very large PDFs may later want
  range loading via a custom `PDFDataRangeTransport` over IPC.
- The worker chunk is ~1.08 MB (minified), loaded only when a PDF is opened.

## Validation (2026-10-10)

- `npm run typecheck` — pass.
- `npx vite build` — pass; worker emitted locally. Full `npm run build` (electron-builder packaging) not run.
- `npm run lint` — fails, but on **pre-existing** errors in unrelated files (same failure with this change
  stashed). The new PDF files lint clean with `--max-warnings 0`.
- Tests — no test runner exists in the repo.
- Real PDF rendering in the running app — **not yet verified** (requires importing a PDF through the Electron UI).

## Runtime fix: `getOrInsertComputed` (2026-10-10)

**Symptom:** opening a PDF showed `this[#methodPromises].getOrInsertComputed is not a function`; nothing rendered.

**Root cause:** `pdfjs-dist` 6.4.299 calls `Map.prototype.getOrInsertComputed` (TC39 "upsert" proposal) in its
unpolyfilled modern build. The failing call is `WorkerTransport.#cacheSimpleMethod`
(`build/pdf.mjs`, `this.#methodPromises.getOrInsertComputed(...)`), run in the **renderer** on the first
`getDocument()` round-trip; the worker uses it too (17 call sites each in `pdf.mjs` / `pdf.worker.mjs`).
The app's Electron does not have it.

**Evidence:**
- Installed versions: pdfjs-dist 6.4.299 (lockfile + `package.json`), Electron 39.8.10 → Chromium 142.0.7444.265,
  V8 14.2.231.22, Node 22.22.1 (in Electron); Vite 8.1.5.
- Probe in that Electron binary: `typeof Map.prototype.getOrInsertComputed === 'undefined'` in main, sandboxed
  renderer and a Web Worker.
- Which releases use it (modern `build/`, grep of the npm tarballs): 5.4.624 → 0 call sites; 5.5.207 → 9;
  5.6.205 / 5.7.284 / 6.0.227 → 11; 6.3.289 → 17; 6.4.299 → 17.
- Reproduction in a sandboxed Electron 39 `BrowserWindow` (ES module + module worker, generated 1-page PDF):
  6.4.299 → exact same error; 5.4.624 → `numPages: 1`, text `"Hello Readmate"` extracted, glyph pixels on canvas.

**Decision:** pin `pdfjs-dist@5.4.624`, the newest release whose modern build doesn't need the API. Rejected:
a hand-written global polyfill; the 6.x `legacy/` build (it installs core-js polyfills on the global `Map`/`WeakMap`
prototypes in the renderer — same global patching, plus a heavier bundle); upgrading Electron (unrelated
platform change). No component code changed: the 5.4 API used here (`getDocument`, `render({ canvas, viewport })`,
`TextLayer`, `streamTextContent`) typechecks unchanged.

**Verification:**
- `npm run typecheck` — pass. New PDF files lint clean (`npm run lint` still fails on pre-existing errors elsewhere).
- `npx vite build` — pass; main chunk and `pdf.worker.min-*.mjs` both report 5.4.624 (API/worker match);
  `getOrInsertComputed` appears nowhere in `dist/`. Full `npm run build` (packaging) not run. No test runner.
- **Not verified:** opening a real PDF through the actual app UI (`npm run dev` + import) — the runtime evidence is
  the standalone Electron 39 probe above, not the app itself. EPUB not re-tested at runtime (its code is untouched).
- Upgrade path: move past 5.4.624 only with an Electron whose Chromium ships `Map.prototype.getOrInsertComputed`
  — re-run the probe before bumping.

## Next steps (PDF Reader MVP)

1. Verify manually with a real PDF in `npm run dev`; ship cmaps/standard fonts/wasm locally.
2. `PdfRendererApi` mirroring `EpubRendererApi` (next/prev/goTo, nav state) + reader capabilities for PDF.
3. Page-rect `LocationCodec` for PDF; resume position via `overlay:saveSessionState`.
4. Zoom via `ReaderZoomViewport`/scale, continuous scroll with virtualized pages, outline → TOC, text search.
5. Highlights: selection → page-space quads → overlay tables; render as our own layer. Then `AnnotationLayer` for
   links/existing annotations. Export to a copy only after evaluating a PDF-writing library.
