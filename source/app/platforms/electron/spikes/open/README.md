# Opening spikes (spec 017)

Standalone Node checks of the book-opening flow (`specs/017-reliable-book-opening/`). Not part of the app build; run
from the repository root.

| Script | What it checks |
|---|---|
| `npm run spike:open:limits` | The REAL renderer `readerOpeningStore` with an injected clock and foreground source (no DOM): a step that never answers fails "took too long" after 20 s of foreground time with the right actions; background time and a burst of ticks after it do not count; a hanging saved position falls back after 3 s; leaving aborts the opening's signal and releases the 016 gate at once; older tokens are ignored; one automatic retry; timing lines carry format + size only. |
| `npm run spike:open:content` | The real Main read of a book (`files/read-book-bytes.ts`, the body of `library:openBookContent` after the path check) on temp files: SHA-256 kept for PDF only (live sync), the read buffer sent without a copy, a missing / too-large file refused before any read, size change ⇒ `file_changed`, mtime alone opens, EBUSY retryable, cloud placeholder ⇒ `not_available_offline`; the renderer's `toArrayBuffer` keeps the buffer it receives. |

Timing (FR-019): `READMATE_TIMING=1 npm run dev`, open the samples, then
`npm run spike:import:timing -- --label open-baseline` (before) and
`npm run spike:import:timing -- --label open-after --compare open-baseline` (after). The `open` table lists tap →
first page per format / size and how openings ended (opened / left / failed:&lt;cause&gt;).
