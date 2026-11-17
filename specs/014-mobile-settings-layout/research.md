# Research: Mobile Settings screen layout (spec 014)

All Technical Context items were resolvable from the codebase; no NEEDS CLARIFICATION remained. Each decision below
cites the code it relies on.

## R1 — List ⇄ section navigation: router entries, not component state

- **Decision**: one route `/settings/:section?`. `/settings` is the list; `/settings/:section` (e.g. `/settings/appearance`)
  is a section page. Opening a row is `navigate('/settings/<id>')` (push); the header back control is
  `navigate(-1)` when the previous entry is the list, else `navigate('/settings', { replace: true })`. An unknown or
  phone-hidden `:section` redirects (replace) to `/settings`.
- **Rationale**: Android Back already becomes `window.history.back()` while the WebView can go back
  (`platforms/native/host/lifecycle.ts:50`, `bridge/app.ts:38`), and `HashRouter` pushes history entries (`App.tsx:61`).
  A route per page gives FR-005 for free and keeps Back at the list "as today" (top-level tab). Desktop ignores the
  parameter (its sidebar keeps using `settingsNavStore.activeSection`), so Desktop is unchanged.
- **Alternatives**: a `phoneSection` value in a store + `popstate` handling (re-implements history; fragile with
  dialogs); nested `<Routes>` per section (no benefit over one optional param).

## R2 — Tab "More" always lands on the list

- **Decision**: the More tab and the Desktop menubar keep calling `navigate('/settings')`; when the current path is already
  under `/settings` the phone tab uses `replace` so Back does not return to the abandoned section. After a launch the
  route is `/library` (Splash) so the list is the first Settings page anyway.
- **Rationale**: FR-006 / clarification "always the section list".

## R3 — Phone screen as a separate lazy component

- **Decision**: `SettingsScreen` renders `lazy(() => import('./phone/MobileSettingsScreen'))` when `isMobileHost()`,
  otherwise the current sidebar layout unchanged — same pattern as `LibraryScreen` → `MobileLibraryHub` (spec 013) and
  `ReaderRoute` → `MobileReaderScreen`.
- **Rationale**: FR-003 / FR-012: no conditional classes threaded through the desktop layout; the desktop bundle path
  stays byte-for-byte the same component tree.

## R4 — Directional slide that never blocks input

- **Decision**: the list is always mounted underneath; the section page is a full-size layer above it. Enter: CSS
  keyframe `translateX(100%) → 0` (220 ms, decelerate). Exit: when the route pops, `phoneSettingsNavStore.leaving`
  keeps the last section rendered for one exit animation (`0 → 100%`, 200 ms, accelerate) with `pointer-events: none`;
  the list underneath is interactive at once. Any new navigation clears `leaving` immediately. Direction comes from the
  route change itself (push = enter, pop = exit), never from `animationend` for correctness (a timer of the animation
  length clears `leaving`; a stale timer checks a token). `@media (prefers-reduced-motion: reduce)` sets
  `animation: none` and the exit layer is not rendered.
- **Rationale**: FR-016 and its edge case (fast repeated taps / Back). `transform` only → 60 fps.
- **Alternatives**: a transition library (new dependency); View Transitions API (not in every Android WebView version
  the app supports).

## R5 — System Back closes dialogs first

- **Decision**: extract the history-entry technique already proven in `PhoneBookSheet.tsx:56-90` into
  `hooks/app/useBackClose(onClose)` backed by a zustand `backCloseStore` (stack of open layers with ids). Mobile host
  only: on open it pushes one `history` entry tagged with the layer id; `popstate` that removes it closes the top layer;
  closing any other way pops the entry. Used by `ConfirmBookActionDialog` and `ClearDataDialog`. `PhoneBookSheet`
  keeps its own code (no refactor in this feature).
- **Rationale**: FR-005 ("system Back MUST first close an open dialog"); today those dialogs only listen to Escape
  (`ConfirmBookActionDialog.tsx:24`), so Back would leave the section with the dialog's page. Zustand per project
  preference for hook-owned state; a stack handles a dialog opened over another layer.
- **Alternatives**: host-side Back interception (native change; the WebView would need to report open dialogs).

## R6 — Phone standards for the shared building blocks without changing section layouts

- **Decision**: CSS in `phone.css` scoped to `:root[data-mobile-host] .phone-settings`, keyed on hook classes added to
  the shared pieces:
  - `settings-switch` (on `SettingsSwitch`): its row (`.settings-switch-row`, the existing flex wrapper) gets
    `position: relative; min-height: 48px`, and the switch gets a `::after { position:absolute; inset:0 }` hit area
    ("stretched target"), so a tap anywhere on the row toggles it — no DOM restructuring, the switch stays the one
    labelled `role="switch"` control.
  - `settings-action` (action buttons, dialog buttons): `min-height: 48px`.
  - `data-tone="danger"` (Clear data, Reset, dialog destructive button): text and border `var(--lib-danger)` at rest.
  - Secondary text: `.phone-settings .text-[11px], .text-[10px] { font-size: 12px }` (escaped selectors).
  - Dialog choice rows (`ClearDataDialog`): the row becomes a `<label>` around the checkbox (same classes → same
    desktop look), min-height 48 px on the phone.
- **Rationale**: FR-014 / clarification 1: building blocks only, desktop unchanged (rules never match without
  `[data-mobile-host]`).
- **New token** `--lib-danger`: Night/Sepia `#f87171` (6.45:1 on `#0f172a`, ≥ 6:1 on `#16120e`), Paper `#dc2626`
  (4.83:1 on white). Only phone CSS uses it in this feature.

## R7 — Density hidden on the phone

- **Decision**: new `AppFeature` `'uiDensity'`, unavailable in `host.native.ts`; `AppearanceSettings` renders the
  Density card only when available. `phone.css` pins `--ui-density-*` to the phone values on `[data-mobile-host]`
  whatever `data-density` says. The stored preference is untouched (Reset App Settings still resets it).
- **Rationale**: FR-017; same mechanism that hides Storage / Notifications / Keyboard (`settingsNavStore.ts:20-29`).

## R8 — Version on the About page

- **Decision**: About reads `useUpdatesStore.version` (calls `loadVersion()` on mount, like Advanced), removing
  `ABOUT_APP_VERSION`. Display: `null` → "Loading…", `undefined` → "Unknown", else the string.
- **Rationale**: FR-019. Desktop: `getAppInfo().version` = `app.getVersion()` (`app.ipc.ts:50`), which is the
  electron-builder `extraMetadata.version` of the release. Phone: `ctx.boot.appVersion` from the native build
  (`bridge/app.ts:47`). Reading root `package.json` would always say `1.0.0`, not the installed build.

## R9 — About links and store URLs

- **Decision**: `source/core/src/config/app-links.ts`:
  `PRIVACY_POLICY_URL = 'https://lethaian15112004.github.io/reading-book-app-privacy-policy/'`,
  `PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.anle.readmate'`,
  `APP_STORE_URL = 'https://apps.apple.com/us/app/readmate-reader/id6789796532'`,
  `storePageUrl(platform: string | undefined): string | null` (`'android'` → Play, `'ios'` → App Store, else `null`).
  `updatesStore` keeps `platform` from `getAppInfo()`. About rows get `destination: string | null`; rows with `null` are
  not rendered; a group with no rows is not rendered. A row opens `appApi.openExternalLink(url)`.
- **Rationale**: FR-020. Both hosts already open external links safely: Desktop `shell.openExternal` after
  `isSafeExternalUrl` (`app.ipc.ts:108-118`); phone `Linking.openURL` after `externalHostOf` (public `https` only,
  `app-service.ts:59-70`) — Play / App Store `https` links open the store app when installed. Package id
  `com.anle.readmate` confirmed in `app.json:21` and `android/app/build.gradle:92`.
- **Note**: the Privacy Policy source `docs/store/privacy-policy.html` is still uncommitted with TODO markers — outside
  this feature, flagged in quickstart.

## R10 — Phone Updates card

- **Decision**: on the Mobile host `AboutSettings` renders the Updates card with the version and an enabled
  "Open in store" `settings-action` button → `storePageUrl(platform)`; if that is `null` (unknown platform, e.g. Expo
  Go on an unexpected value) the button is not rendered. Desktop keeps today's card.
- **Rationale**: FR-021.

## R11 — "More" naming and icon

- **Decision**: change the *values* of `chrome.nav.settings` ("More" / "Khác") and `settings.title` ("More" / "Khác");
  keys stay, so `AppMenubar` and `PhoneNav` need no text change. `PhoneNav` gets a "more" icon (three dots in a rounded
  square, same 1.6–1.8 stroke style). The Desktop menubar is text-only, so "new icon" applies to the phone tab only.
  Glossary gains "More (navigation entry) → Khác". Other texts mentioning settings (e.g. "Reset App Settings",
  shortcuts help) are unchanged — the screen is still a settings screen.
- **Rationale**: FR-018, glossary rule (`tests/i18n/glossary-anchors.test.ts`).

## R12 — Wide screens and safe areas

- **Decision**: list and section body use `max-width: 640px; margin-inline: auto` at `min-width: 900px` (phone CSS);
  header and tab bar stay full width. Safe areas: the native shell already insets the WebView on all four sides
  (`phone.css` body comment), so no `env()` padding is added; only the page body scrolls (`overflow-y: auto`), the
  header is outside the scroller.
- **Rationale**: FR-007, FR-013, FR-015.
