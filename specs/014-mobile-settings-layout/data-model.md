# Data Model: Mobile Settings screen layout (spec 014)

No persisted data is added or changed (no SQLite, no new localStorage key). The models below are UI state and static
configuration.

## PhoneSettingsSection (derived, not stored)

| Field | Type | Source | Rule |
|---|---|---|---|
| `id` | `SettingsSectionId` | `SETTINGS_SECTIONS` | only sections where `isFeatureAvailable(feature)` (phone: appearance, privacy, advanced, about), in existing order (FR-001, FR-010) |
| `labelKey` | `MessageKey` | `SETTINGS_SECTIONS` | row name and section page title |
| `descriptionKey` | `MessageKey` | `settings.sectionDescriptions.*` (existing) | row description, wraps to ≤ 2 lines |
| `icon` | — | `SettingsSectionIcon` (existing) | decorative (`aria-hidden`) |

`sectionFromParam(param, visible)` (core, pure): returns the matching visible id, or `null` for missing / unknown /
hidden → the route redirects to the list.

## Route state

| Path | Page | Notes |
|---|---|---|
| `/settings` | Phone: section list · Desktop: sidebar + last section (unchanged) | More tab and menubar target |
| `/settings/:section` | Phone: section page · Desktop: same as `/settings` (param ignored) | invalid param → `replace('/settings')` on the phone |

## phoneSettingsNavStore (zustand, Mobile host only)

| Field | Type | Meaning |
|---|---|---|
| `listScrollTop` | `number` | saved when a section opens, restored when the list shows again (FR-006); reset to 0 when the More tab is entered from another tab |
| `leaving` | `{ section: SettingsSectionId; token: number } \| null` | section page kept for its exit slide; cleared by timer (token-checked) or by any new navigation (FR-016) |

Transitions: list → (tap row) → section [enter slide] → (back / system Back) → list [`leaving` set → cleared after
~200 ms]; reduced motion: `leaving` is never set.

## backCloseStore (zustand, Mobile host only)

| Field | Type | Meaning |
|---|---|---|
| `stack` | `{ id: string; close: () => void }[]` | open back-closable layers, top last |

Rules: `push` on open adds an entry and one `history` state tagged with its id; a `popstate` that removes the top
entry's state calls its `close`; closing otherwise removes the entry and pops its history state if it is current.
Desktop: the hook is a no-op (Escape handling stays in each dialog).

## AboutLink (static)

| Field | Type | Rule |
|---|---|---|
| `id` | string | existing ids (`privacy-policy`, `terms-of-service`, …, `store-page`, `website`) |
| `labelKey` | `MessageKey` | existing |
| `destination` | `string \| null` | `privacy-policy` → `PRIVACY_POLICY_URL`; `store-page` → `storePageUrl(platform)`; all others `null` |

Rendering: rows with `destination === null` are not rendered; a group (Legal, Support, Links) with no rendered row is
not rendered (FR-020). Activating a row calls `openExternalLink(destination)`.

## App info (existing source, extended use)

| Field | Source | Used for |
|---|---|---|
| `version` | `appApi.getAppInfo()` via `updatesStore` | About + Advanced version (FR-019): `null` loading, `undefined` unknown |
| `platform` | same call (new field kept in `updatesStore`) | `storePageUrl` (FR-020, FR-021) |
