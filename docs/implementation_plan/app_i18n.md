# App interface language — Vietnamese / English (spec 012)

Spec, plan, contracts: `specs/012-app-ui-i18n/`. Glossary (authoritative Vietnamese terms and tone):
`specs/012-app-ui-i18n/contracts/glossary.md`.

## Status

| Part | State |
|---|---|
| Core i18n module, catalogue layout, tests | done (Phase 2) |
| Renderer store / `useT` / `TransText`, Main mirror + `app:setUiLanguage` | done (Phase 2) |
| Lint rule `readmate/no-ui-literals` + pending headers on 112 files | done (Phase 2) |
| Areas translated | `common` only — every other area is a `pendingArea(…)` marker and shows English |
| Release gate (`tests/i18n/i18n-release-gate.test.ts`) | not yet (T059) — **not releasable** until it exists and passes |

## Modules

| Where | What |
|---|---|
| `source/core/src/i18n/` | `resolveUiLanguage`, `translate` / `createTranslator`, `Intl` formatters, catalogue registry, `pendingArea` — pure TS, exported from `@core` |
| `source/core/src/i18n/catalogue/{en,vi}/<area>.ts` | the texts; `en` is the reference (`as const`), `vi` is `satisfies AreaShape<typeof en>` or `pendingArea('reason')` |
| `source/app/i18n/` | `useUiLanguageStore` (derived from the appearance store), `useT()`, `getT()`, `useFormat()`, `TransText` |
| `source/app/components/chrome/AppAppearanceBridge.tsx` | sends the preference to Main at start and on every change |
| `source/app/platforms/electron/i18n/main-i18n.ts` | Main: `{userData}/ui-language.json` mirror, `tMain`, `onMainUiLanguageChange`, `handleSetUiLanguage` |
| `source/scripts/eslint-rules/no-ui-literals.mjs` | the lint rule (its test runs in `desktop:lint`) |
| `source/scripts/i18n-inventory.mjs` | `npm run i18n:inventory` — remaining literal texts (`--files`, `--json`, `--only <prefix>`) |

Checks: `npm run sdk:test` (`tests/i18n/*`), `npm run spike:i18n:main`, `npm run lint`.

## How to add a text

1. Add the English text to `catalogue/en/<area>.ts` (group keys by component; placeholders `{name}`; plurals
   `{ one: '{count} book', other: '{count} books' }` with a `count` param).
2. Use it: `const t = useT()` → `t('library.empty.title')` in React, `getT()` in stores / helpers, `tMain(…)` in Main.
   State shown later than produced keeps a `MessageRef` (`{ key, params }`) and is translated when rendered.
3. Add the Vietnamese text to `catalogue/vi/<area>.ts` (TypeScript fails until it exists, if the area is translated).
4. Never pass user data (titles, authors, notes, file names, book text) through `t` — insert it as a param.

Rich text: `<TransText k="…" slots={{ link: (text) => <a …>{text}</a> }} />` with `Open <link>Settings</link>` in
the message. Not interface text (key names, format names, brand): `// i18n-ignore: <reason>`.

New IPC results (from spec 012 on) carry a code + params, and the renderer translates. Existing `errorMessage`
strings are produced by Main with `tMain` in its current language.

## How to convert an area

Follow the "area conventions" at the top of `specs/012-app-ui-i18n/tasks.md`: fill `en/<area>.ts`, replace the
literals, replace the `pendingArea(…)` in `vi/<area>.ts` with the full object, remove the `/* i18n-pending: <area> */`
first line of each converted file, `npm run typecheck && npm run lint && npm run sdk:test`.

## Folder → area (owner of each pending header)

| Folder / file (under `source/app/`) | Area |
|---|---|
| `App.tsx`, `components/chrome/**`, `screens/Splash/**` | `chrome` |
| `screens/Library/**`, `hooks/library/**` | `library` |
| `components/import/**` | `import` |
| `screens/Settings/**`, `shortcuts/**`, labels in `theme/appAppearance.ts` | `settings` |
| `components/annotation-transfer/**`, `screens/Reader/components/{highlights,dialogs}/**`, `utils/annotationTransferMessages.ts` | `reader.annotations` |
| `screens/Reader/components/{chrome,canvas}/**`, `components/reader/{chrome,pageturn,interaction}/**` | `reader.chrome` |
| `screens/Reader/components/{sidebar,rightPanel,settings}/**` | `reader.sidebar` |
| `screens/Reader/components/{translation,sign,txt}/**`, `components/reader/tts/**` | `reader.tools` |
| `components/reader/renderers/pdf/**` | `reader.pdf` |
| `components/reader/renderers/{epub,md,txt}/**` | `reader.text` |
| `screens/Reader/phone/**` | `reader.phone` |
| `screens/AudioBook/components/TranscribeDialog.tsx` | `audiobook.transcription` |
| `screens/AudioBook/**` (rest) | `audiobook.player` |
| `hooks/app/**` | `appHooks` |
| every other file under `screens/Reader/`, `components/reader/`, `hooks/reader/`, `screens/ReaderRoute.tsx` | `reader.logic` |
| `platforms/electron/**` (tray, dialogs, notifications) | `main.shell` |
| `platforms/electron/ipc/**` messages | `main.messages` |
| core `annotation-transfer/readable-markdown.ts` | `exports` |

`.ts` files carry no header (the rule checks `.tsx` only); the inventory lists them.

## Notes

- Mobile: the WebView runs the same store and catalogue (`navigator.languages` of the phone); `app.setUiLanguage`
  answers "not available" there and is ignored. The React Native host start-failure screen stays English (no core in
  the host, OD-1).
- Core has no `console`: warnings (missing key / param) go through `setI18nWarningHandler`, set by the renderer
  store and by Main.
