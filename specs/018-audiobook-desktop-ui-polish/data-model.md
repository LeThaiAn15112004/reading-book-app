# Data model: spec 018

No SQLite change, no migration. Listening progress, speed (per book, `reading_state_json.audioProgress`) and Notes
(`audioBookmarks`) are stored exactly as today.

## Listening session (in memory — `audioPlayerStore`)

Existing state, unchanged meaning; new lifecycle (research R1):

| State | Enters on | Leaves on |
|---|---|---|
| none (`bookId = null`) | app start, `dispose()` | `load(bookId)` |
| active | `load(bookId)` resolves `ready` | `dispose()`: mini bar ✕, floating ✕, `load(otherId)`, book removed, its open-book tab closed, quit flush |

Rules: at most one session; leaving the player route does NOT leave `active`; `dispose()` always persists progress
first (`persist(true)`), then clears the media session and tells Main `sessionActive = false`.

New fields:

| Field | Type | Rule |
|---|---|---|
| `pausedAt` | `number \| null` (ms epoch) | set on every pause (button, key, media key, sleep timer, Read Aloud); cleared by seek / Note jump / track switch |
| `muted` | `boolean` | mirrors listening prefs |

## Listening preferences (renderer `localStorage` `readmate.audioListeningPrefs.v1`)

| Field | Type | Default | Validation (`normalizeListeningPrefs`) |
|---|---|---|---|
| `skipBackSeconds` | `5 \| 10 \| 15 \| 30 \| 60` | 15 | other → default |
| `skipForwardSeconds` | same | 30 | other → default |
| `autoRewind` | `boolean` | `true` | non-boolean → default |
| `muted` | `boolean` | `false` | |
| `volumeBeforeMute` | `number` 0–1 | 1 | clamped; used to restore |

Reset by Settings → Advanced → Reset App Settings (new `APP_SETTINGS_RESETTERS` line). Volume itself stays in
`readmate.audioVolume.v1`.

## Resume rewind (pure, core)

`resumeRewindSeconds(pausedForMs)`: `< 60 000` → 0; `< 600 000` → 3; `< 3 600 000` → 5; else 10.
`applyResumeRewind(position, pausedForMs, floorSeconds) = max(floorSeconds, position − resumeRewindSeconds(...))`;
floor = current chapter start (validated chapters), else 0 (current track for multi-track).

## Floating window preferences (Main, `{userData}/mini-player-prefs.json`)

| Field | Type | Default | Rule |
|---|---|---|---|
| `x`, `y` | `number \| null` | `null` (bottom-right of the primary work area, 24 px margin) | moved onto a visible display if outside every work area |
| `autoOpen` | `boolean` | `true` | Settings → General → Background ("Show the floating player when the window is minimised or hidden") |

Main session-only flags (not stored): `sessionActive`, `openedAutomatically`, `closedByUserThisSession` (reset when
a new session starts).

## Player shortcut (renderer, existing `shortcutsStore` overrides)

New `ShortcutDefinition`s, group / context `audiobook` — see `contracts/player-shortcuts.md`.

## Notes filter (session-only `audioNoteFilterStore`)

`{ bookId, query: string, chapterId: string | null, groupByChapter: boolean }`; cleared when the player's `bookId`
changes; kept while the sidebar closes / reopens.

## Mini player state DTO (crosses IPC; plain data)

See `contracts/mini-player-ipc.md` (`MiniPlayerStateDto`).
