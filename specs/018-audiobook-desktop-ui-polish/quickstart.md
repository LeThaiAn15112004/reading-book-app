# Quickstart: validating spec 018

Prerequisites: `npm install` at the repo root; one single-file audiobook WITH chapters (MP3 with ID3 CHAP), one
without a cover, and (flag on in a dev build) one multi-track book with a damaged track.

## Automated (default checks — no E2E)

```bash
npm run sdk:test            # listening-prefs, resume rewind, audio-note-filter, i18n gate / glossary anchors
npm run typecheck && npm run lint && npm run e2e:typecheck
npm run check:boundaries && npm run check:platform-adapters && npm run check:build-split
npm run spike:theme:contrast        # incl. warning + focus pairs in Night / Sepia / Paper (SC-001)
npm run spike:audio:store           # session survives unmount; dispose paths; pausedAt / rewind; mute
npm run spike:audio:mini-player     # NEW: Main relay + prefs + auto-open rules with a stubbed electron
npm run check:desktop-baseline      # Main changes approved
```

## Manual (Windows, `npm run dev`)

| # | Steps | Expected | Spec |
|---|---|---|---|
| 1 | Paper theme, open the multi-track book, play the damaged track | notice readable, buttons visible | US1, SC-001 |
| 2 | Tab through the whole player and sidebar | every control shows the focus ring; mouse click leaves none | US1, SC-002 |
| 3 | Press Space, ←, →, Shift+→, ↑, ↓, M, [, ], B | each action; focus the timeline then ← moves the slider only | US2, FR-006 |
| 4 | Settings → Keyboard Shortcuts: rebind skip forward to `L` | `L` works at once, `→` no longer; tooltip shows `L` | SC-003 |
| 5 | Play, open the Windows media flyout; change chapter | title / chapter / author / cover within 2 s; ⏯ ⏭ work | US3, SC-004 |
| 6 | Go to Library, Settings, then open an EPUB | no gap; mini bar within 1 s; EPUB text not under the bar (paged + scroll) | US5, SC-008, SC-010 |
| 7 | In the EPUB start Read Aloud | audiobook pauses, stays paused | FR-024 |
| 8 | Pop out; switch to another app; use ↺ ⏯ ↻; drag it; Return to app | stays on top; controls work; position remembered | SC-009 |
| 9 | Minimise the main window; restore it | floating window opens / closes by itself | FR-025 |
| 10 | Close to tray (Run in Background on); tray menu Pause | floating window opens; tray pause works | FR-025, FR-026 |
| 11 | Close the floating window, minimise again | it does not reopen this session | FR-025 |
| 12 | Set skip 10 / 60, restart the app | buttons read 10 / 60 | US4-7 |
| 13 | Pause 20 min (or fake clock in the spike), resume | resumes 5 s earlier; off → no rewind | US4-8 |
| 14 | Resize the window 800 → 1920 px, open / close sidebar | one / two columns per FR-032, no overlap | SC-011 |
| 15 | Notes: search a Vietnamese word without accents; filter a chapter | matching Notes, count, Clear | US4-11 |
| 16 | Turn on "reduce motion" in Windows | no slide / scale animations | FR-017 |
| 17 | Remove the playing book from the Library | session ends first, mini bar gone | Edge |

E2E specs (`npm run e2e`) only on request — not part of this validation.
