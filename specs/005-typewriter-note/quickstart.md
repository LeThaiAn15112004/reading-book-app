# Quickstart: validating Typewriter Note

Data: [data-model.md](data-model.md). Contracts: [contracts/typewriter-note.md](contracts/typewriter-note.md). Gates and milestones: [plan.md](plan.md). Nothing here has been run yet; commands marked *(new)* do not exist until implemented.

## A. Automated

```text
cd source/apps/book-reader-sdk
npm run verify                         # typecheck + tests + build
  # new tests: tests/typewriter/{doc,edit,layout,fonts}.test.ts; extended
  # tests/app-models/pdf-highlight.test.ts, pdf-annotation-export.test.ts, pdf-annotation-two-way.test.ts

cd ../reading-book-desktop
npm run typecheck
npm run lint
npx vite build
npm run spike:pdf:typewriter-font      # (new) M0 gate, criteria M0-1…M0-8 in plan.md
npm run spike:pdf:typewriter           # (new) Main IPC + SQLite + writer + pdf.js read-back
npm run spike:pdf:typewriter-store     # (new) renderer stores against Main: create/format/undo/panel target
npm run spike:pdf:export               # extended: typewriter in the exported file
npm run spike:pdf:two-way              # extended: write-back, edit, delete, foreign text change → conflict
npm run spike:reader:toolbar           # extended: PDF-only tool, right-click wiring present
npm run spike:settings:reset           # extended: typewriter defaults reset
```

Do not run E2E (manual-only).

### Test cases (requirement → check)

| ID | Check | Covers |
|---|---|---|
| T-01 | `normalizeTypewriterText` NFC, `\r\n`→`\n`, strips controls, keeps Vietnamese | FR-003, edge cases |
| T-02 | `parseTypewriterDoc` rejects overlap, out-of-range, split surrogate, unknown family, >500 runs, bad colour | data-model §2 |
| T-03 | `applyStyle` range, caret (pending), whole box; toggle semantics on partly-bold range | FR-014, US3 |
| T-04 | `editText` insert/delete/replace maps runs; inserted text inherits previous char's style | data-model §2.6 |
| T-05 | `layoutTypewriter` wrap, over-long word, justify (last line not stretched), alignment per paragraph, height, `does_not_fit` | FR-005, D3 |
| T-06 | `checkCoverage` all Vietnamese letters pass; Arabic/Thai/emoji reported; fallback rule | FR-024, FR-026 |
| T-07 | Export plan: typewriter row → FreeText write item with lines, fonts, runs; unencodable → pending reason | FR-023–026 |
| T-08 | Three-way merge: text/geometry/colour fields; doc never taken from file; foreign text edit → conflict | FR-027 |
| T-09 | `parsePdfAnnotation` accepts exactly one rect + valid doc; rejects otherwise | contracts §1 |
| T-10 | Main spike: save/list/patch/delete via real `overlay:*`; box smaller than text height rejected | FR-005 |
| T-11 | Writer spike: single incremental update, original bytes unchanged, pdf.js text equals input, fonts resolve, bold/italic/underline/strike/colour/align read back, rotated and cropped pages | FR-023–025, SC-003 |
| T-12 | Ineligible file (encrypted, read-only, signed, changed): note stays pending with the right code | FR-026 |
| T-13 | Store spike: create/move/resize/format/delete each = one undo step and redo restores | FR-010, SC-006 |
| T-14 | Panel store: select A → B → none → defaults; no value of A visible after switch | FR-021, SC-007 |
| T-15 | Prefs: persisted, invalid value falls back, reset restores | FR-019 |
| T-16 | Regression: existing `spike:pdf:{shapes,shape-store,ink,ink-store,graphics,annotations,embedded,live,export,two-way}` still pass | FR-030, SC-008 |

## B. Manual checks (app running, `npm run dev`)

Editing and Hand Mode
1. Activate Typewriter, click a page, type "Xin chào — đây là ghi chú", press Enter, type a second line, Escape. Note stays, appears in Notes, row jumps to it.
2. Drag a rectangle with the tool: box takes that rectangle. Click-create near the page edge: box stays inside.
3. Type with the Windows Vietnamese keyboard in Telex and VNI (including composition of `ươ`, `ệ`, tone changes): no duplicated or lost letters.
4. Hand Mode: hover shows an outline; click selects; handles appear; drag body moves; drag each of the 4 corners and 4 edges resizes; the box never gets shorter than its text; Esc deselects.
5. Double-click / Enter / F2 enters editing; place the caret with the mouse; select with Shift+arrows and the mouse; type, delete, paste rich text (arrives as plain text); Ctrl+Z inside the edit; click outside commits (one undo step in total).
6. Raise the font size until it cannot fit above the page bottom: a message appears, size and text unchanged.
7. Select Mode: one click on a note selects it; a second click or double-click edits. Hand Mode: one click does not select; a double-click selects; another double-click on the selected note edits. Press on a note in Hand Mode: page does not pan, no PDF text selection starts. Press on empty page: pans as before. Switch to Select: PDF text selection works as before.

Formatting and sidebar
8. Select a word, apply bold, red, underline; another word italic + strikethrough; centre one paragraph and justify another. Close the book, restart the app, reopen: identical.
9. Caret only: turn on italic, type: new text italic; move the caret: pending style cleared.
10. With nothing selected in the editor: change family and size in the sidebar: the whole box changes. Enter `#1E88E5`, `1e88e5`, `zzz`: first two accepted, last rejected with the old colour kept.
11. Right-click the Typewriter tool: sidebar opens in defaults mode; set Serif / 18 pt / blue; the tool state is unchanged; create a box: it uses those defaults; existing notes unchanged; restart: defaults remembered; Settings → Advanced → Reset App Settings restores them.
12. Right-click a note: it is selected and the sidebar shows its values. Right-click another: values switch with no carry-over. Deselect: sidebar returns to defaults. Close the sidebar mid-edit: edit is committed.
13. Open the sidebar when the note is under its area: the page scrolls so the note stays visible.
14. Keyboard only: Tab to the Properties button of the quick toolbar and open the sidebar.

File and readers
15. Writable PDF: add a Vietnamese mixed-style note; open the file in a second tool: `npm run spike:pdf:compat-kit -- <dir>` (extended) produces `readmate-written.pdf` with a Vietnamese, mixed-style, justified, rotated-page set and `expected.json`.
16. For each reader you have (record which), open the kit file and tick: text and diacritics correct; colours; bold/italic/underline/strike; alignment; position on normal, `/Rotate 90`, `/Rotate 180` + crop pages; text selectable/searchable. Record version and result in `docs/implementation_plan/pdf_annotation_reader_compatibility.md`. Readers not run are listed "not tested".
17. Encrypted/read-only/signed PDFs: note stays in the app with the reason; a note containing Arabic/Thai text shows `unsupported_characters` naming them; nothing is lost.
18. Export PDF with annotations…: the exported file contains the notes.
19. Edit/delete the note in the app: file follows. Change the note's text in another reader, return to Readmate: conflict flow appears and the formatted document is untouched until chosen.
20. Undo/redo through create, move, resize, format, delete; quit and reopen.

Regression
21. Shape, Freehand, Eraser, Highlight family, Insert/Replace Text, PDF text selection, Search (Ctrl+F), zoom, fit page, continuous scroll behave as before.

## C. Expected outcomes

SC-001…SC-009 in the spec. SC-004 is proven only by the recorded results of steps 15–16; SC-009 by M0-5 and step 15.
