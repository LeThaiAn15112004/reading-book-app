# Contracts: Typewriter Note

No new IPC channel and no new `window.api` method. Everything rides the existing `overlay:*` channels; the contracts below are the payload, the file output, the UI contracts and the pure-module interfaces.

## 1. IPC payload (`overlay:saveHighlight`, list, patch, delete)

- `styleKind: 'typewriter'` is added to `validStyleKinds` (`overlay.ipc.ts`) and to the SQL type lists in `sqlite-overlay-store.ts`.
- Save body:

```text
{
  bookId, styleKind: 'typewriter',
  colorHex: '#RRGGBB',                      // base text colour
  note: <plain text>,                       // NFC, \n breaks, 1..10000 code units, not blank
  pdfAnnotation: {
    pageIndex,
    rects: [ { x, y, width, height } ],     // exactly one, normalized, inside the page
    typewriter: { v: 1, base, runs, align } // PdfTypewriterDoc, data-model.md §2
  }
}
```

- Main rejects (same error shape as other rejects): blank text; `rects.length !== 1`; box outside the page or below the minimum size; `typewriter` missing; invalid `TypewriterDoc` (overlap, bad offsets, unknown family, bad colour, out-of-range size, too many runs); non-PDF book; text over the cap.
- The stored box height MUST be ≥ the height the layout engine computes for that document and width (Main recomputes and rejects a box that would clip text, with `does_not_fit`).
- `HighlightDto.pdfAnnotation.typewriter?: PdfTypewriterDoc` in `electron/ipc/api-types.ts`. Moves, resizes and formatting use the existing patch/save path with the full row.

## 2. PDF output

| Key | Value |
|---|---|
| `/Type /Annot /Subtype /FreeText` | |
| `/IT` | `/FreeTextTypewriter` |
| `/Rect` | the box in user space (page rotation/crop through the writer's page transform) |
| `/Contents` | plain text (UTF-16BE via the existing text-string encoder) |
| `/DA` | default font name + size + colour for readers that regenerate |
| `/Q` | alignment of the first paragraph (0 left, 1 centre, 2 right; justified is drawn in the AP only) |
| `/BS << /W 0 >>`, `/F 4` | no border, print flag |
| `/NM` | `readmate:<id>` |
| `/T`, `/M`, `/CreationDate`, `/P` | as for shapes |
| `/AP << /N … >>` | form XObject, `/BBox` = `/Rect`, with `/Resources << /Font << /F0 … /F1 … >> /ExtGState … >>`; content: for each laid-out line, per run `BT … /Fn size Tf r g b rg x y Td <glyph ids> Tj ET`, justified lines with word spacing, underline/strike as filled thin rectangles |

Font objects per face used in the update:

```text
Type0 font  /BaseFont /<SUBSET>+<Name>  /Encoding /Identity-H  /DescendantFonts [CIDFontType2]  /ToUnicode <cmap stream>
CIDFontType2 /CIDSystemInfo (Adobe, Identity, 0)  /FontDescriptor  /CIDToGIDMap /Identity  /W [...]  /DW 1000
FontDescriptor /Flags /FontBBox /ItalicAngle /Ascent /Descent /CapHeight /StemV  /FontFile2 <subset TrueType stream>
```

(Tag `ABCDEF+` is a deterministic 6-letter subset tag.) Written only through the existing incremental writer after `pdf-write-eligibility.ts`, then read back with pdf.js: text equals `/Contents`, box matches, every font resolves. A failed read-back rolls the write back (the existing behaviour) and leaves the note "not in the file".

**Not promised**: editing a Readmate note's text in another reader keeping Vietnamese (the reader may regenerate with `/DA`); `/RC` rich text.

## 3. "Not in the file" reasons (renderer-visible, no new channel)

Returned by the existing sync status path as a code plus message data:

| Code | Meaning | User-facing action |
|---|---|---|
| `file_not_writable` | encrypted / read-only / changed on disk / signed without confirmation | the existing messages |
| `unsupported_characters` | characters no shipped face can draw (list included) | "Remove or replace: …" or choose another font |
| `font_unavailable` | a shipped font file failed to load or subset | "Reinstall/restart; your text is kept" |
| `does_not_fit` | box would clip text or leave the page | enlarge the box or reduce size |

The note's content is never changed or dropped in any of these cases.

## 4. Reader capability and tool

- `capabilities.typewriterAnnotations: boolean` — true for PDF only. `ToolDef`: `{ id: 'typewriter', label: 'Typewriter', group: 'annotation' or 'freehand', requires: ['typewriterAnnotations'] }`.
- Tool button: `onContextMenu` → `preventDefault`, open sidebar in defaults mode; does not arm or disarm.
- No shortcut is assigned in v1 (the shortcut registry is not touched).

## 5. Sidebar contract

`RightPanelId = 'settings' | 'typewriter'`.

| State | Condition | Shows | Writes to |
|---|---|---|---|
| Defaults | opened from the tool's right-click, or no note selected | family, size (pt, for a nominal 612 pt page width), colour (picker + HEX), B/I/U/S, alignment | `pdfTypewriterPrefsStore` |
| Note | a note is selected (right-click, Properties, or select while the panel is open) | same controls, values of the note; if editing with a range, values at the selection (mixed → indeterminate) and an "Edit text" action | the row, through `pdfHighlightsStore` (one undo step per control change, coalesced for slider/colour drags) |

Rules: controls never move focus out of the editor; a change with a range applies to the range, with a caret sets the pending style, without an editor range applies to the whole box; selecting another note or none resets the transient editor store and re-reads values from the row; closing commits the open edit; Escape inside the panel returns focus to the page.

## 6. Pure module interfaces (SDK `typewriter/`)

```text
parseTypewriterDoc(value, text): PdfTypewriterDoc | undefined       // validates data-model §2 invariants
normalizeTypewriterText(input): string                              // NFC, \r\n→\n, strip controls
applyStyle(doc, text, range|null, patch): PdfTypewriterDoc          // range → runs; null → base + clear overrides of the touched keys
applyAlign(doc, text, range|null, align): PdfTypewriterDoc
editText(doc, text, change): { doc, text }                          // run mapping on insert/delete/replace
effectiveStyle(doc, offset): TextStyle
layoutTypewriter(doc, text, boxWidth, pageWidth, metrics: FontMetrics): { lines: LaidOutLine[], height: number, unsupported: number[] }
checkCoverage(text, doc): { ok: true } | { ok: false, characters: string[] }   // after fallback rule
typewriterFontFaces: readonly EmbeddedFontFaceInfo[]                // ids, styles, coverage ranges (data only; bytes live in the desktop app)
```

`FontMetrics` port: `advance(face, codePoint): number | undefined`, `ascent(face)`, `descent(face)`, `unitsPerEm(face)`. Implemented in the renderer and in Main from the same font files.

## 7. Preferences

`readmate.pdfTypewriterPrefs.v1` (renderer `localStorage`): `{ style: TextStyle, align }`; `reset()` registered in `APP_SETTINGS_RESETTERS`; invalid stored values fall back per field to defaults.

## 8. Shortcuts and pointer behaviour (reader surface)

| Input | State | Result |
|---|---|---|
| Click empty page | tool active | create draft at point |
| Drag > 4 px | tool active | create draft with that rectangle |
| Click note | Select / tool active | select |
| Double-click note | Hand | select |
| Single click note | Hand | nothing (existing pan / tap) |
| Double-click selected note | Hand / Select / tool active | edit |
| Click the already-selected note (no drag) | Select | edit |
| Press body of selected note + drag > 4 px | Hand / Select / tool active | move |
| Press handle + drag | selected | resize |
| Double-click, Enter, F2 | selected | edit |
| Escape | editing | commit, stay selected |
| Escape | selected | deselect |
| Click outside | editing | commit |
| Delete / Backspace | selected, not editing | delete |
| Ctrl/Cmd+Z, Y | editing | text-level undo/redo |
| Ctrl/Cmd+Z, Y | not editing | annotation history |
| Right-click | on note | select + open sidebar (note mode) |
| Right-click | on tool button | open sidebar (defaults) |
