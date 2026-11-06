# T3.1 — EPUB engine spike

PoC harness to compare **epub.js**, **foliate-js**, and a JSZip+iframe baseline.  
**Not** wired from Library → Reader (that is T3.3+).

## Commands

```bash
# From source/apps/reading-book-desktop
npm run spike:epub:fixture   # build fixtures/spike-sample.epub + public copy
npm run spike:epub:eval      # Node packaging / API matrix → MATRIX.md companion JSON
npm run dev                  # then open #/spike/epub
```

## UI harness

Route: `#/spike/epub` (`SpikeEpubScreen`)

- Open fixture as `ArrayBuffer` / `File`
- Switch engines, Prev/Next, theme toggle
- Run all evals and view Pass/Partial/Fail panel

## Decision

See [MATRIX.md](./MATRIX.md) → **epubjs ^0.3.93** (confirmed in SDS §2.10).
