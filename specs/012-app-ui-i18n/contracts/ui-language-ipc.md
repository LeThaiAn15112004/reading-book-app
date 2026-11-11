# Contract: `app:setUiLanguage` (renderer → Main) and Main-side i18n

## Channel

| Place | Change |
|---|---|
| `platforms/electron/ipc/channels.ts` | `AppChannels.setUiLanguage = 'app:setUiLanguage'` |
| `platforms/electron/ipc/app.ipc.ts` (or the existing app handler file) | handler |
| `platforms/electron/preload.ts` + `DesktopApi` in `api-types.ts` | `app.setUiLanguage(preference: UiLanguagePreferenceDto): Promise<SetUiLanguageResultDto>` |
| `source/app/bridge/app.ts` | `setUiLanguage(pref)` wrapper, swallows `NOT_AVAILABLE_ON_PLATFORM` |
| Mobile `platforms/native/bridge/app.ts` | `setUiLanguage: notAvailable(…)` → `NOT_AVAILABLE_ON_PLATFORM` |

```ts
type UiLanguagePreferenceDto = 'system' | 'vi' | 'en'
type SetUiLanguageResultDto = { ok: true; effective: 'vi' | 'en' } | { ok: false; code: 'INVALID_ARGUMENT' | 'WRITE_FAILED' }
```

Handler: validate (anything else → `INVALID_ARGUMENT`, nothing changed) → write `{userData}/ui-language.json`
(`json-prefs-file.ts`; write failure → still apply in memory, answer `WRITE_FAILED`) → resolve with
`app.getPreferredSystemLanguages()` → if the effective language changed, notify Main listeners.

## Main i18n module (`platforms/electron/i18n/main-i18n.ts`)

```ts
export function loadMainUiLanguage(): void            // at app 'ready', before tray / windows / reminder worker
export function getMainUiLanguage(): UiLanguage
export function tMain(key: MessageKey, params?: Params): string
export function onMainUiLanguageChange(listener: (lang: UiLanguage) => void): () => void
```

Consumers (all must use `tMain` at the moment they build the text):

| Surface | Change |
|---|---|
| Tray (`background/background-mode.ts`) | menu built from `tMain`; rebuilt on `onMainUiLanguageChange` (FR-006, US3-AS2) |
| Reading Reminder (`reminders/reminder-schedule.ts`) | title / body from `tMain` when the notification is created |
| `dialog.showOpenDialog` / `showSaveDialog` / `showMessageBox` (7 IPC files) | `title`, `buttonLabel`, `message`, `detail`, `buttons`, filter `name`s |
| IPC `errorMessage` / `message` strings shown to users | `tMain`; codes unchanged (FR-011) |
| Annotation readable export | `buildReadableMarkdown(…, readableLabels(getMainUiLanguage()))` (FR-012) |
| App menu label `app.name` (`main.ts`) | unchanged (brand) |

Every changed Main file is listed in `source/scripts/desktop-main-changes.json` (`check:desktop-baseline`).
Log lines (`console.*`) stay English.
