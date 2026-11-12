# Contract: Phone Library UI (spec 013)

Applies only on the Mobile host (`isMobileHost()`); Desktop renders `LibraryHub` exactly as before (FR-026).
Extends `specs/008-shared-core-architecture/contracts/phone-ui.md` (same rules: hidden, never disabled; ≥ 44 px
targets; CSS under `[data-mobile-host]`).

## Layout (top → bottom)

| # | Region | Component | Scrolls | Notes |
|---|---|---|---|---|
| 0 | Status bar | host (`routes/index.tsx`) | — | painted with the page's top-edge colour |
| 1 | Header | `phone/MobileLibraryHeader.tsx` | no | search box (existing `LibrarySearchBox`, recent searches kept) + "+" → `handleFromDevice` |
| 2 | Filter chips | `phone/PhoneFilterChips.tsx` | horizontal | `PHONE_LIBRARY_CHIPS`; one active; `role="radiogroup"` |
| 3 | Continue reading | `phone/PhoneContinueCarousel.tsx` | horizontal, scroll-snap | ≤ 10 cards; hidden when empty; card = cover · title · author · location · relative time · progress · Resume / Read again · ⋮ |
| 4 | Toolbar | `phone/PhoneBrowseToolbar.tsx` | with list | "N books" · sort select · Grid / List toggle |
| 5 | Collection | `LibraryBookGrid` (phone columns) or `phone/MobileBookList.tsx` | vertical | list row = cover 48 × 64 · title · author · thin progress (opened only) · format badge · ⋮ |
| 6 | Banner slot | `phone/AdSlot.tsx` | no | DEV build: dashed 320 × 50 placeholder; release: `null` |
| 7 | Tab bar | `components/chrome/PhoneNav.tsx` (moved to bottom) | no | icon + label; Library · Collections · Reading · Settings; hidden in Reader |
| 8 | System navigation | host | — | painted with the page's bottom-edge colour (= tab bar) |

Regions 1–2 stay at the top; 3–5 are one vertical scroll container; 6–7 are outside it, so the last row is never
covered (FR-024).

## Interactions

| Gesture | Result |
|---|---|
| Tap card / "Resume" | `openReader(id)` |
| Tap "Read again" | close the book's Reading tab if open → `library.restartBook(id)` → refresh → `openReader(id)`; failure → toast `library.toast.actionFailed`, Reader not opened |
| Tap ⋮ / long press (card, grid cover, list row) | existing `BookItemMenu` bottom sheet (`phone-sheet`) |
| Tap chip | `setFilter(id)` |
| Tap Grid / List | `setLayout('grid' \| 'table')` |
| Tap "+" / "Import book" | `handleFromDevice()` |
| "Clear" on nothing-matches | clears search and sets chip `all` |

## Bottom sheet order (FR-017) — `BookItemMenu` when `phone`

header (cover, title, author) · Resume / Read again · Add to collection · favourite toggle · Mark completed / Mark as
reading · Book details · Edit metadata · Remove from this collection (in a collection) · separator · Remove from
library (destructive). Hidden on phone: open file location, copy path, annotation import / export, delete file,
remove audiobook (audiobooks unavailable).

## i18n keys (new, `source/core/src/i18n/catalogue/{en,vi}/library.ts`)

`library.phone.chips.{all,recent,saved,completed}`, `library.phone.add`, `library.phone.searchPlaceholder`,
`library.continue.readAgain`, `library.phone.empty.{title,body,formats,import}`, `library.phone.noMatch.clear`,
`library.phone.layout.{grid,list}`, `library.menu.markReading`, `library.phone.adPlaceholder`.

## Theme

Only `--lib-*` tokens; no literal colours. Default appearance (Night + orange) reproduces the mockup.
