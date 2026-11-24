# Contract: `txt.commit` on the phone bridge (FR-015a)

Same TypeScript signature as Desktop (`DesktopApi['txt']['commit']`, `TxtCommitInput` → `TxtCommitResult` in
`platforms/electron/ipc/api-types.ts`); no new channel, no new DTO. The phone answers it for **annotations only**.

| Input | Phone answer |
|---|---|
| not an object / bad shape | `{ ok: false, errorCode: 'invalid' }` |
| `text` present | `invalid` (the phone never edits text) |
| `baseRevision !== 0` | `conflict` |
| book missing or not `txt` | `not_found` |
| book file unreadable (moved / deleted / read error) | `not_found` (nothing written: offsets cannot be checked) |
| an upsert whose offsets are outside the text, whose quote ≠ text at the offsets, or without `txtAnnotationRef` | `invalid` (nothing written) |
| an upsert / delete id that exists for another book or is not a TXT mark row | `invalid` (nothing written) |
| SQL failure | `db_failed` (nothing written: one host transaction) |
| otherwise | `{ ok: true, revision: 0 }` |

- The text used for validation is the book's bytes decoded by the bridge's `decodeTxtBytes` (identical to `txt.open`).
- Writes: one `AsyncSqlDriver.transaction(statements)` — every upsert (insert or rewrite) and every delete, or none.
- Checks are the core functions Main uses: `parseTxtAnnotationRef`, `isValidTxtRange`, `quoteMatchesText`,
  `isConsistentTxtHighlight`.
- `txt.open` keeps `editable: false` and `revision: 0`.
- Tests: `platforms/native/tests/txt-commit.test.ts` — round trip of the existing row fixture
  `source/core/tests/contracts/fixtures/v1/txt-underline.json` (commit → `txt.open` returns the same row), plus every
  refusal above; the counted bridge log shows one call per save.
