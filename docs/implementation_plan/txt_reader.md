# TXT reader

Date: 2026-10-18.

Read and edit a plain-text file directly in the reading area, with Highlight, Underline, Strikethrough and
Note on the text. The user's file is never written; edits live in an app-owned copy. Annotations are
ordinary `notes` rows anchored by text offsets.

Out of scope: DOC / DOCX / Markdown rendering, audiobook, AI, OCR, cloud sync, mobile; search hit painting,
read aloud and translate on the TXT surface; TXT-specific bookmarks (the pre-existing generic bookmark
placeholder is unchanged); a table of contents (none is invented).

## 1. Decisions

| # | Decision |
|---|---|
| 1 | Surface = a real `<textarea>` over a same-metrics **backdrop** that paints marks. Not `contentEditable`: a textarea gives native caret, selection, IME and clipboard, and its indices are plain UTF-16 string indices. |
| 2 | One canonical text (BOM stripped, `\n` line breaks). Every offset (save / render / restore / FTS chunk offset) refers to it. |
| 3 | Edited text is saved as an app-owned UTF-8 copy under `{userData}/txt-edits/`. SQLite holds only the current revision + annotation rows, never the text. The original file is only read. |
| 4 | Text revision and annotation rows are written in **one SQLite transaction** (`txt:commit`), so offsets in `notes` always belong to the stored revision, even after a crash. |
| 5 | Edit rule: an edit that touches an annotation's text removes the annotation; entirely before → moves it; entirely after → leaves it. Nothing else is removed. |
| 6 | One linear undo/redo history for text edits **and** annotation operations; undoing an edit restores the annotations it removed. |
| 7 | Files above `TXT_EDIT_MAX_CHARS` (400 000) open read-only (§7). |
| 8 | Reuse: `notes` table, `overlay:saveSessionState` / `reading_state_json`, `HighlightContextMenu`, note / edit popups, sidebar Notes, chunking for search / word count. New: migration 025, `txt:*` IPC, SDK `txt/`, the renderer. |

## 2. Audit before the change

- TXT had **no renderer**: it fell into the placeholder `ReadingCanvas` with `FAKE_CHAPTERS`.
- `txt.adapter.ts` is a filename stub (import/metadata unchanged). `chunking/extract-book-text.ts` already
  read TXT (BOM strip + CRLF → LF) — the canonical text matches it.
- `TextOffsetLocation` existed (`offset`, `blockId`). `notes.note_json` is open JSON, so a new anchor field needs no
  column. The overlay store had a private `writeHighlight` (made public for the TXT transaction).
- Shared popups / sidebar take `ReaderHighlightBase`; `SidebarHighlight` only needs `chapterIndex`.
- E2E existed (Playwright, throw-away `userData`) but opened a visible window → §10.

## 3. Text and offsets

- Canonical text = decoded file, one leading BOM dropped, `\r\n` and `\r` → `\n`. No Unicode normalisation.
- Offset = UTF-16 code-unit index (`String.slice`, `textarea.selectionStart`). Ranges are half-open
  `[startOffset, endOffset)`, never split a surrogate pair (`isValidTxtRange`).
- Decoding (`electron/txt/txt-codec.ts`): BOM → UTF-8 / UTF-16 LE / BE; BOM-less UTF-16 by zero-byte
  heuristic; valid UTF-8; otherwise Windows-1252 and a notice. TCVN3 / VNI (font-based encodings) are not
  decodable and show as mojibake.
- Edited text is always written as UTF-8 + `\n`, no BOM.
- The FTS chunker uses the same decoder, so chunk offsets are offsets into the text on screen.

## 4. Annotations and the edit rule

Row = `notes` row: `locatorExtended.locator` = `text-offset` at the start (`blockId: 'txt'`,
`chapterIndex: 0`), `note_json.txtAnnotation = { startOffset, endOffset }`, quote + context in
`locatorExtended.text`. Validated at the IPC boundary (`parseTxtAnnotationRef`, locator consistency, range,
quote still at the offsets). `overlay:saveHighlight` refuses TXT rows.

For an edit `{start, deleteLength, insert}` and an annotation `[a, b)`:

| Edit | Result |
|---|---|
| ends at/before `a` (`start + deleteLength <= a`, includes an insert at `a`) | moved by `insert.length − deleteLength` |
| starts at/after `b` (`start >= b`, includes an insert at `b`) | unchanged |
| anything else (overlap, insert strictly inside, delete exactly it) | annotation removed |

Typing right after an annotation does not grow it; right before it moves it. Several annotations touched by one
edit are all removed (overlapping ones too). A removed Note takes its text with it (same row).

- Input events are turned into exactly one edit (`deriveTextEdit`) using the selection captured in
  `beforeinput`, so repeated characters at an edge land at the caret. IME: the whole composition is one edit.
- Undo restores removed annotations (offsets valid in the pre-edit text) and shifts the others back.
- On open, rows whose quote no longer sits at their offsets (original file changed outside) are **hidden, not
  moved and not deleted**, with a notice. They stay in SQLite.

## 5. Storage and saving

```
{userData}/txt-edits/{bookId}/r{revision}.txt     UTF-8, LF, written atomically (temp → fsync → rename)
txt_documents(book_id PK→books ON DELETE CASCADE, revision, content_sha256, char_count, source_sha256, updated_at)
```

- `txt:open` → text (edited copy if intact, else decoded original), `revision` (0 = original), annotations,
  `editable`, notices (`source_changed`, `working_copy_lost`, `legacy_encoding`). A copy that fails its SHA-256
  falls back to the original with a notice.
- `txt:commit` `{ bookId, baseRevision, text?, upserts, deletedIds }`: validates everything (no half-applied
  commit) → writes `r{rev+1}.txt` → ONE `BEGIN IMMEDIATE` transaction (revision CAS, rows, deletes) → prunes
  old files → invalidates the search / word-count chunks. A failed transaction removes the new file. Commits
  per book are serialized; a stale `baseRevision` is a `conflict`.
- Renderer (`txtDocumentStore`): the document is an immutable SDK `TxtDocument`; `planTxtCommit` diffs it against
  what is persisted, so a failed save simply leaves the next plan larger. Debounce 700 ms (max 4 s); annotation
  operations save immediately; flush on blur / hide / book switch / window close handshake.
- **"Saved" is shown only after a successful commit with nothing left to save.** Otherwise: "Unsaved changes",
  "Saving…", or "Couldn't save — Retry" (auto-retry with backoff for transient errors; `conflict` / `invalid` /
  `too_large` are fatal and not retried).
- Source protection: no code path writes the book's path; the renderer never sees a path; copy ids are validated
  (`[A-Za-z0-9_-]{1,128}`), revisions are positive integers. Removing a book deletes its folder and cascades its rows.
- Reading position: `text-offset` `Location` in `books.reading_state_json` through the existing session
  autosave; it follows edits and is clamped to the text length on open.

Schema change: **migration 025 only** (new table; no existing data touched; verified on a populated database).

## 6. Reading surface

- `src/reader/renderers/txt/TxtRenderer.tsx`: scroller → `.txt-editor` → `.txt-backdrop` (transparent text,
  marks, measuring; `aria-hidden`) + `<textarea class="txt-input">` (`field-sizing: content`, no inner scroll).
  Both layers share every metric (`txt.css`). Text only ever reaches the DOM as a text node or a textarea value.
- The textarea is uncontrolled: React never writes it while typing (caret / IME safe). Load, undo and redo write
  it; the caret is restored from a request.
- Click = caret; drag = selection. Right-click inside a selection = the shared selection menu (Highlight /
  Underline / Strikethrough / Add note / Copy …). With a markup tool armed the box is read-only and a drag marks.
  A click on a mark opens its popup (note → note popup).
- Capabilities (`txt`): markup, snapshot, word count, Aa settings. No Hand / Select, no Page layout, no search
  painting. Footer shows scroll progress; margins / font / size / line height / align come from the existing prefs.
- Position ↔ pixels is measured on the backdrop (binary search over line tops); saved position is the first line
  at the top of the viewport.

## 7. Performance and limits

Measured on the dev machine, Electron 39, hidden (software-rendered) window:

| Text | Open | Typing |
|---|---|---|
| 380 000 chars | ≈ 2.4 s | ≈ 105–165 ms / key |
| 1 000 000 chars (before the limit) | ≈ 2.6 s | ≈ 340 ms / key textarea alone, ≈ 650 ms with a live backdrop |

A single textarea re-lays out the whole text per keystroke. Mitigations: the backdrop trails typing by 180 ms above
100 000 chars; editing is limited to `TXT_EDIT_MAX_CHARS = 400 000` — larger files open read-only (read, select,
annotate, search index still work). Raising the limit needs paragraph-level editing (a redesign).

Other limits: bookmarks on TXT use the generic placeholder; TCVN3 / VNI unsupported; hidden stale annotations are
never auto-relocated; a text edited while the index is being rebuilt can briefly show old search results.

## 8. Security

IPC carries data only (no paths); every `txt:commit` field is re-validated in Main; the copy folder is addressed by
validated id + integer revision; the TXT content is never interpreted as HTML (E2E: script / `<img onerror>` text
stays inert); preload exposes only `txt.open` / `txt.commit`.

## 9. Tests

| Level | What | Command | Result (2026-10-18) |
|---|---|---|---|
| Unit | SDK `tests/txt/*`: normalisation, BOM, edit derivation, edit rule (table + randomised oracle), undo/redo (randomised), persistence diff, segments, reading position | `npm test` in `book-reader-sdk` | 121 TXT tests; SDK total 285 pass |
| Integration (Main) | real service + codec + copy store + SQLite (migrations incl. 025) + `overlay:*` / `txt:*` IPC on temp files: encodings, errors, atomic commit, crash leftovers, corrupted copy, failures, conflicts, validation, isolation, deletion, upgrade of a populated DB | `npm run spike:txt:main` | 37 / 37 |
| Integration (store ↔ Main) | the real renderer store against the real service, with failure injection: honest status, retry, conflict, in-flight edits, annotations, book switching | `npm run spike:txt:store` | 19 / 19 (found and fixed a stale retry timer) |
| E2E | built Electron app, hidden window: `txt-reader` (A), `txt-editing` (B, F), `txt-annotations` (C, D, E) | `npm run e2e:txt` | 12 / 12; full suite 40 pass, 1 optional skipped |

E2E covers: BOM + CRLF Vietnamese render and scroll, inert HTML, empty file; type / Enter / Backspace / delete /
paste / undo / redo with honest status, edited copy on disk, original file byte- and mtime-identical, restart
restores text and scroll position; IME composition; read-only above the limit; speed; no caret jump across saves;
layer alignment across font / size / weight / spacing / alignment; all four annotation kinds (menu and a real mouse
drag with a tool), painting, sidebar, restart; before / after / inside / multi-annotation edits, undo / redo, no
orphans; EPUB + PDF + TXT side by side and TXT removal cleanup.

Existing spike `reader-toolbar` encoded "TXT = placeholder" (and used `txt` as its placeholder sample); it was updated
on purpose (Markdown is now the placeholder sample, TXT has its own surface and checks).

## 10. E2E without taking over the desktop

- E2E is explicit only: `npm run e2e` / `e2e:only` / `e2e:txt` (`.claude/settings.local.json` makes them prompt).
  Nothing in `dev`, HMR, git hooks, `postinstall` or CI starts it; no watch mode.
- Default is **hidden mode** (`launchApp` sets `READMATE_E2E_HIDDEN=1`; `E2E_HIDDEN` in `electron/main.ts` renders
  the window off-screen and never calls `show()` / `focus()`). `READMATE_E2E_SHOW=1` shows a real window.
- Each test: own `userData` in `os.tmpdir()` (the fixture refuses to run otherwise), generated fixtures, no shared
  profile / DB / library; one worker; per-test timeout; the app is closed and the folder removed afterwards.
- The existing 40-test suite also passes in hidden mode (no regression, no reduced reliability).

```
cd source/apps/reading-book-desktop
npm run e2e:txt                    # TXT only (builds first)
npm run e2e                        # everything
# watch it: $env:READMATE_E2E_SHOW='1'; npm run e2e:txt      (PowerShell)
```

## 11. Status

| Item | Status |
|---|---|
| Open / render / encodings / inert content | done, tested |
| Direct editing, undo / redo, IME, no caret jump | done, tested (real IME not tested; composition events simulated) |
| Reliable save, error handling, restore | done, tested |
| Annotations + edit rule + undo + restore | done, tested |
| Reading position | done, tested |
| Source file protection, delete cleanup | done, tested |
| Migration 025 | done, tested |
| Regression EPUB / PDF | done (existing suite passes) |
| Editing files > 400 000 chars | **not supported** (read-only) — decision needed |
| TXT bookmarks, search painting, TOC | not done (out of scope) |
| E2E with a visible window / real GPU | not run |

## 12. Decisions for the owner

1. Is 400 000 characters an acceptable edit limit, or is paragraph-level editing for long novels wanted?
2. Hidden annotations (text changed outside the app): keep hidden (current) or offer a "re-anchor" action?
3. Should TXT get real bookmarks (offset + excerpt) as a follow-up?
