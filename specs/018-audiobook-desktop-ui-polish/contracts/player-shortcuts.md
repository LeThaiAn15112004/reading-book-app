# Contract: player keyboard shortcuts

Added to `source/app/shortcuts/shortcutDefinitions.ts`: group `audiobook` (label key
`settings.keyboard.groups.audiobook`), context `audiobook` (current when the route is `/reader/:bookId` AND
`shortcutScreenStore.readerKind === 'audio'`). All `allowBare: true`.

| Id | Default | allowRepeat | Action (`audioPlayerStore`) |
|---|---|---|---|
| `audiobook.playPause` | `Space` | no | `toggle()` (applies resume rewind) |
| `audiobook.skipBack` | `←` | yes | `skipBy(-skipBackSeconds)` |
| `audiobook.skipForward` | `→` | yes | `skipBy(+skipForwardSeconds)` |
| `audiobook.previousChapter` | `Shift ←` | no | `previousChapter()` — no-op + `false` when disabled |
| `audiobook.nextChapter` | `Shift →` | no | `nextChapter()` — same |
| `audiobook.volumeUp` | `↑` | yes | volume + 0.05 (lifts mute) |
| `audiobook.volumeDown` | `↓` | yes | volume − 0.05 |
| `audiobook.mute` | `M` | no | `toggleMute()` |
| `audiobook.speedDown` | `[` | no | previous `PLAYBACK_RATES` entry |
| `audiobook.speedUp` | `]` | no | next entry |
| `audiobook.addNote` | `B` | no | `addNote()` + open its menu (as the button) |

Dispatch rules (in `ShortcutsBridge`, existing + one new):
1. plain keys never fire in a text field or with a modal open (existing);
2. `Space` / `Enter` never fire on a focused button / link (existing);
3. **new**: arrow keys, Home, End, Page Up / Down never fire when focus is on `input[type=range]`, `[role=slider]`,
   `[role=radiogroup]`, `[role=listbox]`, `[role=menu]` or `[role=separator]` (the sidebar resize handle).

Tooltips use `useShortcutLabel(id)` (FR-007). Catalogue: `settings.keyboard.items.audiobook*` in en + vi.
