# Contract: renderer i18n (`source/app/i18n/`)

Shared by Desktop and the Mobile WebView (no platform suffix needed).

```ts
// uiLanguageStore.ts (zustand)
type UiLanguageState = { language: UiLanguage }
export const useUiLanguageStore: UseBoundStore<StoreApi<UiLanguageState>>
// Derived from useAppAppearanceStore.language (subscription) — no init / setter to call.
export function getUiLanguage(): UiLanguage
export function deviceLocales(): readonly string[]          // navigator.languages, else [navigator.language]

// useT.ts
export function useT(): Translator            // re-renders on language change
export function getT(): Translator            // non-React code: language at call time
export function useFormat(): { date, dateTime, number, percent, bytes, duration } // bound to the language

// TransText.tsx — rich messages: 'Open <link>Settings</link> to choose…'
<TransText k="settings.hint" params={{…}} slots={{ link: (text) => <a …>{text}</a> }} />
```

Behaviour

1. The appearance store reads localStorage synchronously when its module loads; the i18n store derives from it at
   creation → the first React frame is translated (FR-004).
2. Preference change (Settings, Reset App Settings) → subscription → `resolveUiLanguage(pref, deviceLocales())` →
   store update. `AppAppearanceBridge` sets `<html lang>` and calls bridge `appApi.setUiLanguage(pref)` once at start
   and on every change (never rejects; `NOT_AVAILABLE_ON_PLATFORM` on Mobile is ignored).
3. A language change re-renders subscribed components only; no route change, no remount of the Reader / player.
4. State shown later than it is produced holds a `MessageRef`, rendered with `t(ref.key, ref.params)`.
5. Native `<html lang>` stays set by `applyAppearanceAttributes` (unchanged role).

Lint (`readmate/no-ui-literals`, research R3): JSX text and the attributes `title`, `aria-label`, `placeholder`,
`alt`, `label`, `description`, `message`, `confirmLabel`, `cancelLabel` must not be string literals containing a
letter, in every file under `screens/`, `components/`, `hooks/` and `App.tsx` except files whose first line is
`/* i18n-pending: <area> */` (removed when the area is converted; none may remain at release). Escape: `{/* i18n-ignore: reason */}` / `// i18n-ignore: reason`.

Not translated (FR-009): user data, book content, file names, language names in their own language
(`APP_LANGUAGES` labels "Tiếng Việt" / "English" — but "System Default" IS translated), keyboard key names.
