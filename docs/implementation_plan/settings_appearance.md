# Settings — sidebar navigation & Appearance (SCR-06)

Status: implemented — Appearance (including App Language) and About. Other sections are
navigation placeholders.

## Layout

```
┌───────────────────┬──────────────────────────────────────────┐
│ Settings      [<] │  Appearance                              │
│                   │  Theme, accent color and density…        │
│ ▌Appearance       ├──────────────────────────────────────────┤
│  Library          │  App Theme     [Light][Dark][Sepia][Sys] │
│  Storage          │  Accent Color  ● ● ● ● ● ● ●             │
│  Notifications    │  UI Density    [Comfortable][Balanced]…  │
│  Keyboard …       │  Language      [System][Tiếng Việt][En]  │
│  Privacy          │                                          │
│  Advanced         │                                          │
│  About            │                                          │
└───────────────────┴──────────────────────────────────────────┘
```

- Route stays `/settings` (`src/screens/Settings/SettingsScreen.tsx`); the global menubar and Library
  navigation are unchanged.
- `SettingsSidebar` (left) + content panel (`<main>`: section header + scrollable body, max width 3xl).
- The active section lives in the zustand store `useSettingsNavStore`
  (`src/screens/Settings/logic/settingsNavStore.ts`); `appearance` is the default. It is not put in
  the URL (single route, no deep-linking need yet).

## Sidebar navigation

| Id | Label | Content |
|---|---|---|
| `appearance` | Appearance | `AppearanceSettings` (incl. App Language) |
| `library` | Library | placeholder |
| `storage` | Storage | placeholder |
| `notifications` | Notifications | placeholder |
| `keyboard` | Keyboard Shortcuts | placeholder |
| `privacy` | Privacy | placeholder |
| `advanced` | Advanced | placeholder |
| `about` | About | `AboutSettings` (see *About* below) |

Placeholder sections keep their active state and show *"This settings section is not implemented
yet."* (`SettingsPlaceholder`). To add a section: add the id + label to `SETTINGS_SECTIONS`, an icon
path in `SettingsSectionIcon`, and render its component in `SettingsScreen`.

**Language was merged into Appearance.** The former `language` sidebar item (and its placeholder)
was removed — there is no Language section id, route or icon any more.

### Collapsed / expanded

- Toggle button (chevron) in the sidebar header; `aria-expanded` + label "Collapse/Expand settings
  sidebar".
- Expanded `232px` (icon + label); collapsed `60px` (icon only). Width animates (`transition-[width]`,
  200 ms); the content panel is `flex-1 min-w-0`, so it takes the freed space without overflow.
- Collapsed items keep `aria-label` and get a native tooltip (`title`); the active item keeps its
  accent background + left indicator bar. All items are `<button>`s with a visible
  `focus-visible` outline and `aria-current="page"` on the active one.
- The collapsed state is persisted in `localStorage` (`reading-book.settings.sidebar-collapsed`),
  like other panel preferences in the app (Reader sidebar width, Library shelf order).

## Appearance (global app appearance)

State: zustand `useAppAppearanceStore` (`src/theme/appAppearanceStore.ts`), model and helpers in
`src/theme/appAppearance.ts`, persisted to `localStorage` key `reading-book.app-appearance.v1`.

| Setting | Values | How it is applied |
|---|---|---|
| App Theme | Light · Dark · Sepia · System | Resolved to the existing theme ids (Light→`paper`, Dark→`night`, Sepia→`sepia`, System→`paper`/`night` from `prefers-color-scheme`) and written to `GlobalReadingPrefs.theme`, which already drives `html[data-theme]` + the Electron caption buttons + the reading page. |
| Accent Color | Blue · Purple · Green · Cyan · Orange · Red · Slate | `html[data-accent]`; `styles/appearance.css` overrides `--accent` / `--lib-accent*` (darker shades on Paper for contrast). Orange = the built-in amber of every theme (no override, default). |
| UI Density | Comfortable · Balanced · Compact | `html[data-density]`; `styles/appearance.css` defines `--ui-density-row/gap/pad/content-x/content-y`. Default Balanced. |
| Language → App Language | System Default · Tiếng Việt · English | Stored as `language: 'system' \| 'vi' \| 'en'` (default `system`). Sets `<html lang>` (System → `vi` when `navigator.language` starts with `vi`, else `en`). See *App Language* below. |

- `AppAppearanceBridge` (`src/chrome/AppAppearanceBridge.tsx`, mounted inside
  `GlobalReadingPrefsProvider`) keeps the resolved theme in sync, follows OS light/dark changes
  while in System mode, and applies the accent/density attributes.
- `main.tsx` applies theme/accent/density before React mounts (no flash).
- First run: when no appearance is stored, the theme mode is derived from the existing
  `GlobalReadingPrefs.theme` (night→Dark, paper→Light, sepia→Sepia), so users keep their theme.
- Sepia is kept as a fourth theme card because the app already shipped it (Night/Sepia/Paper);
  dropping it would remove an existing option.
- Selected state: theme cards get accent border + ring + filled check; swatches get a ring + check;
  density options get accent border/background. Each group is a `radiogroup` of `radio` buttons
  with `aria-checked`.
- Density is consumed only by the Settings screen for now (sidebar row height, card padding,
  content padding/gaps). Other screens do not read the `--ui-density-*` variables yet.

## App Language

- Lives in the **Language** card at the end of Appearance (after UI Density). It is the only
  language setting in global Settings.
- Scope: the language of the app interface (menus, Settings, Library, dialogs, toasts, tooltips).
  It never changes book content.
- **Not here:** translation source/target language and book language. Translate already lets the
  user pick source and target languages in the Reader's Translate panel, so they stay there.
- **Current limitation:** the app has no i18n/translation layer yet. Choosing a language is
  persisted and sets `<html lang>`, but all UI strings are still hard-coded in English — switching
  to Tiếng Việt does not translate the interface yet. Wiring UI strings to this setting is a
  separate task.

## About (Readmate Reader)

`src/screens/Settings/components/about/AboutSettings.tsx`, header subtitle *"Information about
Readmate Reader."* Five cards, all built on the shared `SettingsCard` (also used by Appearance):

| Card | Content | State |
|---|---|---|
| App Information | App Name **Readmate Reader**, Version **0.0.0** | Static text |
| Updates | Current Version 0.0.0 + **Check for Updates** button | Button disabled, note *"Update checking is not available in this build yet."* |
| Legal | Privacy Policy · Terms of Service · Open Source Licenses · Third-Party Notices | Rows disabled — *Not available yet* |
| Support | Help / Documentation · Report a Problem · Contact Support | Rows disabled — *Not available yet* |
| Links | Official Website · Store Page | Rows disabled — *Not available yet* |

- Version is a fixed constant (`0.0.0`) on purpose: the renderer has no display-version source
  yet (no IPC exposes `app.getVersion()` for this), so it is not read from package.json/Electron.
- List rows use the Settings list style (label + chevron, hover/focus states). Each row has a
  `destination` that is `null` today; a row without a destination renders as a disabled button
  with a *Not available yet* badge and tooltip. No URLs, emails or store links were invented —
  rows become active once official destinations exist.
- Not built (no backend/infrastructure in the project yet): app icon, update service /
  auto-update, Privacy Policy and Terms content, license viewer / license data, support or
  bug-report backend, support email, official website and Store page URLs.
- Naming note: `electron-builder.json5` `productName` is `ReadMate Reader` (capital M) and the
  title bar uses `APP_DISPLAY_NAME = 'Readmate'`; the About page shows the official
  `Readmate Reader`. Those other strings were not changed in this task.

## Deliberately not in global Settings

Per-book / reader settings stay in the Reader (Aa panel in the right sidebar) and are **not** part
of Appearance: EPUB font family/size/weight/line height, text align, margins, page layout, view
mode, PDF zoom/page layout, reading position, book-specific theme, annotation settings.

The old Settings card *"Appearance"* also contained **reading defaults** (font, size, weight, line
height, page layout, text align for books without overrides). That card was removed with this
change; the defaults themselves still exist in `GlobalReadingPrefs` and still apply, but there is
currently no UI to edit them. They belong in a future Reader/Book defaults section.

## Not implemented (placeholders)

Library, Storage, Notifications, Keyboard Shortcuts, Privacy, Advanced — plus
EPUB/PDF reading settings, annotation settings and cloud settings.
