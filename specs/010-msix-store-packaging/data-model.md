# Data Model: Microsoft Store Package for the Desktop App

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

No SQLite migration. No change to any existing table or column. New data is build configuration, two JSON files in
the Store build's own `userData`, and Markdown records under `docs/store/`.

## 1. Store identity *(build config — `electron-builder.store.json5`, block `appx`)*

| Field | Example | Rule (checked by `check-store-config.mjs`) |
|---|---|---|
| `identityName` | `12345Readmate.ReadmateReader` | from Partner Center; 3–50 chars `[A-Za-z0-9.-]`; not a placeholder |
| `publisher` | `CN=1A2B3C4D-…` | from Partner Center; starts with `CN=`; not a placeholder; equals the test certificate subject when test-signing |
| `publisherDisplayName` | `Lê Thái An` | from Partner Center; not empty, not a placeholder |
| `applicationId` | `ReadmateReader` | letters/digits/periods, starts with a letter, not a reserved name |
| `displayName` | `Readmate Reader` | equals the name reserved in Partner Center |
| `languages` | `["en-US", "vi-VN"]` | first = default; each has a Store listing |
| `minVersion` / `maxVersionTested` | `10.0.17763.0` / `10.0.26100.0` | four-part Windows build numbers, min ≤ max |
| `capabilities` | `["runFullTrust"]` | exactly this list (FR-004) |
| `addAutoLaunchExtension` | `false` | must be false (our own startup task, R5) |
| `customExtensionsPath` | `source/app/platforms/electron/store/appx-extensions.xml` | file exists, declares `ReadmateReaderStartup` |

Placeholders: the literal `__FROM_PARTNER_CENTER__` and `YourAppID`. With `--allow-placeholders` (used by
`npm run check`) placeholders pass, shapes are still checked.

## 2. Release version *(build config — `electron-builder.json5` `extraMetadata.version`)*

- Form `MAJOR.MINOR.PATCH`, numeric, each ≤ 65535, `MAJOR ≥ 1`. Store form = `MAJOR.MINOR.PATCH.0`.
- Must be greater than the last `Version` row of `docs/store/submissions.md` (strictly, compared numerically).
- One value for both the NSIS installer and the Store package; never affects `userData` (that is
  `extraMetadata.name`).

## 3. Master icon and generated assets *(see [contracts/store-icons.md](contracts/store-icons.md))*

- **Master icon**: one PNG path constant in `generate-icons.mjs`. Valid: square, width ≥ 1024, has alpha.
- **Generated asset**: `{ file, width, height, plate: 'plated' | 'unplated' | 'lightunplated', contentScale }` —
  every row of the contract table; output folder git-ignored and fully rewritten on each run.

## 4. Test certificate *(outside the repository)*

- `READMATE_STORE_TEST_PFX` — absolute path to the `.pfx`; must not be inside the repository.
- `READMATE_STORE_TEST_PFX_PASSWORD` — secret; only passed to the electron-builder child as `WIN_CSC_KEY_PASSWORD`.
- Derived: `subject` — must equal `appx.publisher`. `notAfter` — warn when < 30 days.

## 5. Store-import marker *(Store build `{userData}/store-import.json`)*

```text
{ "version": 1,
  "state": "pending" | "declined" | "done",
  "at": ISO-8601,
  "source": { "schemaMigrations": number, "lastMigration": "030_audio_transcript_scope.sql" }?,   // done only
  "copied": { "books": number, "notes": number, "files": number, "bytes": number }?                // done only
}
```

State machine (one launch of the Store build, before the first window):

```text
(no db, no marker, source exists) ──ask──▶ Import ──▶ [source busy?] ─yes─▶ ask: Try again ─┐
        │                                   │                     │        Later ──▶ (no marker)
        │                                   │                     │        Start empty ─▶ declined
        │                                   │                     └─no─▶ copying ──fail/cancel──▶ (no db, staging removed; ask next launch)
        │                                   │                               └─ok──▶ committed (db renamed last) ──▶ done
        └── Start empty ──▶ declined
(marker = pending, library empty) ──▶ Import without asking (same path)
(db exists) ──▶ never asked; Settings entry hidden unless library empty
```

- `declined` / `done` are final for the automatic offer. Settings can still write `pending` while the Store library
  has zero books (spec AS 6.4).
- "Library empty" = `SELECT COUNT(*) FROM books` = 0 in the Store database.
- No partial state survives: without `reading-book.db` (the commit point), every allowlisted entry and
  `store-import.partial/` is deleted before the offer.

## 6. Import plan *(pure, core `source/core/src/store-import/`)*

- `ImportSource { root, entries: { name, kind: 'file' | 'dir', bytes }[], hasWal: boolean }`
- `ImportPlan { copy: string[]; skip: string[]; totalBytes; refuse?: 'source_busy' | 'no_space' | 'newer_schema' | 'integrity' }`
- `rewriteRoot(value, fromRoot, toRoot): string | null` — Windows rules: case-insensitive, `/` and `\` equal, only
  whole path segments (`C:\…\reading-book-desktop2` is not inside `…\reading-book-desktop`). `null` = not inside.
- `isNewerSchema(sourceNames, knownNames)` — true when any source name is not in `knownNames`.
- `verifyCounts(sourceCounts, stagedCounts)` — equal per table, else refuse `integrity`.

## 7. Start-at-login state *(DTO, extends the existing one)*

```text
StartAtLoginDto = {
  supported: boolean
  enabled: boolean
  state?: 'enabled' | 'disabled' | 'disabledByUser' | 'disabledByPolicy' | 'enabledByPolicy' | 'managedByWindows'
}
```

`state` is only set by the Store build; the direct build keeps sending `{ supported, enabled }`. `canChange` is derived
in the renderer: `state` ∈ {`enabled`, `disabled`} or absent.

## 8. Store-import status *(DTO, new IPC group)*

```text
StoreImportStatusDto = {
  available: boolean            // Store build AND Store library empty AND direct-build database exists
  lastResult?: 'done' | 'declined'
}
```

## 9. Release records *(Markdown under `docs/store/`)*

- `submissions.md` — one row per submission: `Version | Date | Package SHA-256 | WACK | Smoke | Result | Notes`.
- `smoke-tests.md` — one row per feature (FR-019) × one column per release: `pass` / `fail (reason)`.
- `wack/<version>.xml` — the certification kit report.
