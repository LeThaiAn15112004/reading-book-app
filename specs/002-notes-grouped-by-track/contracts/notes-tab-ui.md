# Contract: grouped Notes tab (renderer)

No IPC, no Main change. This contract fixes the renderer-side pieces so tasks and tests can be written against it.

## Player store — one new field

`audioPlayerStore.lastAddedNote: { id: string; trackId: string } | null`

- Set (as a **new object**) only by `addNote` in a multi-track audiobook, in the same synchronous step that creates the Note.
- `null` in `INITIAL`, therefore also after `load`/`dispose`; never set for single-file audiobooks.
- Not set by edit, delete, `reloadNotes`, jumps or the 500-Note refusal (no Note is created then).
- No other behaviour of the player store changes.

## Groups store — `audioNoteGroupsStore` (new, `src/screens/AudioBook/logic/audioNoteGroupsStore.ts`)

State: `open: Record<string, true>`, `seeded: boolean`.

| Action | Behaviour |
|---|---|
| `ensureSeeded(currentTrackId: string \| undefined)` | If `seeded`: no change. Else `seeded = true` and, when `currentTrackId` is defined, `open[currentTrackId] = true`. Existing `open` entries are kept. |
| `toggle(trackId)` | Flips only that track's entry. |
| `isOpen(trackId)` (selector) | `open[trackId] === true`. |
| `reset()` | `open = {}`, `seeded = false`. |

Wiring (module level, once):
- Subscribes to `audioPlayerStore`: when `bookId` changes → `reset()`; when `lastAddedNote` changes to a non-null value → `open[trackId] = true`.
- Does **not** subscribe to `trackIndex`, `positionSeconds`, `notes` or `tracks`.

## `NotesTab` — multi-track branch (`AudioSidebar.tsx`)

1. If `notesUnavailable` → the existing "could not be loaded" message (no rows).
2. Else if there are no Notes → the existing empty state (no rows).
3. Else `groupNotesByTrack(notes, tracks)` (memoised on `notes`, `tracks`) → a list of rows. On mount calls `ensureSeeded(currentTrackId)`.
4. The "+ Note at current position" button above the list is unchanged (disabled rules from feature 001 stay).

### Row

- Header: a `<button type="button">` that toggles the row. Shows the track number (two digits, as the Contents list), the track title (truncated, full title as `title`), a count pill, and a "Playing" pill when `trackId` is the player's current track. A chevron shows the state.
- Accessibility: `aria-expanded`, `aria-controls` → the id of the Notes list, `aria-current="true"` on the playing row; accessible name like "Track 12, <title>, 3 notes" (singular "1 note"). Focus remains on the header after toggling.
- Closed: only the header is rendered.
- Open: `<ul aria-label="Notes in <title>">` of the existing `NoteCard` for each Note of the group, in the group's order. `NoteCard` receives **no track caption** in this mode (the position is the Note's time inside the track).

### Unchanged on purpose

`NoteCard` behaviour (click = `goToNote`, ⋮ = shared Note menu, "Here" highlight rule that requires the Note's track to be the current one), `AudioNoteMenu`, `AudioTimeline` markers, `AudioControls`, the single-file branch of `NotesTab`.
