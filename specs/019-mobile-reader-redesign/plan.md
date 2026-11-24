# Implementation Plan: Phone reader — a reading screen made for the phone

**Branch**: `019-mobile-reader-redesign` (work lands on `anle-dev`) | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-mobile-reader-redesign/spec.md`

## Summary

Rebuild the chrome of the phone reader (`MobileReaderScreen`) around the unchanged reading engine: Back closes the
innermost layer, books open with the bars hidden, one slim auto-hiding bottom bar that names the book's real chapter /
place, swipe page turns in the Page view of EPUB and PDF (PDF gains Page / Scroll views on the phone, Page by default),
a phone Appearance panel per format (with the app theme), one-step marking in all four formats (TXT marks newly saved
on the phone), vector icons. Approach (research R1–R13): first a structural phase — one `ReadingSurface` object per
format and one zustand chrome store whose rules are a pure reducer in core — then the stories on top of it. Gestures
are classified by a pure core function shared by EPUB and PDF; the existing Back stack (`useBackClose`), PDF paged flow,
per-book `viewMode` and TXT renderer store are reused. No migration, no new IPC channel, no Main change.

## Technical Context

**Language/Version**: TypeScript ~6.0 (strict), React 19.3

**Primary Dependencies**: Vite 8, Tailwind CSS 4.3, zustand 5, epub.js, pdf.js (existing); Expo / React Native WebView
host unchanged. No new package (icons are inline SVG in the app's existing style).

**Storage**: no SQLite change / migration. Existing per-book `books.reading_state_json` `prefs.viewMode` (now also the
phone PDF view); TXT mark rows in the phone's `notes` table (same shape as Desktop)

**Testing**: vitest — core (`source/core/tests/app-models/reader-gesture.test.ts`, `reader-place.test.ts`,
`phone-reader-chrome.test.ts`, i18n gates) and Mobile (`platforms/native/tests/txt-commit.test.ts`); manual device
quickstart (gesture verify gate R2); Desktop regression by hand; E2E manual-only, not run

**Target Platform**: Android phone (installed app, system WebView); iOS not built. Desktop: shared renderers keep
their behaviour (optional props only) plus real chapter names in bookmarks (Story 6)

**Project Type**: mobile app (Expo host + WebView) sharing one React UI with the Desktop (Electron) app

**Performance Goals**: page follows the finger at 60 fps (transform-only writes, one per animation frame); bars fade in
≤ 200 ms; colour bar ≤ 300 ms after a stable selection; page turn settles ≤ 250 ms

**Constraints**: core pure (R1–R3: gesture / place / chrome rules take numbers, no DOM); no `.electron` import from the
phone code (R7, R12); no Desktop file copied into Mobile; shared renderers change only by optional props; i18n
catalogue + glossary; Desktop Main untouched (`check:desktop-baseline`)

**Scale/Scope**: 6 user stories, 27 FRs (FR-001 – FR-023 incl. 010a, 013a, 013b, 015a); ~20 files changed, ~10 new
(core 3 + tests 3, app phone 6, mobile bridge 1 + test 1)

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template: no ratified principles, so no gate can fail. The project
rules in CLAUDE.md act as gates:

| Rule | How |
|---|---|
| Core purity (R1–R3) | `app-models/reader-gesture.ts`, `reader-place.ts`, `phone-reader-chrome.ts` take plain numbers / objects; no DOM, no React |
| Platform adapters (R7, R8, R12) | phone UI lives in `screens/Reader/phone/**` (shared UI, chosen by `isMobileHost()`); bridge change only in `platforms/native/bridge/txt.ts` + `stores/overlay-store.ts`; no Electron import |
| Never copy logic into the phone reader (spec 008) | the reading surface composes the existing hooks; renderers shared |
| No Mobile-only store without a reason in `contracts/phone-ui.md` | `phoneReaderChromeStore` added there with its reason (Back / auto-hide / swipe need one holder, FR-021) |
| Read-only / overlay invariant | TXT marks are overlay rows; the book file is never written; `txt.commit` refuses `text` |
| Four-place IPC rule | not touched: `txt.commit` already exists in `DesktopApi`; the phone only implements it |
| App preferences | theme through `appAppearanceStore` (existing, resettable); view per book in session state (existing) |
| i18n (spec 012) | new `reader.phone.*` keys in `{en,vi}/reader-phone.ts`; glossary rows first (Trang / Cuộn …) |
| User preference: zustand for custom hooks | chrome state in a zustand store, not `useState` |
| E2E manual-only | vitest + device quickstart |

Post-design re-check: unchanged — no dependency, no migration, no Main change. Main risk: gesture vs selection on the
real WebView (R2 **verify** first, fallback defined).

## Delivery order (from the spec's assumptions and the 2026-11-24 review)

| Phase | Content | Done when |
|---|---|---|
| 0. Structure | core reducer / gesture / place + tests; `phoneReaderChromeStore`; `useReadingSurface`; optional renderer props; rect-less open | screen uses only the surface + store; no stand-ins (SC-009); behaviour unchanged |
| 1. Story 1 — Back | `useBackClose` on every layer | quickstart 3–4 |
| 2. Story 6 — chapter names | `reader-place` wired on phone AND Desktop; `FAKE_CHAPTERS` out of real books | quickstart 13 |
| 3. Story 3 — bars | one-row bottom bar, fade, auto-hide, slider fix, toast inset, icons for bars | quickstart 1–2, 12, 14–17 |
| 4. Story 2 — swipes | **device verify R2 first**; classifier on EPUB frames and PDF paged row; edge taps on the page; PDF Page / Scroll | quickstart D1–D4, 9–11 |
| 5. Story 4 — Appearance | `MobileAppearanceSheet` per format, theme, view, zoom | quickstart 7–8 |
| 6. Story 5 — marking | one-step selection bar; TXT `txt.commit` on the phone; icons for sheets | quickstart 5–6 |

Icons (FR-016) land with the components each phase rewrites (bars in 3, sheets / selection bar in 5–6), not as a
separate pass.

## Project Structure

### Documentation (this feature)

```text
specs/019-mobile-reader-redesign/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── phone-reader-ui.md
│   ├── reading-surface.md
│   └── mobile-txt-commit.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
source/core/src/
├── app-models/
│   ├── reader-gesture.ts          # NEW classifyGesture (R2, FR-003–006, 013b)
│   ├── reader-place.ts            # NEW chapterNameFor, placeFor (R7, FR-010a, 018)
│   ├── phone-reader-chrome.ts     # NEW reduceChrome (R8, FR-008/009/021)
│   └── index.ts                   # exports
├── i18n/catalogue/{en,vi}/reader-phone.ts   # new keys (Page / Scroll, place texts, icon names, show controls)
source/core/tests/app-models/
├── reader-gesture.test.ts         # NEW
├── reader-place.test.ts           # NEW
└── phone-reader-chrome.test.ts    # NEW

source/app/
├── screens/Reader/phone/
│   ├── MobileReaderScreen.tsx     # rewritten on surface + store (≈ 250 lines)
│   ├── logic/
│   │   ├── phoneReaderChromeStore.ts   # NEW zustand (session-only)
│   │   ├── useReadingSurface.ts        # NEW one object per format (FR-020)
│   │   └── usePhonePageGestures.ts     # NEW wires classifier events → turn / bars
│   └── components/
│       ├── MobileReaderBars.tsx        # one-row bottom bar, fade, slider fix
│       ├── MobileAppearanceSheet.tsx   # NEW per-format Aa (replaces AaSettingsPanel on the phone)
│       ├── MobileSelectionBar.tsx      # one step
│       ├── MobileMarkSheet.tsx / MobileMarksSheet.tsx / MobileTocSheet.tsx / MobileSheet.tsx  # Back + icons
│       ├── MobileReaderIcons.tsx       # NEW inline SVG set
│       └── useLiveSelection.ts         # stable-selection timing + textarea selection
├── screens/Reader/logic/hooks/
│   ├── useReaderNavigation.ts     # FAKE_CHAPTERS only for the demo surface
│   ├── useReaderHighlights.ts     # + openHighlightById (rect-less)
│   └── useReaderPdfHighlights.ts / useReaderMdHighlights.ts   # rect optional
├── screens/Reader/ReaderScreen.tsx       # chapterLabel from reader-place (Story 6)
├── components/reader/renderers/
│   ├── epub/EpubRenderer.tsx      # optional swipePaging; Desktop-only props optional
│   ├── pdf/PdfRenderer.tsx        # optional swipePaging in paged flow; zoom edge report
│   ├── txt/TxtRenderer.tsx        # editing props optional; selection report for one-step marking
│   └── md/MdRenderer.tsx          # insert / hover props optional
└── platforms/native/
    ├── bridge/txt.ts              # commit (annotations only)
    ├── stores/overlay-store.ts    # commitTxtAnnotations (one transaction)
    └── tests/txt-commit.test.ts   # NEW

specs/008-shared-core-architecture/contracts/phone-ui.md   # + phoneReaderChromeStore reason
specs/012-app-ui-i18n/contracts/glossary.md                # + rows
```

**Structure Decision**: single repository, shared UI. Phone-only UI stays under `screens/Reader/phone/`; pure rules go
to `source/core/src/app-models/`; the only host-side change is the Mobile bridge's TXT commit.

## Risks

| Risk | Mitigation |
|---|---|
| Swipe vs long-press selection on the real WebView (R2) | device verify gate before Story 2 code; fallback = slide on release |
| epub.js re-layout while the host is translated | translate only the outer host, never the iframe or `scrollLeft`; reset transform before `next()` |
| PDF Page view memory on large PDFs | paged flow renders one spread (existing); fit-page zoom keeps canvases screen-sized |
| Desktop regressions from shared renderer props | props optional with Desktop's current values as the behaviour when passed; quickstart Desktop regression |
| TXT marks written while text revision differs | phone revision is always 0; commit refuses `text` and other revisions |

## Complexity Tracking

None — no constitution violation to justify.
