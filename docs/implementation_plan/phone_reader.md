# Phone reader (spec 019) — implementation map

Spec: `specs/019-mobile-reader-redesign/` (spec, plan, research R1–R13, contracts, quickstart, tasks).

The phone reader keeps the shared reading engine (renderers, stores, core hooks) and rebuilds the chrome around it on
two holders: ONE reading surface and ONE chrome store. No migration, no new IPC channel, no Main change.

## Core (pure, `source/core/src/app-models/`)

| Module | What | Tests |
|---|---|---|
| `phone-reader-chrome.ts` | `reduceChrome(state, event)`: bars, ordered layer stack (`selection · toc · marks · appearance · mark · confirm`), slider flag, toast, top inset; `swipesAllowed`, `idleTimerRunning`; `CHROME_IDLE_MS` 4 s, `CHROME_TOAST_MS` 2.4 s | `tests/app-models/phone-reader-chrome.test.ts` |
| `reader-gesture.ts` | Two separate recognizers — `recognizeTap` (single tap: < 10 px, < 350 ms; edge / middle) and `recognizeSwipe` (page-turn swipe) — ranked by `classifyGesture` (swipe > tap > none; thresholds of R2), and `isSwipeCandidate` (the page follows the finger) | `tests/app-models/reader-gesture.test.ts` |
| `reader-place.ts` | `chapterNameFor` (last contents entry at or before the place), `placeFor` (FR-010a per format / view), `bookmarkLabelFor` | `tests/app-models/reader-place.test.ts` |

## Shared UI

- `screens/Reader/logic/readerPlace.ts` — the book's own contents as `ContentsEntry[]` (EPUB: spine index via the new
  `EpubRendererApi.getSpineHrefs()`; PDF: outline page; Markdown: heading index), `currentChapterName`,
  `formatPlaceDetail`. Used by Desktop `ReaderScreen` (new bookmark labels) and the phone. `useReaderBookmarks` now
  prefers the caller's label over `epubNav.label` (which can be a file name). `FAKE_CHAPTERS` only for the demo surface.
- Optional renderer props (Desktop unchanged when absent): `TxtRenderer` editing callbacks + `onSelectionChange`;
  `EpubRenderer.onPagePointer` (frame pointer stream in outer coordinates; sets `touch-action: pan-y pinch-zoom` on the
  frame); `PdfRenderer.tapZones` (false = blank click reports only `onBlankClick`).
- Mark stores open by identity: `openHighlight(id)` (PDF / Markdown / TXT, rect optional), EPUB `openHighlightById(id)`.
- `useReaderNavigation.highlightShortcutsRef` is optional (the phone has no keyboard shortcuts).
- `hooks/app/backCloseStore.ts` steps over the history entry of a layer that closed under another one.

## Phone (`screens/Reader/phone/`)

| File | Role |
|---|---|
| `logic/useReadingSurface.tsx` | The ONLY per-format branch: builds `ReadingSurface` (`logic/readingSurface.ts`) and the renderer element from `useReaderCore`, `useReaderAnnotations`, `useReaderTxt`, `usePdfSelectionMenu`, `useReaderZoomControls`. PDF Page / Scroll from `book.prefs.viewMode` (Page = `flow="paged"`, fitted to the screen) |
| `logic/phoneReaderChromeStore.ts` | zustand, session-only: chrome state (core reducer) + the idle / toast timers + the renderers' live values (Markdown headings, pending selections, text percent). Reason in `specs/008-shared-core-architecture/contracts/phone-ui.md` |
| `logic/usePhonePageGestures.ts` | Touches (main document) + EPUB frame pointers → classifier; finger-following transform on the page wrapper. Page view: every tap is decided here (one tap rule), the renderer only answers a hit test when the finger goes down (`isMarkAt`: EPUB marks, PDF `isTargetAt` — marks, notes, icons, strokes) and its blank click only closes its own UI. Scroll view: the renderers report taps on their surface; only taps no renderer covers are acted on here |
| `MobileReaderScreen.tsx` | Composition only: bars, sheets, selection bar, mark sheet, toast; layers follow the surface |
| `components/*` | `MobileReaderBars` (one-row bottom bar, fade, slider commits once), `MobileAppearanceSheet` (theme = app setting, view, zoom, text), `MobileSelectionBar` (one step), `MobileMarkSheet` (+ delete confirm layer), `MobileMarksSheet`, `MobileTocSheet`, `MobileSheet` (`useBackClose`), `MobileReaderIcons`, `useLiveSelection` (auto-requests the renderer's selection menu once a selection is stable) |

## Mobile bridge

`platforms/native/bridge/txt.ts` `txt.commit` — marks only (contract `contracts/mobile-txt-commit.md`), rows written
by `MobileOverlayStore.commitTxtAnnotations` in one host transaction. Tests: `platforms/native/tests/txt-commit.test.ts`.

## Not verified yet (device)

The quickstart's device rows — R2 gate D1–D4 (swipe vs. long-press selection on the real WebView), finger-following
on EPUB frames, zoomed-PDF edge swipes, TalkBack — have not been run. If D1–D3 fail only while the page follows the
finger, take the fallback of research R2 (slide on release) and record it in `plan.md`.
