# Contract: phone reader UI (spec 019)

All texts from `core/src/i18n/catalogue/{en,vi}/reader-phone.ts` (`reader.phone.*`), no literal UI text (`no-ui-literals`).
New Vietnamese terms go into `specs/012-app-ui-i18n/contracts/glossary.md` first:

| English | Tiếng Việt |
|---|---|
| Page (view) | Trang |
| Scroll (view) | Cuộn |
| Show reading controls | Hiện thanh điều khiển |
| Page {page} of {total} in chapter | Trang {page}/{total} trong chương |
| Fit page | Vừa trang |

Icons: `MobileReaderIcons.tsx`, inline SVG 24 × 24, stroke 1.8, round caps, `aria-hidden`; every icon button has an
accessible name, ≥ 44 × 44 dp hit area, `active:` pressed state, `focus-ring`. No text glyph as an icon (FR-016).

## Layers (top to bottom, z-order)

| z | Layer | Back closes it | Opens from |
|---|---|---|---|
| 60 | confirm dialog of a panel | yes (first) | mark panel → Delete |
| 50 | mark panel (sheet) | yes | tap / long press a mark; Notes → a mark |
| 40 | Contents · Bookmarks / Notes · Appearance (sheet) | yes | bottom bar icons |
| 30 | selection bar | yes (clears the selection) | a stable text selection |
| 20 | top bar · bottom bar | no (Back leaves the book when no layer is open) | tap middle |
| 15 | toast | — | — |
| 10 | "Show reading controls" (screen-reader only, first in reading order) | — | — |
| 0 | page | — | — |

## Page (by format and view)

| | EPUB Page | EPUB Scroll | PDF Page | PDF Scroll | Markdown | TXT |
|---|---|---|---|---|---|---|
| Opens with bars | hidden | hidden | hidden | hidden | hidden | hidden |
| Swipe ← / → | next / prev page (follows finger) | — | next / prev page; zoomed: pan, turn only from the edge | — | — | — |
| Tap left / right 20 % | prev / next page | toggles bars | prev / next page | toggles bars | toggles bars | toggles bars |
| Tap elsewhere | toggles bars | toggles bars | toggles bars | toggles bars | toggles bars | toggles bars |
| Pinch | — | — | zoom | zoom | — | — |
| Page turn / scroll | hides bars | hides bars | hides bars | hides bars | hides bars | hides bars |

A tap on a link follows it; on a mark opens its panel. Reduced motion: no slide, no fade.

## Top bar (52 dp + safe area top; fades 180 ms)

`[← Back]  Title (one line, ellipsis)  [Bookmark]` — Bookmark hidden for TXT; filled when this place is bookmarked.
No zoom here (moved to Appearance for PDF).

## Bottom bar (≤ 64 dp + gesture area; fades 180 ms) — FR-010, FR-010a

```
 Chapter 3 · The river          Page 4/12 in chapter
 ━━━━━━━━━━━━━━━━●─────────────────────────────   [≡] [✎] [Aa]
```

- Line 1 (12–13 px): place `name` (ellipsis) and `detail` (tabular numbers). Line 2: slider (thumb ≥ 44 dp hit
  area) + Contents / Notes / Appearance icon buttons. Contents hidden when `toc` is empty.
- Screen-reader order: Previous page, Next page (visually hidden, Page view only), place, slider, Contents, Notes,
  Appearance.
- Slider: commits once on release anywhere; keys commit on key-up (FR-011); dragging shows the target place in a
  small bubble above the thumb and pauses auto-hide.

## Appearance sheet (controls ≥ 48 dp, labels ≥ 12 px) — FR-013, FR-014

| Section | EPUB | PDF | Markdown | TXT |
|---|---|---|---|---|
| Theme: Paper · Sepia · Night · System (app setting) | ✓ | ✓ | ✓ | ✓ |
| View: Page · Scroll (per book) | ✓ | ✓ | — | — |
| Zoom: − · Fit · + (and %) | — | ✓ | — | — |
| Font size (A− · value · A+) | ✓ | — | ✓ | ✓ |
| Font family | ✓ | — | ✓ | ✓ |
| Line spacing | ✓ | — | ✓ | ✓ |
| Margins | ✓ | — | ✓ | ✓ |

Never: keyboard hints, 1 / 2-page layout, weight / alignment (kept as they are, not offered on the phone). Changes
apply live behind the sheet; the sheet covers at most 60 % of the height so the page stays visible.

## Selection bar (one step) — FR-015

Appears ≤ 300 ms after the selection is stable: `[● ● ● ● ●] [U̲] [S̶] [✎ Note] [⧉ Copy]` (colour swatches = the
store's palette, last used first; underline / strike / note / copy as icons with names). A colour marks immediately and
clears the selection; Note marks then opens the mark panel on its note field. Shown in EPUB, PDF (text), Markdown, TXT.

## Mark panel

Colour row, style (highlight / underline / strike), note field, Copy, Delete (→ confirm dialog). Same for every format.

## Toast

Top = `--phone-reader-top-inset` + 8 dp; `role="status"`; 2.4 s.
