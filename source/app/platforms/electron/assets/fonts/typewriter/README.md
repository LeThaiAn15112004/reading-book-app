# Typewriter fonts

Static font files used BOTH to show Typewriter notes in the reader and to embed (as subsets) in PDFs.
Spec: `specs/005-typewriter-note/` (research D4, D5; plan milestone M0).

Filled in T004: see `COVERAGE.md`. Every file added here must first be checked and recorded in `COVERAGE.md`:

1. **Licence** permits embedding in documents and redistribution with the app (SIL OFL 1.1 or Apache-2.0);
   the licence text and copyright go into `THIRD_PARTY_FONTS.md` (M0-6).
2. **`OS/2.fsType`** allows embedding (installable or editable, not restricted).
3. **Vietnamese coverage**: every precomposed Vietnamese letter (each vowel x tone, upper and lower case,
   plus Đ/đ) has a glyph (M0-1). A face that misses one is dropped.
4. **Real faces**: bold and italic are genuine font files, never synthesized.
