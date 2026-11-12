# Quickstart: validating spec 013 (Mobile Library)

## Automated (run from the repository root)

| Command | Proves |
|---|---|
| `npm run sdk:test` | chip rules incl. `recent`, phone Continue Reading pick / action, list-row progress, `restartReading` statements (`tests/app-models/library-phone.test.ts`, `tests/db/library-restart.test.ts`) |
| `npm run mobile:test` | Mobile `library.restartBook` (completed → reading, 0 %, other keys kept, unknown id refused) |
| `npm run typecheck` | Desktop and Mobile `window.api` both implement `restartBook` |
| `npm run check:desktop-baseline` | the Main files touched are approved in `desktop-main-changes.json` |
| `npm run check:build-split` + `npm run build:web` | no ad / native module in the WebView bundle; `AdSlot` placeholder absent from the release bundle (`grep -c "Banner 320" web-dist/assets/*.js` = 0) |
| `npm run check` | whole gate green |

## Manual on an Android device / emulator (`npm run android`)

Prepare: a fresh install, then the files from `source/app/platforms/electron/spikes/` fixtures (one EPUB, one PDF, one TXT, one MD).

1. **Empty state** (US2): fresh install → icon, one sentence, formats, "Import book". Cancel picker → no change.
   Pick an EPUB → it appears, empty state gone.
2. **Header / chips** (FR-030–033): "+" opens the picker directly. Favourite one book → "Saved" shows only it.
   "Recent" shows opened books, last read first, even with sort = Title. A chip with no book → nothing-matches + Clear.
3. **Continue reading** (US1): read the EPUB to the middle, back → card first, "Resume" reopens the same page.
   Mark it completed → card shows 100 % / "Read again" → tap → opens at the beginning; back in the Library it shows
   0 %, status reading, highlights still there.
4. **Grid / List** (US3): switch to List, kill the app, reopen → List. Rows: badge, ⋮, thin bar only for opened books.
   Rotate → grid columns adapt, ≥ 2 in portrait. Settings → Advanced → Reset App Settings → Grid.
5. **Sheet** (US4): ⋮ on the card, a grid cover and a list row → same actions, same order; swipe down / Back closes it;
   Remove from library asks, names the book and the data removed.
6. **Bars** (US5): with gesture navigation and with three-button navigation (Settings → System → Navigation), scroll
   to the end of 200 books: tab bar fixed, last row fully visible, navigation area in the tab bar colour.
   Release build (`npm run android -- --variant release`): no banner gap; dev build: dashed 320 × 50 placeholder.
7. **Theme / language**: Paper and Sepia themes, another accent, Vietnamese / English → every new element follows.
8. **Performance** (SC-005): import 1 000 small TXT files (script in `platforms/native/scripts/` or adb push + import),
   reopen the app → Library usable < 2 s, scroll without visible stutter.

## Desktop regression (SC-007)

`npm run dev` → Library unchanged (sidebar, table + detail panel, Continue Reading max 3, no chips, no banner).
