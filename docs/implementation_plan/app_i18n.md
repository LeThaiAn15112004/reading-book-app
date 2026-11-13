# App interface language — Vietnamese / English (spec 012)

Spec, plan, contracts: `specs/012-app-ui-i18n/`. Glossary (authoritative Vietnamese terms and tone):
`specs/012-app-ui-i18n/contracts/glossary.md`.

## Status

| Part | State |
|---|---|
| Core i18n module, catalogue layout, tests | done (Phase 2) |
| Renderer store / `useT` / `TransText`, Main mirror + `app:setUiLanguage` | done (Phase 2) |
| Lint rule `readmate/no-ui-literals` + pending headers on 112 files | done (Phase 2) |
| Areas translated (Phase 3) | every renderer area + `main.messages` |
| System language (Phase 4) | renderer and Main resolve `system` by the same rule; no locale API → English |
| Main shell + export (Phase 5) | tray, reminder notifications, Main-owned dialogs (`main.shell`), readable `.md` export (`exports`) |
| Formats + plurals (Phase 6) | no `toLocale*` left in `source/app`; decimals, sizes, dates through `useFormat()` / `getFormat()`; plural shape tested |
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
- State kept in stores holds `UiText` (a Main string or a `MessageRef`) and is translated when shown; short toasts are
  translated when raised (`getT()`), so a toast already on screen keeps its language.
- Main: `tMain` lives in `platforms/electron/i18n/main-translate.ts` (no `electron` import) so services and their Node
  spikes can use it; `main-i18n.ts` sets its language. Never call `tMain` at module level (it would freeze English):
  keep keys in tables and call `tMain(key)` where the message is produced.
- Core helpers that build text take `lang` (default `en`, so existing tests keep their English):
  `describeAttachFailure`, `describeAttachmentBlock`, `trackEyebrow`, `formatRelativeLastRead`; others return keys
  (`singleFileImportNotes`, `shelfProgressForBook`).
- Selectors must never use `aria-label` / `title` (they are translated): the Reader sidebar uses
  `data-reader-sidebar-nav` / `data-reader-sidebar-toggle`.
- E2E (manual) still finds elements by English names: run it with an English system language until the specs pin
  the language.
- Persisted labels (bookmark "Page n", last-read label) are written in the language active when they are saved.
- Main shell (Phase 5): the tray tooltip and menu are rebuilt on every Main language change
  (`onMainUiLanguageChange` in `initBackgroundMode`); a reminder notification and a dialog's title / filter names are
  built when they are shown, so one already open keeps its language. Format names ("Markdown (*.md)") may read the
  same in both languages. Checked by `spike:i18n:main` (tray vi → en with no restart, reminder text, every IPC file
  that opens a dialog).
- The readable `.md` export (`renderReadableMarkdown`, option `lang`, default `en`) is written in Main's interface
  language when it is exported (`getMainTranslatorLanguage()`); the English output is unchanged byte for byte. Book
  text, titles and comments are never translated. The restorable `.readmate-notes.json` has no interface words.
- Audiobook chapters with no title get "Chapter N" / "Chương N" in the language active when the chapter list is
  validated (`normalizeChapters(raw, duration, lang)`); the list's `reason` (why it was not trusted) stays an English
  diagnostic inside the translated sentence.
- Formats (Phase 6): whole percents ("42%") read the same in both languages and stay plain template text; anything
  with a decimal, a size or a date goes through the formatters (`1,5` in Vietnamese). Playback / passage times keep
  the clock style `h:mm:ss`. The Library title sort (`Intl.Collator(undefined, …)`) follows the system's collation on
  purpose: it sorts book titles, not interface text.
- Plurals: every counted message is a plural object chosen by `{count}` (en `one` + `other`, vi `other` only; checked
  in `catalogue-completeness.test.ts`); no `count === 1 ? … : …` string building is left in `source/app`.
- Device check (T045, manual): on a phone, set the system language to Vietnamese, then to French, and open the app
  with "System" chosen: Vietnamese, then English.

## Live switch (T041)

Checked 2026-11-12: no component is keyed by the language (`key={language}`), the language setter never navigates,
and `useT()` / `useUiLanguage()` are only read for rendering (JSX, one `useMemo` of page labels in `ReaderScreen`). A
change re-renders the visible texts; `ReaderRoute`, `AudioBookScreen` and their stores (open book, position, player)
are not remounted or reset, and no effect lists `t` as a dependency, so no renderer reopens its book.
