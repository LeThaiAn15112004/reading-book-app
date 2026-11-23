# Contract: mini player IPC (Desktop only)

New channel group `MiniPlayerChannels` in `platforms/electron/ipc/channels.ts`, handler
`platforms/electron/ipc/mini-player.ipc.ts`, preload + `DesktopApi.miniPlayer` in `api-types.ts`, renderer wrapper
`bridge/miniPlayer.ts` (the four-place rule). The floating window has its own preload exposing only
`window.miniPlayerWindow` (below). Mobile: `miniPlayer` group answers `NOT_AVAILABLE_ON_PLATFORM`.

## Main renderer → Main

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `miniPlayer:publishState` | `MiniPlayerStateDto \| null` | `void` | `null` = no session (ends tray entry, closes the floating window). Throttled by the sender to ≤ 4/s while playing, immediate on any non-position change. Main validates shape and lengths (title ≤ 500 chars) and drops invalid payloads. |
| `miniPlayer:open` | `{}` | `{ ok: true } \| { ok: false, code: 'no_session' }` | "Pop out" from the in-app bar. Marks `openedAutomatically = false`. |
| `miniPlayer:getPrefs` | `{}` | `MiniPlayerPrefsDto` | for Settings |
| `miniPlayer:setPrefs` | `Partial<MiniPlayerPrefsDto>` | `MiniPlayerPrefsDto` | only `autoOpen` is settable from the renderer |

## Main → main renderer

| Channel | Payload | Meaning |
|---|---|---|
| `miniPlayer:command` | `MiniPlayerCommandDto` | run on `audioPlayerStore` (from the floating window or the tray) |
| `miniPlayer:windowChanged` | `{ open: boolean }` | the in-app bar hides while the floating window is open |

## Floating window ↔ Main (`window.miniPlayerWindow`)

| Method / event | Payload | Meaning |
|---|---|---|
| `onState(cb)` | `MiniPlayerStateDto \| null` | last state on subscribe, then every update |
| `command(cmd)` | `MiniPlayerCommandDto` | forwarded to the main renderer |
| `returnToApp()` | — | close floating window, `win.show()` + `focus()`; playback continues |
| `close()` | — | forward `{ type: 'endSession' }` then close; sets `closedByUserThisSession` |
| drag | — | `-webkit-app-region: drag` on the window body (buttons `no-drag`); Main saves `x, y` on `moved` (debounced 500 ms) |

## DTOs

```ts
type MiniPlayerStateDto = {
  bookId: string
  title: string            // book title
  subtitle: string | null  // current chapter / track title
  author: string | null
  coverUrl: string | null  // rb-cover:// URL already given to the renderer
  playing: boolean
  status: 'ready' | 'switching' | 'trackFailed'
  positionSeconds: number  // in the shown scope (track for multi-track, else whole file)
  durationSeconds: number | null
  skipBackSeconds: number
  skipForwardSeconds: number
  canPrevious: boolean
  canNext: boolean
  theme: 'night' | 'sepia' | 'paper'
  uiLanguage: 'en' | 'vi'
}

type MiniPlayerCommandDto =
  | { type: 'toggle' } | { type: 'play' } | { type: 'pause' }
  | { type: 'skipBack' } | { type: 'skipForward' }
  | { type: 'previous' } | { type: 'next' }
  | { type: 'seek'; positionSeconds: number }   // clamped by the store
  | { type: 'openPlayer' }                       // navigate to /reader/<bookId>
  | { type: 'endSession' }                       // dispose()

type MiniPlayerPrefsDto = { autoOpen: boolean }
```

## Main rules

- Floating window is a singleton; `open` while open = focus it.
- `minimize` / `hide` of the main window with `sessionActive && autoOpen && !closedByUserThisSession` → open,
  `openedAutomatically = true`; `restore` / `show` → close if `openedAutomatically`.
- `publishState(null)` → close the floating window, drop the tray entry, reset `closedByUserThisSession`.
- Tray: entry rebuilt only when `playing`, `title` or the language change.
- Every changed Main file gets an approval line in `source/scripts/desktop-main-changes.json`.
