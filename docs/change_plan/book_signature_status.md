# Book Signature Status (verification only)

> **Status:** implemented in the desktop app (`source/apps/reading-book-desktop`) and the SDK
> (`source/apps/book-reader-sdk`). One SQL migration: `022_book_signature_status.sql`.
> **Related:** SDS changelog 1.25 · `docs/software/schema.dbml` / `sqlite-database.md` (`books.metadata_json`) ·
> `docs/implementation_plan/file_centric_import_architecture.md` (SHA-256, referenced files).
>
> This document describes what the code does today. What is *not* implemented is listed under
> [Limitations](#11-limitations) and [Follow-up work](#12-follow-up-work).

## 1. Why status only

This is a **reading** app. The question a reader has is *"is this book I'm about to trust signed, and is the
signature still good?"* — not *"let me get this signed"*. So the app **detects and reports** the signature state of
a book file and stores it in the book's metadata so the Reader / Library can show it. It deliberately does **not**:

- create digital signatures, or hold any signing keys;
- request signatures from other people, send documents for signing, or manage signers / workflows;
- add `signature_requests` / `signers` / `signature_workflows` tables (there is no new table at all);
- resemble an eSign product (no signing UI, no signature fields, no certificate management).

The only UI is a read-only status line in the existing Book info dialog and the existing (read-only) signature panel.

## 2. Annotations are not signatures

Highlights, underlines, strikethroughs, text boxes, notes and bookmarks live in the `notes` table
(`note_json`) and are drawn over the book by the renderer. They say nothing about who produced the file or
whether it was altered. A **digital signature** is a cryptographic object *inside the file* that binds a signer's
certificate to the exact bytes of the document.

The verifier therefore never looks at annotations. In a PDF, a highlight is an `/Annot` with `/Subtype /Highlight`;
a signature is a dictionary carrying `/ByteRange` and `/Contents`. The fixture `unsigned-annotated.pdf` (a PDF with
a highlight annotation) must be reported `unsigned`, and is covered by a test.

## 3. SHA-256 is not a signature

`books.sha256` is the file's **fingerprint**: it identifies the content (duplicate detection, relink) and anyone can
compute it for any file. It proves nothing about authorship. It is used here only as a **cache key** — "is this stored
verification result still about the bytes on disk?" ([§7](#7-cache-and-the-current-file)). Whether a file is signed is
decided solely by parsing its signature structures and verifying them.

## 4. Data model — `books.metadata_json`

`signatureStatus` is the single source of truth. There is no redundant `isSigned` flag any more.

```json
{
  "fileSizeBytes": 1234567,
  "pageCount": 320,
  "description": "…",
  "signatureStatus": "valid",
  "signerName": "Jane Doe",
  "signedAt": "2026-03-12T09:30:00.000Z",
  "signatureCheckedAt": "2026-04-01T08:00:00.000Z",
  "signatureCheckedSha256": "9f86d0…"
}
```

| Key | Meaning |
|---|---|
| `signatureStatus` | `unsigned` \| `valid` \| `invalid` \| `unsupported`. **Absent = never checked.** |
| `signerName` | Common name of the signer certificate. Only for `valid` / `invalid` results, when readable. |
| `signedAt` | ISO-8601 signing time claimed by the signature (CMS `signingTime`, else the dictionary's `/M`). |
| `signatureCheckedAt` | ISO-8601 time the verification ran. |
| `signatureCheckedSha256` | SHA-256 of the exact bytes that were verified — the cache key. |

Domain/SDK: `Book.isSigned` / `Book.setSigned()` are replaced by `Book.signature?: BookSignatureInfo` /
`Book.setSignature()` (`book-reader-sdk/src/domain/book/book-signature.ts`, import-free so plain node scripts can load
it). Old statuses `expired` and `unknown` no longer exist; a stored value outside the four statuses reads as "not
checked".

## 5. Status values

| Status | Meaning | Never means |
|---|---|---|
| `unsigned` | The file was inspected and contains no digital signature. | — |
| `valid` | A signature is present and **intact**: the signed bytes are unchanged, the signature verifies with the public key of the certificate embedded in the file, and (for PDF) the last signature reaches the end of the file. | That the signer is *trusted*. The certificate chain is not validated, and expiry / revocation are not checked — the app has no trust store. |
| `invalid` | A signature is present but does not verify: content changed after signing, signature value damaged, malformed / empty signature, or bytes appended after the signed range. | — |
| `unsupported` | The app has no verification mechanism for this format or signature type, so it cannot say whether the file is signed. | "Signed" or "unsigned". |

UI wording (`src/screens/Reader/logic/bookSignature/signatureLabels.ts`): *Signed · valid*, *Not signed*,
*Signature invalid*, *Can't verify*; a book with no result yet shows *Checking…* until the check returns.

## 6. Verification flow

```
Import (local / URL / cloud)                     Reader / Library opens book details
   │                                                       │  library:checkSignature(bookId)
   │  hash already known from dedup                        ▼
   ▼                                              resolveBookFile → hashFile (current SHA-256)
resolveSignatureInfo ◄──────────────────────────────────────┤
   │   cached result current?  (checkedSha256 == sha256 now) ── yes ──► return cache (no file read)
   │                                   │ no
   │   format has a verifier that reads the file? ── no ──► unsupported (file not read)
   │                                   │ yes
   │   read bytes → SHA-256 of those bytes → verifySignature(format, bytes)
   ▼
BookSignatureInfo → books.metadata_json (json_patch)  →  DTO → UI
```

- **Import** (`electron/ipc/import.ipc.ts`, `finishImport`): runs for every source (local reference, URL, cloud) right
  after metadata extraction, reusing the SHA-256 the import already computed. It is wrapped so it can **never fail an
  import**: on any error the book is stored as "not checked" and is verified the first time it is inspected.
- **On demand** (`library:checkSignature`, `electron/signature/book-signature.ts`): called when the Book info dialog or
  signature panel opens. Books imported before this feature (no result yet) and books whose file changed get verified
  here. A missing / unreadable file returns an error code and leaves the stored result untouched — opening a book never
  fails because of its signature.
- `BookSummaryDto.signature` also carries the stored result (may be stale until a check) for cheap display.

## 7. Cache and the current file

A referenced book lives at the user's own path and can be edited in place after import, so `books.sha256` (the hash at
import time) can go stale. The cache key is therefore the hash of the file **now**, computed with the existing
`hashFile` (`electron/files/file-hash.ts`):

- stored `signatureCheckedSha256` == current SHA-256 → reuse the result, read nothing else;
- otherwise → verify again and overwrite **all** signature keys via `json_patch` (`signatureMetadataPatch` lists every
  key, with `null` = delete, so a stale `signerName` can never survive a result that has none);
- the hash recorded is that of the bytes actually verified, even if the file changed between hashing and reading;
- a result with no recorded hash (legacy / hand-edited) is never treated as current.

`books.sha256` itself is not modified: it stays the book's identity for duplicates and relink.

## 8. PDF verification

`electron/signature/pdf-signatures.ts` + `cms.ts` + `der.ts`. No new dependency: hashing, X.509 parsing and signature
verification are `node:crypto`; the ASN.1 reader is ~140 lines and bounds-checked. No cryptography is implemented by
hand.

1. **Find signatures.** A PDF signature is a dictionary with `/ByteRange [a b c d]` and a `/Contents <hex>` CMS
   `SignedData` over `file[a, a+b) ++ file[c, c+d)`. Signature dictionaries cannot live in compressed object streams
   (their byte offsets are part of the signature), so a byte scan for `/ByteRange` finds them without a PDF parser.
   Document timestamps (`/DocTimeStamp`, `ETSI.RFC3161`) are ignored — they date a file, they are not a signer.
2. **Frame check.** `a == 0`, the gap between the ranges is exactly the `<…>` hex string, the ranges fit the file.
   Otherwise → `invalid`.
3. **Sub-filter.** `adbe.pkcs7.detached` and `ETSI.CAdES.detached` are verified. Anything else
   (`adbe.pkcs7.sha1`, `adbe.x509.rsa_sha1`, missing) → `unsupported`.
4. **CMS.** Hash the byte ranges with the signer's digest algorithm (SHA-1/224/256/384/512), compare with the signed
   `messageDigest` attribute, then verify the signature over the DER-encoded signed attributes with the signer
   certificate's public key (RSA PKCS#1 v1.5 or ECDSA). The signer certificate is the one named by the `SignerInfo`
   (issuer + serial), else any embedded certificate whose key verifies. `signerName` is that certificate's CN.
5. **Aggregate over all signatures.** Any `invalid` → `invalid`; else any `unsupported` → `unsupported`; else all intact
   → `valid` only if the **last** signature covers the whole file (trailing CR/LF/space tolerated). A valid signature
   followed by other bytes means the file was changed after signing → `invalid`. Multi-signature (incremental-update)
   documents are supported: earlier signatures legitimately stop before EOF.
6. No signature dictionary → `unsigned`. Bytes without a `%PDF-` header → `unsupported`.

## 9. EPUB and other formats

`electron/signature/signature-service.ts` is the per-format registry (same shape as `adapters/importer-registry`).

- **EPUB → always `unsupported`.** EPUB does not share PDF's mechanism. The OCF spec allows an optional
  `META-INF/signatures.xml` (W3C XML-DSig), but the project has no XML-DSig/canonicalisation dependency and no defined
  signing profile for its books, so nothing here can decide whether an EPUB is signed. Reporting `unsigned` would be a
  guess and `valid` would be false. The EPUB file is not even read for this.
- **TXT, MD, DOCX, DOC → `unsupported`** (no signature mechanism the app verifies; DOCX has its own XML-DSig, not
  implemented).
- **Files over 512 MB** are not loaded into memory → `unsupported`.

Adding a format = write a `(Buffer) => SignatureVerification` and register it in `VERIFIERS`.

## 10. Migration / compatibility

`electron/persistence/migrations/022_book_signature_status.sql`, registered in `migrate.ts`:

- Migration 020 copied `is_signed` / `signature_status` (default `'unknown'`) into `metadata_json`. **Nothing in the app
  ever verified a signature**, so those values were defaults, not results (the Reader panel ran on `FAKE_SIGNATURES`
  demo data). The migration removes `isSigned`, `signatureStatus`, `signerName`, `signedAt` from every row that has no
  `signatureCheckedAt`, i.e. every legacy row; those books become "not checked" and are verified on next inspection.
  A legacy `valid` is deliberately **not** carried over — no one had verified it.
- Rows that already hold a real result (`signatureCheckedAt` present) are untouched, so re-running is a no-op.
- `fileSizeBytes`, `pageCount`, `description` are preserved; `updated_at` is unchanged (cleanup, not a user edit).
- No schema change (JSON keys only), no new table, no data rebuild.

## 11. Limitations

- `valid` is integrity, not trust: no chain building, trust store, expiry, revocation, or timestamp-authority check.
- Unsupported signature algorithms report `unsupported` rather than guessing: RSASSA-PSS, EdDSA, MD5 digests,
  `adbe.pkcs7.sha1`, `adbe.x509.rsa_sha1`.
- The reason for a non-valid result (e.g. "modified after signing") is produced by the verifier but not persisted or
  shown; the UI shows the status and a generic sentence.
- Verification runs at import and when the details are opened — not for the whole library in the background, so the
  library grid shows no signature badge.
- The PDF scanner is a byte scan, not a PDF parser; a signature hidden in a malformed/obfuscated structure is not
  found (→ `unsigned`).
- The Reader's `SignInfoPanel` is wired to real data, but the Tools-menu entry that opened it is removed in the
  working tree this change was made from (uncommitted edits to `ReaderScreen.tsx` / `ToolsMenu.tsx` /
  `ReaderTopbar.tsx`, not part of this change), so today the status is reachable through **Book info**.
- The Electron app itself was not launched for this change: IPC, preload and UI are covered by `tsc` and `vite build`,
  and the verification, cache and migration logic by the checks below.

## 12. Follow-up work

- **EPUB:** decide the signing profile (OCF `META-INF/signatures.xml`, XML-DSig). Needs an XML-DSig verifier
  (canonicalisation + signature check) or a vetted library; then register it as the `epub` verifier. Until then EPUB
  stays `unsupported`.
- Optional trust layer: evaluate the certificate chain against the OS / a bundled trust store, expiry, and revocation,
  possibly adding a `trusted` qualifier to `valid`.
- RSASSA-PSS / EdDSA; PAdES-LTV / DSS; DOCX signatures.
- Background backfill of pre-existing books, and a library-level signed badge / filter.
- Persist and show a short reason for `invalid` / `unsupported`.

## 13. Tests

The repo has no test runner (see `CLAUDE.md`); following its convention, the checks are a standalone node script under
`spikes/`, run with `npm run spike:signature:status` (23 checks, `node --experimental-strip-types`, no extra
dependencies; the `node:sqlite` built-in is used for the metadata and migration checks).

Fixtures (`spikes/signature-status/fixtures/*.pdf`, regenerate with `npm run spike:signature:fixtures`, needs `openssl`)
are signed by **OpenSSL over the PDF `/ByteRange`** — an independent implementation, not the code under test.
`.gitattributes` marks them `binary`, because a CRLF conversion changes the signed bytes and breaks the signatures.

| # | Requirement | Covered by |
|---|---|---|
| 1 | Signed → `valid` | RSA/SHA-256, ECDSA P-256, SHA-1 digest, CAdES sub-filter; signer name + signing time |
| 2 | Unsigned → `unsigned` | plain PDF; PDF with a highlight annotation; SHA-256 ≠ signature |
| 3 | Invalid signature → `invalid` | tampered content, damaged signature value, appended bytes, empty `/Contents`, garbage CMS (never throws) |
| 4 | Unsupported → `unsupported` | EPUB, TXT/MD/DOCX/DOC, unknown PDF sub-filter, non-PDF bytes |
| 5 | Cache vs changed file | cache hit reads nothing; `valid` → tampered file re-verifies to `invalid`; unsigned → signed re-verifies; no-hash cache never current; import path skips re-hashing |
| — | Metadata + migration | `json_patch` round-trip clears stale signer; legacy statuses read as unchecked; migrations 001–020 + 022 applied to a real SQLite DB (021 skipped: `node:sqlite` has no FTS5 and 021 never touches `books`) with legacy rows, other keys preserved, idempotent |
| 6 | Existing behaviour | no automated suite exists for import/reading/annotations; covered by `tsc --noEmit`, `vite build`, the other spikes (`session:roundtrip`, `overlay:cfi`), and by the change being additive (signature keys only; annotation code untouched) |

## 14. Files changed

**New**
- `book-reader-sdk/src/domain/book/book-signature.ts` — `SignatureStatus`, `BookSignatureInfo`, cache/metadata helpers
- `electron/signature/der.ts`, `cms.ts`, `pdf-signatures.ts` — ASN.1 reader, CMS verification, PDF signature scan
- `electron/signature/signature-service.ts` — per-format registry (`pdf`, `epub`)
- `electron/signature/signature-check.ts` — SHA-256-keyed cache + I/O orchestration
- `electron/signature/book-signature.ts` — import hook and `checkBookSignature`
- `electron/persistence/migrations/022_book_signature_status.sql`
- `src/screens/Reader/logic/bookSignature/{bookSignatureStore,signatureLabels}.ts`, `logic/hooks/useBookSignature.ts`
- `spikes/signature-status/*` (checks, fixture builder, alias hook, fixtures, `.gitattributes`)
- `docs/implementation_plan/book_signature_status.md`

**Modified**
- SDK: `domain/book/book.ts` (`isSigned` → `signature`), `domain/book/index.ts`, `persistence/books-json.ts`,
  `app-models/{index,reader-session}.ts` (removed the fake-data `ReaderSignature` type), electron-host example comment
- Desktop: `electron/persistence/{migrate,sqlite-library-store}.ts`, `electron/ipc/{api-types,channels,import.ipc,library.ipc}.ts`,
  `electron/preload.ts`, `src/bridge/library.ts`, `components/dialogs/BookInfoDialog.tsx`,
  `components/sign/SignInfoPanel.tsx`, `ReaderScreen.tsx` (real data instead of `FAKE_SIGNATURES`), `logic/index.ts`,
  `package.json` (two spike scripts)
- Removed: `src/screens/Reader/logic/demo/fakeSignatures.ts`
- Docs: `docs/software/{SDS.md,schema.dbml,sqlite-database.md}` updated to the new `metadata_json` contract
