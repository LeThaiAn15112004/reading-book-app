# Quickstart: validating spec 019

Prerequisites: `npm install` at the repo root; an Android phone (or emulator with touch) running the installed app
(`npm run android`, not Expo Go, so the WebView and local server are the real ones); on it: an EPUB with a table of
contents, an EPUB without one, a PDF with an outline, a PDF without, a Markdown book with headings, a TXT book.

## Automated (default checks — no E2E)

```bash
npm run sdk:test          # reader-gesture, reader-place, phone-reader-chrome, i18n gate / glossary anchors
npm run mobile:test       # txt-commit (phone bridge), existing bridge / store / contract tests
npm run typecheck && npm run lint && npm run e2e:typecheck
npm run check:boundaries && npm run check:platform-adapters && npm run check:build-split
npm run build             # Desktop still builds
npm run check:desktop-baseline   # no Main file changed
```

## Device check first (research R2 — gate for Story 2)

| # | Steps | Expected |
|---|---|---|
| D1 | EPUB in Page view: 20 swipes left, 20 right | exactly 20 page turns each way (SC-002) |
| D2 | Long-press a word at the left edge, then the right edge, 20 times in total | text selected every time; no page turned |
| D3 | PDF Page view: same as D1 / D2 | same |
| D4 | If D1–D3 fail only while the page follows the finger | switch to the fallback (slide on release) and record it in plan.md |

## Manual (phone)

| # | Steps | Expected | Spec |
|---|---|---|---|
| 1 | Open each book | first page with no bar over it | FR-008, SC-003 |
| 2 | Tap the middle; wait 4 s; tap the middle; turn a page | bars fade in; fade out; in / out; hidden after the turn | Story 3 |
| 3 | Open Contents, press Back; open Notes → a mark → Delete, press Back ×4 | confirm closes, then the mark panel, then Notes, then the book is left; position unchanged | Story 1, SC-001 |
| 4 | Select text, press Back | selection cleared, bar gone, book still open | FR-001 |
| 5 | Select text in EPUB, PDF, Markdown, TXT; tap a colour | marked with one tap; the colour bar appeared without "Mark" | FR-015, SC-006 |
| 6 | TXT: mark, change colour, add a note, delete; leave and reopen | changes kept; text not editable | FR-015a |
| 7 | Aa in EPUB: Sepia, font size +2, Scroll | page re-lays out behind the sheet, position kept; Settings → Appearance shows Sepia | Story 4, SC-005 |
| 8 | Aa in PDF | only Theme, View, Zoom; no zoom in the top bar | FR-013 |
| 9 | PDF never opened before | opens in Page view; swipe turns | FR-013a |
| 10 | PDF Page view: pinch to zoom; swipe toward the right edge; swipe again | first swipe pans and stops at the edge; second turns; new page fitted | FR-013b |
| 11 | PDF / Markdown / TXT / EPUB Scroll: tap near the left edge | bars toggle; no page change | FR-006 |
| 12 | Bottom bar in each book | EPUB: chapter · page x/y in chapter; PDF: outline entry · page x/y; Markdown: heading · %; TXT: title · %; one row | FR-010a, SC-004 |
| 13 | EPUB with contents: chapter 3 → bookmark; Desktop: same | label = chapter 3's title on both | Story 6, SC-008 |
| 14 | Drag the slider and release outside it | jumps once to the released place | FR-011 |
| 15 | Android "Remove animations" on; turn pages, show bars | no slide, no fade | FR-007, FR-009 |
| 16 | TalkBack on | "Show reading controls" first; Previous / Next page in the bottom bar | FR-017 |
| 17 | 360 px wide phone, landscape | one-row bottom bar, every control ≥ 44 dp, chapter name ellipsised | Edge cases |
| 18 | Read the phone screen code | per-format choice only in `useReadingSurface`; no `() => {}` / `DOMRect(0,0,0,0)` passed | SC-009 |

## Desktop regression (`npm run dev`)

Open an EPUB, a PDF (paged and scroll), a TXT (edit, undo, mark), a Markdown book (insert, translate): behaviour as
before; new EPUB bookmarks carry the real chapter title.
