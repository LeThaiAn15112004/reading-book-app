# Third-party fonts

Noto Sans, Noto Serif, Noto Sans Mono — Copyright 2022 The Noto Project Authors
(https://github.com/notofonts/latin-greek-cyrillic). Licensed under the SIL Open Font License 1.1; full text in
`OFL.txt` next to the font files. The fonts are embedded (as subsets) into PDFs the user annotates.

## Files shipped

| File | Family / style | Licence |
|---|---|---|
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `NotoSans-Italic.ttf`, `NotoSans-BoldItalic.ttf` | Noto Sans | SIL OFL 1.1 |
| `NotoSerif-Regular.ttf`, `NotoSerif-Bold.ttf`, `NotoSerif-Italic.ttf`, `NotoSerif-BoldItalic.ttf` | Noto Serif | SIL OFL 1.1 |
| `NotoSansMono-Regular.ttf`, `NotoSansMono-Bold.ttf` | Noto Sans Mono (no italic face — italic is disabled for it, never synthesized) | SIL OFL 1.1 |

The OFL permits embedding the fonts in documents; the embedded copies are **subsets** (only the glyphs a note uses), named with a
`ABCDEF+` subset tag. The licence text is in `OFL.txt`, which the packaged app also carries (`electron-builder.json5` → `files`).
Embedding permission (`OS/2` `fsType`) and character coverage are recorded in `COVERAGE.md`.
