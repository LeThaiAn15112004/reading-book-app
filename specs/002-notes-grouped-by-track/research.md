# Research: Notes Grouped by Track

All unknowns from the Technical Context were resolved by reading the repository (2026-10-25). No external research was needed; there are no new dependencies. Each entry: Decision / Rationale / Alternatives.

## R1. Where does the grouping logic live?

- **Decision**: A pure function `groupNotesByTrack(notes, tracks)` in the SDK file `src/audio/audio-track-notes.ts`, exported from `audio/index.ts`.
- **Rationale**: The desktop has no component test runner; only the SDK has unit tests. Putting the decision (which tracks, what order, what count) in a pure function makes it testable and keeps the JSX trivial. It sits next to `orderTrackNotes`, which it builds on.
- **Alternatives**: Group inline in the component with `useMemo` — untestable here and easy to get subtly wrong (ties, duplicates). Rejected. Group inside `audioPlayerStore` and keep a second derived array in state — duplicates data that can go stale. Rejected.

## R2. Where does the open/closed state live?

- **Decision**: A new small zustand store, `audioNoteGroupsStore`, with an in-memory `open` map for the current audiobook. It is not persisted.
- **Rationale**: Spec FR-016 requires the state to survive closing and reopening the Notes tab or the sidebar. `AudioSidebarPanel` returns `null` when closed and `PanelBody` swaps components per tab, so React component state is destroyed in exactly those cases. A store outside React survives. The project prefers zustand for custom hooks.
- **Alternatives**: `useState` inside `NotesTab` — lost on close. Rejected. Put the map in `audioPlayerStore` — mixes presentation state into the playback store and widens the change to the largest, riskiest file. Rejected. `localStorage` — FR-016 says not across restarts, and it would add a key that Settings → Reset would have to know about. Rejected.

## R3. How is state kept "per audiobook" and "not across restarts"?

- **Decision**: The store holds state for ONE audiobook at a time and clears itself whenever `audioPlayerStore.bookId` changes (a subscription), which also happens when the player is disposed and the same book is opened again.
- **Rationale**: Matches "kept while the audiobook stays open" and "not applied to another audiobook" with the smallest mechanism; no map keyed by book id that could grow or leak.
- **Alternatives**: A map keyed by `bookId` that keeps every book's choices for the whole app run — would carry a closed audiobook's choices into a later reopening of it, which the spec does not ask for and which would need eviction. Rejected.

## R4. How does "add a Note opens its row" work from the "+ Note" pill when the Notes tab is not mounted?

- **Decision**: A new field `lastAddedNote: { id, trackId } | null` in `audioPlayerStore`, assigned (a new object) only in the multi-track branch of `addNote` and reset in `INITIAL`. The groups store subscribes to the player store and opens `trackId`'s row when the field changes to a non-null value.
- **Rationale**: Both entry points (`AudioControls`' pill and the tab's button) call the same `addNote`, so one signal covers both, with the sidebar closed or open. Nothing else writes the field, so `load`, `reloadNotes`, edit, delete and jumps cannot trigger it.
- **Alternatives**: Open the row in each button's `onClick` — misses any future caller and would need two edits. Rejected. Diff `notes` for new ids — fires on `load` (list goes `[] → N`) and on a refused-save reload. Rejected. Make `addNote` call the groups store directly — couples the playback store to a UI store. Rejected.

## R5. When is the default state applied?

- **Decision**: `ensureSeeded(currentTrackId)` is called when the multi-track Notes tab mounts. The first call per audiobook marks the store `seeded` and opens the playing track's row (if that track has Notes it is shown; if not, nothing visible changes). Later calls do nothing.
- **Rationale**: FR-009 says "the first time the Notes tab is shown for an audiobook in a listening session". Seeding at tab mount (not at book load) means the row that opens is the track playing *when the tab is first shown*, which is what the listener expects. Seeding only *adds* to the map, so a row opened earlier by "add a Note" is kept.
- **Alternatives**: Seed at `load()` — the playing track at load may not be the one playing when the tab is first opened. Rejected. Re-seed on every tab mount — would reopen rows the listener closed (violates FR-005/016). Rejected. Follow the playing track continuously — violates FR-015. Rejected.

## R6. How is the current track marked without re-rendering on every tick?

- **Decision**: Select `tracks[trackIndex]?.id` (a string) from the player store in each row header (or once in `NotesTab` and pass it down) and compare with the row's `trackId`.
- **Rationale**: A primitive selector changes only when the track changes. Position ticks do not re-render the header (the Note cards already use boolean selectors for "Here").
- **Alternatives**: Subscribe to `positionSeconds` — re-renders every row on every tick. Rejected.

## R7. What does a closed row render, and does an open row need virtualisation?

- **Decision**: A closed row renders only its header. An open row renders its `NoteCard`s as a plain list. No virtualisation.
- **Rationale**: SC-005 — worst realistic cases are 68 groups, or 500 Notes in one row. 68 headers are trivial; 500 lightweight cards in one open row is the same load as today's flat list of 500, which feature 001 accepted. A virtual list would be a new dependency or custom code for a case that is already as good as before.
- **Alternatives**: Virtualise with a library — new dependency. Rejected. `content-visibility: auto` on cards — kept as a one-line fallback if the manual check shows jank. Not applied up front.

## R8. Does a Note inside a row repeat its track?

- **Decision**: No. The `NoteCard` in a group is given no track caption (the header names the track). The Note menu header still shows the track label.
- **Rationale**: Spec Assumption: the row already names the track; repeating "12 · Title" on every card wastes space the grouping is meant to save. The menu is opened from several places (markers included), so it keeps naming the track.
- **Alternatives**: Keep the caption on every card — redundant. Rejected.

## R9. What happens to rows when the Notes become unavailable or empty?

- **Decision**: Unchanged states win: `notesUnavailable` shows the existing message instead of rows; an empty `notes` shows the existing empty state. Open-state entries are kept as they are.
- **Rationale**: FR-004. Re-seeding is not needed when Notes come back, because `seeded` stays true.
- **Alternatives**: Reset the store when Notes become unavailable — would discard the listener's choices for a transient state. Rejected.

## R10. Open-state entries of tracks that lose all Notes

- **Decision**: Leave them. They have no visible effect while the track has no Notes.
- **Rationale**: If a Note is added to that track later, the row is opened anyway by the add signal (R4); cleaning up would add code for no observable difference.
- **Alternatives**: Delete the entry when the last Note of a track is removed — extra subscription logic for nothing. Rejected.

## R11. Accessibility

- **Decision**: The row header is a native `<button>` with `aria-expanded` and `aria-controls`; its accessible name carries the track number, title and Note count; focus stays on the header when it toggles. The open region is a list with an accessible label.
- **Rationale**: FR-020. A native button gives Enter/Space and focus handling without custom key code.
- **Alternatives**: `<details>/<summary>` — it would keep its own open state in the DOM, which is lost when the panel unmounts and cannot be driven from the store. Rejected.

## R12. How is this verified without a component runner?

- **Decision**: SDK vitest for the grouping; `spike:audio:store` for the groups store and the player-store signal; the JSX stays a thin mapping from those; the visual and keyboard behaviour goes into the manual script.
- **Rationale**: It is the pattern feature 001 used and the only automated option the project has for the renderer.
- **Alternatives**: Add a component test runner — a new dependency and a project-wide decision. Out of scope. Rejected.
