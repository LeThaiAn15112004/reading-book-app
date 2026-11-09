# Contract: Translate mode in the text renderers

Each text renderer receives the same two props EPUB already has. `ReaderScreen` passes
`translation.mode` and `(selection) => translation.openForSelection(selection)`.

| Renderer | "mode on" prop | "selection finished" callback | Where it is decided |
|---|---|---|---|
| `EpubRenderer` | `translateModeActive` (existing) | `onTranslateDragEnd(info)` (existing) | unchanged |
| `PdfRenderer` | `translateModeActive` | `onTranslateSelection(selection: PdfSelectionInfo)` | pointer-up, same guard as markup: not a pan, `selectionChangedSince(gesture.selectionAtDown)`, `readPdfSelection` non-null |
| `MdRenderer` | `translateModeActive` | `onTranslateSelection(selection: MdSelectionInfo)` | `onPointerUp`, after the link / button guard, when `readMdSelection` is non-null |
| `TxtRenderer` | `translateModeActive` | `onTranslateSelection(selection: TxtSelectionInfo)` | `finishPress`, when `readSelection()` is non-null |

Rules common to all four:

1. Called only for a non-empty selection made by THIS press; a click without a selection does what it does today
   (open a mark / blank click).
2. In Translate mode a finished selection does NOT open the selection context menu automatically; right-click still
   opens it (its Translate entry works as today).
3. The callback never changes the document: no annotation, no edit, no write.
4. The selection is left visible after the callback (the user sees what is being translated), except where the
   renderer must collapse it to avoid an editing side effect (TXT keeps today's markup behaviour: caret moved to the
   selection end).
5. Translate mode and an armed markup / ink / shape / typewriter / attachment / insert tool never coexist
   (`ReaderScreen.selectTool` turns the mode off; turning the mode on sets the tool to `select`).

TXT only: while `translateModeActive` is true the text box is read-only (`readOnly`, like an armed markup tool) and
undo / redo (keyboard and `beforeinput` history events) are ignored; when it turns false the box is editable again at
once (if the book is editable).

PDF only: `PdfSelectionInfo.lang` is the document's catalog `/Lang` (empty when absent). The `translate` capability is
added to the `pdf` surface; Mobile still removes it (`MOBILE_EXCLUDED`).
