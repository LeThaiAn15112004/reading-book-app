# Audiobook player on Desktop — implementation map (spec 018)

Spec: `specs/018-audiobook-desktop-ui-polish/` (spec, plan, research R1–R13, contracts, quickstart, tasks).

## Where things are

| Concern | Files |
|---|---|
| Listening session (one store) | `source/app/screens/AudioBook/logic/audioPlayerStore.ts` (`endAudioSession`, `audioSessionBookId`, `selectCanChangeChapter`, mute / volume / speed steps, `pausedAt` + rewind) |
| Session kept on leaving the player | `screens/AudioBook/AudioBookScreen.tsx` (no `dispose` on unmount when `isFeatureAvailable('miniPlayer')`) |
| Session ends | `hooks/app/OpenReadingContext.tsx` (tab close), `screens/Library/logic/useLibraryScreen.ts` (removal) |
| In-app mini bar | `components/audio/MiniPlayerBar.tsx`, `screens/AudioBook/logic/miniPlayerUiStore.ts`, `App.tsx` (mount + bottom padding) |
| Mini bar in the text reader | `components/reader/chrome/readerChromeLayout.ts` (`readerChromeBottomInset`), `screens/Reader/ReaderScreen.tsx`, `screens/Reader/logic/hooks/useReaderChromeUi.ts` (EPUB re-measure) |
| Read Aloud pauses the audiobook | `screens/Reader/logic/readAloud/readAloudStore.ts` |
| State relay renderer ⇄ Main | `screens/AudioBook/logic/miniPlayerSync.ts`, `bridge/miniPlayer.ts`, `platforms/electron/ipc/{channels,api-types,mini-player.ipc}.ts`, `platforms/electron/preload.ts` |
| Floating window (Main) | `platforms/electron/mini-player/{mini-player-rules,mini-player-prefs,mini-player-window,mini-player-relay}.ts`, hooks in `platforms/electron/main.ts` |
| Floating window (renderer) | `main.tsx` (own root), `screens/MiniPlayerWindow/`, adapter `platforms/miniPlayerWindow.{electron,native}.ts` |
| Tray entry | `platforms/electron/background/background-mode.ts` (`setTrayAudiobookEntry` / `setTrayAudiobookToggle`) |
| Settings switch | `screens/Settings/components/notifications/BackgroundTrayCard.tsx`, `screens/Settings/logic/miniPlayerPrefsStore.ts` |
| System media controls | `screens/AudioBook/logic/mediaSessionBridge.ts`; CORS on `platforms/electron/files/cover-protocol.ts` |
| Shortcuts | `shortcuts/shortcutDefinitions.ts` (group / context `audiobook`), `shortcuts/shortcutScreenStore.ts`, `shortcuts/ShortcutsBridge.tsx`, `shortcuts/shortcutKeys.ts`, `screens/ReaderRoute.tsx`, `screens/AudioBook/logic/useAudioPlayerShortcuts.ts` |
| Listening prefs | core `audio/listening-prefs.ts`; `screens/AudioBook/logic/{listeningPrefsStore,skipLengths}.ts`; `components/ListeningMenu.tsx`; reset line in `screens/Settings/logic/resetAppSettings.ts` |
| Notes search / filter | core `app-models/audio-note-filter.ts`; `screens/AudioBook/logic/audioNoteFilterStore.ts`; Notes tab in `components/AudioSidebar.tsx` |
| Layout / visuals | `AudioBookScreen.tsx` (container-query two columns, progress line in Chapter scope), `components/AudioTimeline.tsx` (markers above the track), `components/audio/AudioIcons.tsx`, `screens/Reader/components/sidebar/SidebarTabIcon.tsx` |
| Theme tokens / focus | `styles/theme.css` (`--lib-warning-*`), `index.css` (`focus-ring` utility) |

## Checks

`spike:audio:mini-player`, `spike:settings:shortcuts`, `spike:theme:contrast`, `spike:settings:reset`, SDK
`tests/audio/listening-prefs.test.ts`, `tests/app-models/audio-note-filter.test.ts`, `tests/i18n/glossary-anchors.test.ts`.

## Not verified yet (manual, Windows)

Quickstart rows 5 (media flyout incl. artwork — R7 fallback `miniPlayer:mediaArtwork` not built), 8–11 (floating window
on top of other apps, minimise / tray), and R5 (no throttling of progress saves while the window is hidden).
`spike:audio:store` does not run at all (it already failed before spec 018: its loader cannot import the `.tsx` file
`i18n/TransText`).
