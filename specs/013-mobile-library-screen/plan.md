# Implementation Plan: Mobile Library screen

**Branch**: `013-mobile-library-screen` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-mobile-library-screen/spec.md`

## Summary

Give the Mobile host its own Library home that matches the mockup (header with search + "+", filter chips, a
horizontal Continue Reading carousel, Grid / List, ⋮ bottom sheet, a dev-only 320 × 50 banner slot, a bottom tab bar)
while staying the **shared web interface** inside the existing WebView (clarification): a lazily loaded
`screens/Library/phone/MobileLibraryHub.tsx` replaces `LibraryHub` on the phone only and reuses every store, hook,
dialog and import path of `LibraryScreen`. Pure rules (chips incl. new `recent`, the phone Continue Reading pick, Resume
vs Read again, list-row progress) go to core with vitest tests. One new library operation, `library.restartBook`, makes
"Read again" clear the completed status and progress on both hosts. Desktop's Library is unchanged.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19 (shared UI), React Native / Expo host (unchanged)

**Primary Dependencies**: existing only — zustand, react-router (HashRouter), Tailwind v4 classes + `styles/phone.css`,
`@core` (`app-models`, `db/library`, `i18n`). No new package (no NativeWind, no ad SDK).

**Storage**: SQLite `books` via existing stores (Desktop better-sqlite3, Mobile expo-sqlite through the host bridge);
localStorage `reading-book.library.browse-prefs.v1` (unchanged). No migration.

**Testing**: vitest in `source/core/tests` (`npm run sdk:test`) and `source/app/platforms/native/tests`
(`npm run mobile:test`); `npm run check`; manual device pass from `quickstart.md`. No E2E (manual-only rule).

**Target Platform**: Android (Expo native build with local server, WebView); Desktop must stay identical.

**Project Type**: Mobile app (WebView host) sharing the desktop React UI.

**Performance Goals**: Library usable < 2 s with 1 000 books; sheet opens < 300 ms; smooth scroll on a mid-range phone.

**Constraints**: R1–R12 dependency rules; `.native`/`.electron` only via platform adapters; Main changes approved in
`desktop-main-changes.json`; no ad code in this release; theme tokens only.

**Scale/Scope**: 1 screen (+ tab bar), ~9 new UI files, 1 core module, 1 API method on 2 hosts, ~15 i18n keys × 2.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template (no ratified principles). The gates applied are the
project rules from `CLAUDE.md`:

| Gate | Status |
|---|---|
| core stays platform-agnostic (R1–R3): new `library-phone.ts` imports only `LibraryBook` types | ✅ |
| No `.native` / `.electron` import outside `platforms/` (R12): phone UI gated by `isMobileHost()` from `@app/platforms/host` | ✅ |
| `window.api` only in `api.electron.ts` (R9): renderer calls `libraryApi.restartBook` through `bridge/library.ts` | ✅ |
| IPC four places in sync (channels, handler, preload, bridge) for `library:restartBook` | ✅ planned |
| Main-file changes approved (`check:desktop-baseline`) | ✅ planned (5 files listed in contract) |
| Book file never mutated; overlay data only | ✅ (only `books` row columns) |
| Mobile-only store needs a written reason | ✅ none added |
| Desktop unchanged (FR-026) | ✅ separate phone hub; desktop lists (`LIBRARY_BROWSE_FILTERS`, `pickContinueReadingBooks`) untouched |

Post-design re-check: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/013-mobile-library-screen/
├── plan.md              # this file
├── research.md          # R1–R13 decisions
├── data-model.md        # chips, Continue Reading, restart transition
├── quickstart.md        # automated + device validation
├── contracts/
│   ├── library-restart-book.md
│   └── phone-library-ui.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
source/core/src/
├── app-models/library-phone.ts        # NEW: PHONE chip rules (recent), pickPhoneContinueReading, continueAction, listRowProgress
├── app-models/index.ts                # export it
├── db/library/statements.ts           # + restartReading(bookId, now) → [status, json_patch]
└── i18n/catalogue/{en,vi}/library.ts  # + library.phone.*, continue.readAgain, menu.markReading

source/core/tests/
├── app-models/library-phone.test.ts   # NEW
└── db/library-restart.test.ts         # NEW (+ contract fixture in tests/contracts/)

source/app/
├── App.tsx                            # PhoneNav rendered AFTER the content on the Mobile host
├── components/chrome/PhoneNav.tsx     # icons + bottom styling
├── styles/phone.css                   # phone grid columns, carousel snap, content-visibility, tab bar
├── bridge/library.ts                  # + restartBook
├── screens/Library/
│   ├── LibraryScreen.tsx              # isMobileHost() ? <Suspense><MobileLibraryHub/></Suspense> : <LibraryHub/>
│   ├── logic/libraryBrowse.ts         # LibraryBrowseFilter + 'recent'; filterLibraryBooks handles it
│   ├── logic/useLibraryScreen.ts      # + handleReadAgain(bookId)
│   ├── components/book/BookItemMenu.tsx   # phone order, Read again, Mark as reading, header
│   ├── components/book/BookCover.tsx      # loading="lazy" decoding="async"
│   └── phone/                         # NEW, phone only (lazy chunk)
│       ├── MobileLibraryHub.tsx
│       ├── MobileLibraryHeader.tsx
│       ├── PhoneFilterChips.tsx
│       ├── PhoneContinueCarousel.tsx
│       ├── PhoneBrowseToolbar.tsx
│       ├── MobileBookList.tsx
│       ├── MobileLibraryEmptyState.tsx
│       └── AdSlot.tsx
└── platforms/
    ├── electron/ipc/{channels,library.ipc,api-types}.ts, electron/preload.ts,
    │   electron/persistence/sqlite-library-store.ts       # library:restartBook
    └── native/
        ├── bridge/library.ts          # restartBook
        ├── stores/library-store.ts    # restartBook (one transaction)
        └── tests/{stores,bridge}.test.ts

source/scripts/desktop-main-changes.json   # approve the 5 Main files (spec 013 R8)
specs/008-shared-core-architecture/contracts/phone-ui.md   # one row: Library phone hub (spec 013)
```

**Structure Decision**: Shared UI with a phone-only home under `screens/Library/phone/`, mirroring
`screens/Reader/phone/`. No new project, package or host code.

## Phases (for /speckit-tasks)

1. **Core rules + tests** — `library-phone.ts`, `restartReading` statements, tests (TDD).
2. **restartBook on both hosts** — Mobile store/bridge + tests; Desktop channel/handler/preload/store + approval list;
   `bridge/library.ts`.
3. **Shell** — `PhoneNav` to the bottom with icons; `AdSlot`; `LibraryScreen` lazy phone hub; `phone.css`.
4. **US2 Empty state + header** (P1) → **US1 Continue carousel + Read again** (P1) → **US3 chips + Grid/List** (P2)
   → **US4 sheet order** (P2) → **US5 bars / slot** (P3).
5. **i18n (vi/en)**, theme check, `content-visibility`, docs (`CLAUDE.md` Mobile section, phone-ui.md row), `npm run
   check`, device pass (quickstart).

## Risks

| Risk | Mitigation |
|---|---|
| Reading tab keeps the old in-memory position after "Read again" | close the book's tab before `restartBook` (R8); verify in quickstart step 3 |
| 1 000-book scroll stutters in the WebView | `content-visibility`, fixed row height, lazy covers; windowing only if SC-005 fails |
| Moving `PhoneNav` changes the bottom-edge colour reported to the host | colours read from the page edge (`window-system-bars.ts`); tab bar uses `--lib-bg-deep`, checked in quickstart step 6 |
| Push blocked by GitHub secret scanning on `6202feb` (pre-existing) | resolve before opening a PR (allow the public client ID or rewrite that commit) |
