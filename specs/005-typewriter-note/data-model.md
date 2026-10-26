# Data Model: Typewriter Note

No new table and no migration are planned. A Typewriter note is one `notes` row (like every PDF annotation); the rich text lives in the row's existing JSON. Limits below were checked against `PDF_ANNOTATION_MAX_REF_LENGTH` (512 KiB for the packed annotation) and `MAX_CONTENTS_LENGTH` (10 000 characters).

## 1. Row layout

| Field | Where | Rule |
|---|---|---|
| id | `notes.id` | Same scheme as other annotations; `/NM` = `readmate:<id>` |
| book | `notes.book_id` | Owning PDF |
| style kind | `note_json.type` = `typewriter` | New member of `HighlightStyleKind` (SDK `highlight-location.ts`, `domain/annotation/{highlight,note}.ts`) and of the SQL/IPC allow-lists |
| plain text | `notes.note` | Canonical text: NFC, `\n` line breaks, no control characters except `\n`, 1–10 000 UTF-16 code units, not blank. Feeds the Notes list, `/Contents` and the sync "text" field |
| base colour | `colorHex` | `#RRGGBB` (no alpha); also the default colour of text |
| page | locator `page-rect` (1-based), `chapterIndex` = 0-based page | As for other PDF annotations |
| box | `note_json.pdfAnnotation.rects[0]` | Normalized 0–1 over the displayed page box; exactly one rect |
| rich text | `note_json.pdfAnnotation.typewriter` | See §2 |
| times | `created_at`, `updated_at` | → `/CreationDate`, `/M` |

`parsePdfAnnotation` accepts `typewriter` only with `rects.length === 1`, a valid `TypewriterDoc`, and `styleKind === 'typewriter'` (Main re-validates every save, like shapes).

## 2. Rich-text document (`PdfTypewriterDoc`, schema version 1)

```text
typewriter: {
  v: 1,
  base: TextStyle,                 // style of every character without an override
  runs: StyleRun[],                // sparse overrides, sorted, non-overlapping, merged
  align: AlignSpan[],              // sparse paragraph alignment, sorted by start
  boxHeightMode: 'auto'            // reserved; height is always content-driven (see §4)
}

TextStyle = {
  family: FontFamilyId,            // 'noto-sans' | 'noto-serif' | … (stable ids, not display names)
  size: number,                    // fraction of the page WIDTH (zoom independent), clamped
  color: '#RRGGBB',
  bold: boolean, italic: boolean, underline: boolean, strike: boolean
}

StyleRun   = { start: number, end: number, style: Partial<TextStyle> }   // UTF-16 offsets into `notes.note`, half-open
AlignSpan  = { start: number, align: 'left'|'center'|'right'|'justify' }  // start = offset of a paragraph's first character
```

Why this shape (and not one flat style): a flat style cannot hold "one bold red word in a black paragraph". Offsets into the plain text keep the row's `note` the single source of the characters, so the Notes list, `/Contents`, search and sync never see markup.

Invariants (checked by `parseTypewriterDoc`, tested in the SDK):

1. `0 ≤ start < end ≤ text.length` for each run; runs sorted by `start`, no overlap, adjacent runs with equal style merged, no empty `style`.
2. Run boundaries never split a surrogate pair or a precomposed letter (offsets are on code-point boundaries).
3. `align[i].start` is 0 or follows a `\n`; sorted, unique; missing paragraphs use `left`.
4. At most 500 runs and 200 align spans; `size` in `[TYPEWRITER_MIN_SIZE, TYPEWRITER_MAX_SIZE]` (≈6–144 pt on a 612 pt page, as fractions of width); `family` in the shipped list; `color` valid hex.
5. Effective style of a character = `base` overlaid with the run covering it.
6. A text edit maps runs with a prefix/suffix diff (same idea as TXT's `planAnnotationEdit`): runs wholly before the edit stay, runs wholly after shift, runs overlapping the edit are trimmed; inserted text takes the style of the character before the caret (or the pending typing style).

Sizing: a worst-case note (10 000 characters, 500 runs, 200 spans) is well under 100 KiB of JSON, inside the 512 KiB packed limit.

## 3. Typewriter defaults (not in SQLite)

Renderer `localStorage`, key `readmate.pdfTypewriterPrefs.v1`: `{ style: TextStyle, align }` with `reset()` registered in `APP_SETTINGS_RESETTERS` (same pattern as `pdfShapePrefsStore`). Defaults seed `base` of a new note and nothing else; changing them never edits existing notes.

## 4. Box, layout and overflow

- Box: `rects[0] = { x, y, width, height }` normalized over the displayed page box; top-left = click point for a click-created note.
- Width is user-set (minimum 4 % of page width). **Height is content-driven**: stored height = max(user-dragged height, laid-out text height). The app computes the layout and stores the resulting height, so file and app agree.
- Layout inputs: plain text, `base`, `runs`, `align`, box width, page width (to turn fractional sizes into points), font metrics of the shipped faces. Line breaking: at spaces; a word wider than the box breaks between characters; kerning and ligatures off; line height = 1.2 × the tallest font size on the line (constant `TYPEWRITER_LINE_HEIGHT`).
- Overflow: resize narrower or larger font ⇒ re-layout ⇒ height grows. If the grown box would leave the page the change is refused (`reason: 'does_not_fit'`), stored data unchanged.
- Rotation: none per note; page `/Rotate` and crop are handled by the writer's page transform (as for shapes).

## 5. State machines

Note lifecycle:

```text
(no row) --click/drag with tool--> draft (store only)
draft --empty + Escape/outside--> discarded
draft --non-empty + Escape/outside--> saved (1 undo step)
saved --edit session commit | move | resize | format | delete--> saved/removed (1 undo step each)
saved --file eligible and encodable--> in file
saved --ineligible or unencodable--> pending ("not in the file", reason kept in memory, recomputed on demand)
```

Interaction states (renderer):

```text
IDLE -> ARMED (tool active) -> DRAFT_EDITING
IDLE/ARMED --click note--> SELECTED
SELECTED --press body + drag >4px--> MOVING --release--> SELECTED
SELECTED --press handle--> RESIZING --release--> SELECTED
SELECTED --dblclick | Enter | F2 | sidebar "Edit text"--> EDITING
EDITING --Escape | click outside | tool switch | sidebar close | book close--> SELECTED (committed)
SELECTED --Escape | click empty--> IDLE/ARMED
SELECTED --Delete/Backspace--> removed
```

Sidebar target (renderer store `typewriterPanelStore`): `{ mode: 'defaults' } | { mode: 'note', id }`. It holds ids and the editor's transient selection only; displayed values are always read from the row (or defaults), so there is nothing per-note to leak when the id changes. Transient editor info (selection range, pending typing style, active style at caret) lives in `typewriterEditorStore`, cleared on every id change.

## 6. Relationships

- Belongs to one Book (PDF). Appears in the same Notes list and `pdfHighlightsStore` history as highlights and shapes.
- Mirrored in the file by one `/FreeText` annotation, tracked by the existing ledger, `base_json` and `conflict_json` of two-way sync. Sync fields for a Typewriter note: `kind`, `color` (base colour), `text`, `geometry` (box). The rich-text document is app-authoritative: the file never overwrites it; a foreign text change makes a conflict (the doc is kept until the user chooses).
- Fonts: `EmbeddedFontFace` records are static assets (family id, weight/style, file name, coverage, licence), not database rows.
