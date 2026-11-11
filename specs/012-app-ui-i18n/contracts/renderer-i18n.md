# Contract: renderer i18n (`source/app/i18n/`)

Shared by Desktop and the Mobile WebView (no platform suffix needed).

```ts
// uiLanguageStore.ts (zustand)
type UiLanguageState = { language: UiLanguage }
export const useUiLanguageStore: UseBoundStore<StoreApi<UiLanguageState>>
export function initUiLanguage(pref: UiLanguagePreference): void   // called in main.tsx BEFORE React mounts
export function setUiLanguagePreference(pref: UiLanguagePreference): void // called by appAppearanceStore.commit

// useT.ts
export function useT(): Translator            // re-renders on language change
export function getT(): Translator            // non-React code: language at call time
export function useFormat(): { date, dateTime, number, percent, bytes, duration } // bound to the language

// TransText.tsx — rich messages: 'Open <link>Settings</link> to choose…'
<TransText k="settings.hint" params={{…}} slots={{ link: (text) => <a …>{text}</a> }} />
```

Behaviour

1. `main.tsx` calls `initUiLanguage(appearance.language)` in the same synchronous block that applies the theme →
   the first React frame is translated (FR-004).
2. `setUiLanguage(pref)` → `resolveUiLanguage(pref, navigator.languages)` → store update → `<html lang>` → bridge
   `app.setUiLanguage(pref)` (fire-and-forget; `NOT_AVAILABLE_ON_PLATFORM` ignored on Mobile). Also sent once at boot.
3. A language change re-renders subscribed components only; no route change, no remount of the Reader / player.
4. State shown later than it is produced holds a `MessageRef`, rendered with `t(ref.key, ref.params)`.
5. Native `<html lang>` stays set by `applyAppearanceAttributes` (unchanged role).

Lint (`readmate/no-ui-literals`, research R3): JSX text and the attributes `title`, `aria-label`, `placeholder`,
`alt`, `label`, `description`, `message`, `confirmLabel`, `cancelLabel` must not be string literals containing a
letter in folders whose area is no longer pending. Escape: `{/* i18n-ignore: reason */}` / `// i18n-ignore: reason`.

Not translated (FR-009): user data, book content, file names, language names in their own language
(`APP_LANGUAGES` labels "Tiếng Việt" / "English" — but "System Default" IS translated), keyboard key names.
