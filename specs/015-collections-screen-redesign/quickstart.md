# Quickstart: validating spec 015 (Collections screen redesign)

## Prerequisites

- `npm install` at the repo root; a library with ≥ 12 books (some without a cover image) on Desktop and on the
  Android build (`npm run android`).
- Automated gate first: `npm run check` (typecheck, lint, `sdk:test`, `mobile:test`, boundaries, builds) and
  `npm run check:desktop-baseline` (Main changes approved in `desktop-main-changes.json`).
- Desktop Main spike: `npm run spike:collections:main` (bulk add, sortOrder add, remove → undo order).
- No E2E (manual-only rule).

## 1. Themes and contrast (US1, FR-001…FR-003, SC-001)

In Dark, Day, Paper, Sepia: open Collections, hover a card, open New / Edit, open the ⋮ menu, open Delete confirm,
open the picker. Expected: every title, label, field, button readable; Delete red with its label. Measure with the
DevTools contrast picker: text ≥ 4.5 : 1, icons / focus outline ≥ 3 : 1. Record any Sepia miss (R2).

## 2. Phone card actions (US1, FR-004…FR-006, SC-003)

360 px phone: tap 20 times across card rows (name, covers, count, ⋮). Expected: only ⋮ / long-press open the sheet;
everything else opens the collection; 0 accidental edits / deletes. Sheet rows ≥ 44 px; Delete asks for confirmation.
Desktop: right-click a card opens the same menu.

## 3. Add books (US2, FR-007…FR-010, SC-002, SC-006)

Create an empty collection → its page shows the empty state with "Add books". Open the picker, search a title (with
and without Vietnamese accents as the Library search allows), tick 10 books across two searches, confirm. Expected:
10 books appended in tick order, toast "Added 10 books", picker closed. Books already in the collection show as
included and cannot be ticked. Cancel / Esc / phone Back adds nothing. Phone: search at top, "Add (n)" fixed above the
keyboard. With 1 000 books (seed via import of a test folder), results appear < 1 s after typing.

## 4. Covers (US3, FR-012, FR-013, FR-013a, SC-005)

Collections with 0, 1, 2, 3+ books: card shows that many covers + placeholders; a book without an image shows the
generated cover. Phone list: compact rows, ≥ 6 visible at 360 × 640.

## 5. Manage on the page + undo + toggle (US4, FR-011, FR-014, FR-015, SC-007)

On a collection page: ⋮ → Edit renames at once; remove the 2nd book → toast with Undo → Undo puts it back as 2nd.
Library book menu → "Add to collection": checked rows for collections holding the book; choose one → removed + Undo.
Delete the collection from its page → back to the hub; books still in the Library.

## 6. Keyboard and screen reader (US5, FR-016…FR-020, SC-004)

Keyboard only: create → add 3 books via picker → open → remove one → rename → delete. Focus never leaves an open
dialog; on close it returns to the opener; list rows are one stop + ⋮. NVDA (Desktop) / TalkBack (phone): checkbox
states, "n selected", toasts announced. Phone Back closes dialog / picker / sheet before leaving.

## 7. Preferences and layout (US6, FR-021…FR-023)

Choose List, restart → still List; Settings → Advanced → Reset App Settings → Grid. Resize 320 px → wide: grid fills
rows evenly, no horizontal scroll. OS "reduce motion" on → no card lift.
