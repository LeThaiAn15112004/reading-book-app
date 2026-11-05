# Contract: Phone UI Inside `src/`

Implements FR-012a, FR-012b and FR-012c. Library, Settings and other screens: additive only. Reader: a separate
Mobile Reader UI (decided 2026-11-03), see "Mobile Reader UI" below.

## Platform signal

New `src/platform/` helper:

```ts
isMobileHost(): boolean                     // true only when the Mobile entry declares it
isFeatureAvailable(feature: AppFeature): boolean   // always true when not on the Mobile host
```

Electron never sets the signal, so every Desktop result is the existing behaviour. Phone-only components check the signal. Width alone is not enough, because a phone in landscape can exceed 900 px.

## CSS

- `src/styles/phone.css` has rules only inside `@media (max-width: 899.98px)`. Desktop's minimum window width is 900 px, so Electron can't match them.
- **Check needed**: Electron window zoom could change the layout width. M5 confirms that Desktop's zoom keeps these rules inactive, or scopes them under a `data-mobile-host` attribute set by the signal. Scoping is the default if there is any doubt.
- Existing Tailwind classes are not rewritten.
- Safe areas use `env(safe-area-inset-*)`.
- Hard-coded widths in JavaScript (for example the 282 px and 506 px book menu) are handled case by case in phone branches.

## Gating

| Area | Method |
|---|---|
| Reader toolbar | `src/reader/capabilities.ts`: on Mobile, surfaces do not declare `textEdit`, `search`, `readAloud`, `translate`, `snapshot`, `wordCount`, attachments, shapes, ink or typewriter tools |
| Library and Import | Hide cloud, URL, audiobook ZIP, annotation import and export |
| Settings | Show Appearance and reading defaults; hide storage, updates, background, notifications and models |
| Titlebar, menubar | Replaced on the phone by a compact navigation component |

Hidden, never disabled, matching the toolbar's existing rule.

**As built (M5, T065–T073)**:

| Area | Where | What |
|---|---|---|
| Signal | `src/platform/index.ts` | `isMobileHost()` reads `window.__READMATE_HOST__`; `isFeatureAvailable(AppFeature)` with `cloudSources`, `urlImport`, `audiobooks`, `annotationTransfer`, `storageSettings`, `notificationSettings`, `keyboardShortcuts`, `updates`, `fileSystemActions`, `desktopChrome` |
| Reader toolbar | `src/reader/capabilities.ts` | Removed on the Mobile host: `textEdit`, `search`, `readAloud`, `translate`, `snapshot`, `wordCount`, `attachments`, `inkAnnotations`, `shapeAnnotations`, `typewriterAnnotations`, `fileAttachments`; TXT also loses `markupAnnotations` (read-only) |
| Import | `components/import/ImportMenu.tsx` | Only "Add file" |
| Library | `LibraryTopBar.tsx`, `BookItemMenu.tsx` | No annotation import / export, no "Open file location" / "Copy file path"; the book menu is a bottom sheet and its collection list opens inline |
| Settings | `settingsNavStore.ts`, `SettingsSidebar.tsx`, `AdvancedSettings.tsx`, `resetAppSettings.ts` | Sections: Appearance, Privacy, Advanced (without Updates), About; the section rail stays collapsed (icons); Reset App Settings resets only the groups that exist (no Main-owned notifications / background) |
| Chrome | `chrome/PhoneNav.tsx`, `App.tsx` | Library, Collections, Reading, Settings instead of `AppTitlebar` + `AppMenubar` (Cloud Sources is reached only from the menubar) |
| Long press | `platform/long-press.ts` | `{...withLongPress(handler)}` on the 4 Library cards; in Electron it is `{ onContextMenu: handler }`. The Reader's right-click menus are the Mobile Reader's (T103) |
| CSS | `styles/phone.css` | Every rule under `[data-mobile-host]`; width rules also inside `max-width: 899.98px`. `.hover-reveal` marks controls that only appear on hover |

## Touch replacements

| Desktop action | Phone |
|---|---|
| Right-click book, note or page menu | Long press opens the same menu |
| Hover-only controls | Always visible, or in an overflow menu |
| Keyboard shortcuts | Not required |
| Text selection + floating toolbar | Must not collide with OS selection callouts; validated at M2 |
| Sidebars | Full-width sheets |
| Page turn | Swipe and tap zones, reusing existing page-turn logic where possible |

Interactive targets on phone screens are at least 44 px.

## Mobile Reader UI

Decided by the user on 2026-11-03, after T024 found that CSS and small branches cannot give a usable phone Reader.

### Rules

- **Desktop unchanged**: Electron always gets the existing `ReaderScreen`, with the same behaviour and look.
- **Selection**: `src/screens/ReaderRoute.tsx` picks `MobileReaderScreen` when `isMobileHost()` is true, never by
  width (a phone in landscape can be over 900 px). It is loaded with `React.lazy`, so Desktop never loads its code.
- **Reuse, do not copy**: the Mobile Reader uses the same zustand stores, reader hooks (`useReaderBookOpen`,
  `useReaderSessionBridge`, `useReaderNavigation`, `useReaderBookmarks`, `useReaderHighlights`,
  `useReaderMdHighlights`, `useReaderPdfHighlights`), format renderers (`src/reader/renderers/*`),
  `getReaderCapabilities` and the bridge (`src/bridge/*`).
- **No Mobile-only stores** unless the reason is written in "Mobile-only state" below. UI-only state (which sheet is
  open, whether the bars are visible) is component state.
- **Small steps**: the wiring both Readers need leaves `ReaderScreen.tsx` one area at a time (FR-012c).

### First-release scope of the Mobile Reader

| In | Out (hidden on Mobile, unchanged on Desktop) |
|---|---|
| Open EPUB, PDF, TXT, Markdown; loading, error and missing-file states | Text editing of TXT (`txt.commit` is not in the first release, so TXT is read-only and has no markup) |
| Page turn by tap zones and swipe; PDF zoom by pinch or buttons | Ink, shapes, typewriter, file attachments, graphic objects |
| Table of contents, progress, go to position | Search, read aloud, translation, snapshot, word count |
| Position saved and restored (`overlay:saveSessionState`, same `reading_state_json`) | Export PDF, annotation import / export, relink, signature checks |
| Bookmarks: add, list, jump, remove | Right sidebar panels other than notes and bookmarks |
| EPUB, PDF and Markdown text highlights and notes: select, colour, note, edit, delete, list | Keyboard shortcuts, hover cards, resize handles |
| Reading appearance: theme, font size, line height, margins, through the existing prefs stores | Multi-tab reading, titlebar and menubar |

### Layout

- Full-screen page; tap the centre to show or hide the bars.
- Top bar: back to Library, title, overflow menu. Bottom bar: progress slider, TOC, bookmarks and notes, appearance.
- Each panel is a bottom sheet over the page, never a docked sidebar.
- Text selection: the native selection handles, then an action bar for highlight colours and note, placed so it does
  not cover the OS callout. A long press on an existing mark opens its menu.
- Targets at least 44 px; safe areas through `env(safe-area-inset-*)`; the page resizes with the soft keyboard when
  a note is edited.

### Moving wiring out of `ReaderScreen.tsx` (FR-012c)

Today most logic already sits in hooks and stores; what `ReaderScreen.tsx` owns is the glue between them: derived
values (`mdSource`, `mdToc`, initial positions, `readingStyle`, sidebar highlight lists), refs shared between hooks
(`epubApiRef`, `pdfApiRef`, `txtApiRef`, `mdApiRef`) and the order in which hooks receive each other's results.

Steps, each its own change and each checked before the next:

| Step | Moves | To |
|---|---|---|
| 1 | Pure derivations: Markdown source and TOC, TXT and Markdown initial positions | Pure functions in `src/screens/Reader/logic/reader-core/` |
| 2 | `readingStyle` from global prefs and per-book overrides | A pure function next to step 1 |
| 3 | Book open + session + navigation for the 4 formats, with the renderer refs | One hook, `useReaderCore`, called by `ReaderScreen` with the same arguments in the same order |
| 4 | Bookmarks and text highlights (EPUB, PDF text, Markdown) on top of step 3 | The same hook, or a second one beside it |

Not moved: anything only Desktop uses (PDF tools, attachments, translation, read aloud, search, export, sidebars,
toolbar, dialogs). If a step needs to change what a hook does, not only where it is called, it stops and is reported.

After each step: Desktop `typecheck`, `lint`, `npx vite build`, `spike:reader:toolbar`, `spike:session:roundtrip`,
`spike:txt:store`, the PDF annotation spikes when step 4 touches PDF; and a manual Desktop check that a book of each
format opens at its saved position, turns pages, and keeps highlights, notes and bookmarks after a restart. Desktop
E2E is run only if the user agrees.

### As built (T101–T103, 2026-11-05; before the device checks T094–T095, at the user's request)

| Part | Where | What |
|---|---|---|
| Selection | `screens/ReaderRoute.tsx` | `isMobileHost()` → `React.lazy(() => import('./Reader/phone/MobileReaderScreen'))` in `Suspense`; Electron never starts the import. R10: Desktop `vite build` gains one chunk `MobileReaderScreen-*.js` (25 KB); the main chunk grows 502 bytes (the lazy loader) |
| Screen | `screens/Reader/phone/MobileReaderScreen.tsx` | `useReaderCore`, `useReaderAnnotations` (`activeAnnotationTool: null`), `useReaderTxt`, `usePdfSelectionMenu`, `useReaderZoomControls`, the derivations and `readingStyleFor`; the four renderers with tool `select`; `ReaderOpenStatus` for loading and errors (no "Locate file": a missing book is imported again) |
| Bars | `phone/components/MobileReaderBars.tsx` | Top: back (flushes through `leaveToLibrary`), title, bookmark here, PDF zoom − / +. Bottom: previous / next, progress slider (`nav.goToProgress` when the finger lifts), Contents, Notes, Aa. A tap in the middle (EPUB / PDF `onCenterTap`, Markdown / TXT margin) shows or hides them; scrolling Markdown / TXT hides them |
| Page turn | `MobileReaderScreen.tsx` | Edge tap zones (14 % of the width, middle 64 % of the height) and the bottom bar call `nav.switchPage`. **Swipe is not built**: R2 decides it (T095) |
| Sheets | `phone/components/MobileSheet.tsx`, `MobileTocSheet.tsx`, `MobileMarksSheet.tsx`, `MobileMarkSheet.tsx` | Contents (EPUB TOC, PDF outline, Markdown headings, same handler as the sidebar); Bookmarks / Notes tabs (add / remove here, jump, remove, edit); Appearance (`AaSettingsPanel` as is); a mark's sheet (5 preset colours, highlight / underline / strike, note, copy, delete), opened by a tap or long press on the mark |
| Selected text | `phone/components/useLiveSelection.ts`, `MobileSelectionBar.tsx` | While a native selection exists in the page (or an EPUB iframe) the bottom bar offers "Mark selection", which dispatches the `contextmenu` the renderer already handles at the selection; once the renderer reports it (or the WebView fired `contextmenu` itself), Highlight / Underline / Note / Copy call the same store actions as Desktop's selection menu. The bar sits at the bottom, away from the OS callout |
| PhoneNav | `chrome/PhoneNav.tsx` | Hidden on `/reader/*` (the Mobile Reader has its own top bar) |
| TXT | | Read-only: no selection bar, marks drawn but not opened, `editable={false}` |
| PDF | | One page per view, `scroll` flow; only text markup is drawn and listed |

### Mobile-only state

None so far. A store may be added here only with: what it holds, why the existing stores cannot hold it, and why
component state is not enough.

### Risks to verify before building the Mobile Reader

Each is checked on the device in Expo Go, on the feasibility build, before the Mobile Reader UI is built (T094 to
T096). A failure is reported to the user and may change the layout or the scope above.

| # | Risk | How it is checked |
|---|---|---|
| R1 | Long press in the WebView starts the native selection and callout; the renderers' `contextmenu` handlers may not fire, or fire twice | Long press on text and on a mark in each of EPUB (inside its iframe), PDF text layer and Markdown; record which events arrive |
| R2 | Swipe for page turns fights native selection, scrolling and PDF pinch zoom | Prototype tap zones and swipe on the feasibility build; check that selecting text never turns the page |
| R3 | The selection range reported on touch differs from mouse selection (iframe in EPUB, text layer in PDF), so highlights are saved at the wrong place | Make a highlight on the phone, then open the same data on Desktop (after M4) and compare position and text |
| R4 | Renderers assume a desktop-sized container (resize observers, 900 px minimum, two-page PDF view) | Open each format at 360 × 640 and in landscape; rotate while reading |
| R5 | PDF canvases at phone `devicePixelRatio` (often 3) use too much WebView memory | Watch memory while turning 50 PDF pages; cap the render scale if needed |
| R6 | The soft keyboard hides the note editor or resizes the page under it | Edit a note near the bottom of the screen |
| R7 | Moving wiring changes Desktop's effect order (position restore, session flush on close), which no unit test covers | The checks after each step above; ask the user about Desktop E2E after step 3 and step 4 |
| R8 | Hooks were written for Desktop (toasts from `useReaderChromeUi`, Desktop toolbar refs) and pull Desktop-only UI into the Mobile Reader | Step 3 lists every argument `useReaderCore` takes; any Desktop-only one is passed as an option, never imported |
| R9 | A Mobile Reader path reaches a bridge method that is not in the first release | The bridge-call log of T064 during a Mobile Reader journey shows 0 `NOT_AVAILABLE_ON_PLATFORM` |
| R10 | The lazy Mobile Reader chunk is pulled into Desktop's bundle | Compare Desktop `npx vite build` output before and after; the Mobile Reader chunk is never loaded in Electron |

## Desktop verification

After each UI change: `typecheck`, `lint`, `npx vite build`, the related spikes, and a check that `npm run dev` starts. E2E runs only when the user asks. Before release, the user is asked to approve a Desktop E2E run.
