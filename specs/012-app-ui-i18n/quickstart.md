# Quickstart: validating the Vietnamese / English interface

## Automated (agent-run; part of `npm run check`)

| Command | Proves |
|---|---|
| `npm run sdk:typecheck` | Vietnamese areas have exactly the English keys (`satisfies`); typed `t()` keys |
| `cd source/core && npx vitest run tests/i18n` | resolveUiLanguage table, translate / plural / fallback / placeholder parity, formatters (vi + en), area-or-pending invariant, glossary anchors, readable-markdown labels |
| `npm run lint` | `readmate/no-ui-literals` finds no hard-coded text in converted folders |
| `npm run typecheck`, `npm run build` | renderer, Main, Mobile WebView compile with the new modules |
| `npm run check:boundaries`, `check:build-split` | core i18n stays pure; no host code crosses |
| `npm run check:desktop-baseline` | every Main change is approved in `desktop-main-changes.json` |
| `npm run spike:i18n:main` | Main: mirror file read / write / invalid → `system`, `app:setUiLanguage` validation, tray template rebuilt in vi / en, reminder text in both languages (stubbed `electron`) |
| **Release gate** `npx vitest run tests/i18n/i18n-release-gate.test.ts` | `PENDING_VI_AREAS` is empty — the feature is releasable |

E2E stays manual-only (CLAUDE.md).

## Manual (`npm run dev`)

1. **Switch live (US1, SC-003)** — open a PDF at page ~20, open Settings → Giao diện → Ngôn ngữ → Tiếng Việt, go
   back: Reader chrome in Vietnamese within 1 s, same page, sidebar state kept. Switch back to English.
2. **Walk-through (SC-001)** — in Tiếng Việt, visit Library (grid + table, empty state, book menu, Import menu and
   dialogs), Reader in EPUB / PDF / TXT / Markdown (toolbar, More menu, sidebars, Translate panel, search,
   annotation menus, export dialogs), Audiobook (player, chapters, Notes, Transcript, ZIP import if flag on),
   every Settings section, Reset App Settings confirmation. Any English interface text = defect (allowed: FR-009).
3. **Restart (FR-004, SC-004)** — with Tiếng Việt saved, quit and start 10 times: the splash / first screen is never
   English.
4. **System Default (US2)** — set Theo hệ thống; start with Windows display language Vietnamese → vi; English or
   French → en.
5. **Outside the window (US3, SC-005)** — enable Run in Background; tray menu in Vietnamese; change to English with
   the window hidden via tray → reopen → tray English without restart. Add file dialog / Export annotations save
   dialog titles in the chosen language. Set a Reading Reminder one minute ahead → notification text in the language.
6. **Formats (US4)** — Library table dates, Settings → Bộ nhớ sizes (`1,5 MB`), audiobook durations, word counts:
   Vietnamese conventions; English singular/plural ("1 book" / "2 books").
7. **Readable export (FR-012)** — export annotations as `.md` in each language: headings "Chương 3" / "Chapter 3";
   import the JSON exported in Vietnamese while in English → same result.
8. **Layout (SC-006)** — minimum window width and the phone layout (`npm run dev:mobile` or the device): no clipped
   or overlapping controls in Vietnamese.
9. **Mobile** — the WebView follows the phone language with Theo hệ thống; Settings switch works live.
