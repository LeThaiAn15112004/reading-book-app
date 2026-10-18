# PDF annotation compatibility across readers (phase 4)

Date: 2026-10-17. OS: **Windows 11 Home Single Language 10.0.26300**. This verifies phases 1–3
(`pdf_embedded_annotation_live_sync.md`, `pdf_annotation_export.md`, `pdf_annotation_two_way_sync.md`)
against independent PDF engines and readers.

## 1. What was available

| Reader / engine | Version | Present | How it was used |
|---|---|---|---|
| pdf.js (Readmate's own reader, and the test-side verifier) | 5.4.624 | ✅ | spikes and E2E read-back |
| **PDFium**, the engine of Chromium / Edge's PDF viewer, shipped inside Electron | Electron's bundled Chromium | ✅ | **automated**: `e2e/specs/pdf-pdfium-render.spec.ts` opens Readmate-written PDFs in Electron's built-in PDF viewer (`plugins: true`), captures them and counts / inspects pixels |
| **Foxit PDF Reader** | **2024.4.0.27683** | ✅ installed | **not driven**: it was **running with the user's own document open**, so opening a test file would add a tab to the user's session and a capture would include their document. Left untouched; see §4 for the manual run |
| Microsoft Edge (PDF viewer = PDFium) | 155.0.4283.45 | ✅ | covered through the same engine (PDFium) as above; Edge's own UI was not driven |
| Adobe Acrobat Reader | — | ❌ not installed | not tested |
| SumatraPDF | — | ❌ not installed | not tested |

No GUI automation tool was available in this session, so creating annotations *inside* an external
reader (external → Readmate with a real reader) could not be automated. Those flows are simulated
with generated PDFs, as in phases 1–3, and listed for manual testing.

## 2. Status per reader

Status values:
- **Verified**: tested with this engine or reader.
- **Partial**: some flows tested.
- **Reload needed**: works once the reader reloads the file.
- **Not tested**.
- **Unsupported / unsafe**.

### PDFium (Chromium / Edge engine), automated

| Flow | Result | Evidence |
|---|---|---|
| Readmate → reader: Highlight / Underline / StrikeOut rendered | **Verified** | the exported file shows 5456 highlight-colored pixels vs 0 in the source; the capture shows the highlight on line 2, the underline on line 4 and the strikethrough on line 6 |
| Readmate → reader: sticky note (`/Text`) | **Verified (icon rendered)** | the compatibility-kit capture shows the note icon |
| Semi-transparent color (`/CA`), multi-page selection (one annotation per page) | **Verified** | kit capture, page 1 and the top of page 2 |
| `/Rotate 90` page; `/Rotate 180` page with a crop box | **Verified (position)** | kit capture: the bars sit at the intended display positions (≈8 % / 30 % of the page height) |
| Comment text, author, `/NM` shown in the reader UI | **Not tested** | PDFium's viewer has no comments panel. The values are verified in the file by pdf.js |
| External → Readmate (annotations made in Edge / Chromium) | **Not tested** | needs UI automation |
| Both open at once, auto-refresh of the viewer | **Not tested** | Chromium's viewer does not watch files; a reload is expected to be needed (unverified) |

### Foxit PDF Reader 2024.4.0.27683

| Flow | Status |
|---|---|
| Foxit → Readmate (create, recolor, comment, move, resize, delete, repeated saves) | **Not tested** with real Foxit. The same PDF constructs are tested with simulated saves: incremental update, full rewrite, renumbering, rename-over |
| Readmate → Foxit (does Foxit show each type, color, comment, author?) | **Not tested.** Kit ready (§4) |
| Both open, near-simultaneous saves, Foxit refresh behaviour | **Not tested** |
| Signed / protected files | **Not tested** in Foxit. Readmate refuses encrypted files and asks before writing signed ones |

### Adobe Acrobat Reader, SumatraPDF

**Not tested** (not installed). Nothing is claimed for them. PDFium results must not be generalised
to them, and neither should Foxit's (Foxit was itself not tested).

## 3. Latency

There are two different delays.

**Readmate side** (data synced, automated, real app timings):

| Change | Latency |
|---|---|
| External save → Readmate DB + reader UI updated | 0.73–1.43 s (phase 1 E2E, 8 runs); 0.76–0.82 s (phase 3 E2E, 4 runs) |
| Readmate edit / delete → PDF file written | 0.46–0.60 s |
| Readmate add → PDF file written | 2.1–2.7 s, including ≈1 s of UI selection steps |

**External reader refreshing its own view:** **not measured.** It depends on whether the reader
watches the file. Chromium's viewer and most desktop readers keep the loaded document, and are
expected to need a reload. Unverified.

## 4. Manual test kit (for Foxit / Acrobat / SumatraPDF)

```bash
npm run spike:pdf:compat-kit -- <output folder>
```

This is run in `source/apps/reading-book-desktop` and writes:
- `readmate-written.pdf`: highlight (yellow, with a comment), underline (blue), strikethrough (red),
  a Vietnamese note, a semi-transparent purple highlight, a highlight across pages 1–2, and marks on
  a `/Rotate 90` page and a cropped `/Rotate 180` page. Everything is written by the real writer.
- `expected.json`: what each one should look like (`/NM readmate:…`, type, color, note, pages).
- `blank-for-external.pdf`: to annotate in the external reader.

Optional PDFium capture of the kit, from the same folder:

```bash
npx vite build
```

```bash
npx playwright test -c e2e/playwright.config.ts pdf-pdfium-render -g "compatibility kit"
```

The second command needs `READMATE_COMPAT_KIT=<folder>` set in the environment.

Checklist per reader:
1. **Readmate → reader.** Open `readmate-written.pdf`. Each annotation in `expected.json` should
   show with the right type and color. The comment, the note text (Vietnamese) and the author
   `Readmate` should appear in the reader's comments panel. Rotated pages should keep the marks in
   place.
2. **Reader → Readmate.** In Readmate, add `blank-for-external.pdf` and open it (write-back is
   always on: there is nothing to enable; use a copy of the file, since Readmate will write into it).
   Then, in the reader, with the
   file open in both apps:
   1. Create a highlight, save, and check it appears in Readmate within a few seconds.
   2. Recolor it and add a comment, save, and check Readmate updates.
   3. Move or resize it, save, and check it is the same row (if the reader writes `/NM`) or
      replaced.
   4. Delete one, then several, save, and check they are removed in Readmate.
   5. Save several times in a row, and check there are no duplicates.
   6. Close and reopen both apps, and check the state is the same.
3. **Two-way.** Add or recolor or delete in Readmate (it writes into the file by itself), then
   reload or reopen in the reader:
   - Is the change visible?
   - Does the reader notice the file changed without a reload?
   - Change the same annotation in both apps before saving, and check Readmate shows the conflict
     banner.
   - Save in the reader right after a Readmate edit, and check nothing is lost or duplicated.
4. Record the reader version, the OS and the result in §2.

## 5. Known limits found (all readers)

- Compatibility of the format (standard annotations), change detection, read/write, the other
  reader's **refresh**, and **concurrent writes** are separate guarantees (`pdf_annotation_two_way_sync.md` §6).
  Only the first three are controlled and tested here.
- A reader that holds an older in-memory copy and saves it later can drop Readmate's write.
  Readmate then sees it as an external change and follows the rules: deletion of untouched rows,
  conflicts for edited ones.
- Rename-over replaces the file. A reader that locks the file blocks Readmate's write; this is
  retried and reported, tested with a read-only file and not with a real locking reader.
- Squiggly is imported as an underline. FreeText, Ink, Stamp and shapes are not imported, but are
  preserved in the file.
- Signatures: Readmate warns and never claims a signature stays valid after writing.
