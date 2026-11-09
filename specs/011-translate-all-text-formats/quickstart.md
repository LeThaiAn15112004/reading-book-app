# Quickstart: validate Translate in every text format

## Automated (agent may run)

```bash
npm run sdk:test                     # core: resolveTranslationSource precedence
npm run spike:translation:source     # Main: get / set / clear, kept by overwriteSessionState, gone with the book, refusals
npm run typecheck && npm run lint
npm run check:boundaries && npm run check:desktop-baseline
npm run build
```

Expected: all green. `check:desktop-baseline` fails until every changed Main file is listed in
`source/scripts/desktop-main-changes.json`.

## Manual (in `npm run dev`)

Sample books: one EPUB, one PDF with a text layer and a `/Lang` (e.g. a French PDF exported from Word), one scanned
PDF page, one TXT (editable), one Markdown with a code block and a table. Translation model may download on first use.

| # | Steps | Expected | Spec |
| --- | --- | --- | --- |
| 1 | TXT: toolbar → Translate, select a sentence | panel opens with that sentence, translating | US1-1/2, SC-001 |
| 2 | TXT, mode on: type, paste, Ctrl+Z | nothing changes; save status shows no new save | US1-5, FR-005, SC-003 |
| 3 | TXT: Esc (or click Translate again), then type | mode off; typing edits the text at once | US1-4/6 |
| 4 | Markdown, mode on: select text in a paragraph, then in a code block | panel shows the rendered text, no `#`/`` ` `` symbols | US1-1, FR-009 |
| 5 | Any format, mode on: select phrase A, then phrase B | panel switches to B; A's result never appears after | US1-3, FR-006 |
| 6 | PDF: toolbar shows Translate; mode on, select across two lines / two pages | panel opens, text in reading order | US2-1/2 |
| 7 | PDF, mode on: pick Highlight | mode turns off, Highlight armed | US2-3 |
| 8 | Scanned PDF page, mode on: drag | no panel, no error | US2-4, FR-010 |
| 9 | French PDF with `/Lang fr`: translate a selection | source shows French | US3-1, SC-004 |
| 10 | TXT: change source to Vietnamese, close the book, restart the app, reopen, translate | source starts as Vietnamese | US3-4, SC-006 |
| 11 | After #10, open another book | it does not start from Vietnamese (unless it is its own choice / language) | US3-5 |
| 12 | EPUB: repeat #1, #5, right-click → Translate | unchanged behaviour | FR-012, SC-005 |
| 13 | Each format: right-click a selection → Translate | panel opens | FR-003 |
| 14 | Select > 20,000 characters, translate | "Selection is too long" refusal, same in all formats | Edge cases |

Desktop E2E (`npm run e2e`) is manual-only: run it only if the user asks.
