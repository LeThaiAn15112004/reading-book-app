# Typewriter font coverage (T004)

Checked 2026-10-27 with `node --experimental-transform-types spikes/pdf-annotations/check-typewriter-fonts.mjs`
(parser: `electron/pdf-sync/pdf-font-embed.ts`). Source: notofonts.github.io (hinted TTF; `NotoSerif-Italic` from the
`unhinted` build, which is the only static build published for it). Licence: SIL OFL 1.1 (`OFL.txt`), copyright
"The Noto Project Authors". `OS/2.fsType` = 0 (installable embedding) for every file.

Vietnamese check: 146 code points = Đ/đ + every vowel (a ă â e ê i o ô ơ u ư y) x (no mark, grave, hook, tilde,
acute, dot below), upper and lower case. Every face has all 146.

| Family id | Face | File | fsType | Vietnamese |
|---|---|---|---|---|
| noto-sans | Regular / Bold / Italic / BoldItalic | NotoSans-*.ttf | 0 | 146/146 |
| noto-serif | Regular / Bold / Italic / BoldItalic | NotoSerif-*.ttf | 0 | 146/146 |
| noto-sans-mono | Regular / Bold (no Italic exists) | NotoSansMono-*.ttf | 0 | 146/146 |

Real faces only; no synthesized bold/italic. The mono family has no italic faces, so italic is disabled there.
