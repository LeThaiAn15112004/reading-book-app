# T3.1 — EPUB engine evaluation matrix

**Date:** 2026-07-27  
**Fixture:** `fixtures/spike-sample.epub` (also `public/spikes/spike-sample.epub`)  
**Harness:** `#/spike/epub` (Electron) + `npm run spike:epub:eval` (Node packaging checks)  
**Raw JSON:** `eval-results.json`

## Criteria

| ID | Criterion | Required |
| :--- | :--- | :--- |
| open_arraybuffer | Open from ArrayBuffer / Blob (T3.4-ready) | yes |
| toc | TOC (spine / nav) | yes |
| nav_scroll | Next/prev + scroll mode | yes |
| cfi | CFI / stable location get·set | yes |
| theme_css | Runtime theme/font CSS, no file mutate | yes |
| selection | Text selection in reading surface | yes |
| search | Search-in-book feasible | no |
| electron_vite | Electron/Vite / license / CSP | no |
| maintenance | Maintenance cost | no |

## Results

| Criterion | epub.js (`epubjs@0.3.93`) | foliate-js `@1.0.1` | baseline (JSZip + iframe) |
| :--- | :--- | :--- | :--- |
| open_arraybuffer | **Pass** | **Pass** | **Pass** |
| toc | **Pass** | **Pass** | **Pass** |
| nav_scroll | **Pass** | **Pass** | Partial |
| cfi | **Pass** | **Pass** | **Fail** |
| theme_css | **Pass** | **Pass** | Partial |
| selection | **Pass** | **Pass** | Partial |
| search | Partial | **Pass** | Partial |
| electron_vite | **Pass** | Partial | **Pass** |
| maintenance | Partial | Partial | **Fail** |

## Decision

**Chosen: `epubjs` (epub.js) ^0.3.93**

Reasons:

1. All required criteria Pass; ArrayBuffer open + CFI base + themes/selection APIs match SDS (CFI location, DOM overlay, read-only file).
2. Typed npm package + BSD-2-Clause; aligns with design default in `docs/plan/02_Design.md`.
3. foliate-js is capable (better built-in search) but README warns the API is unstable / not semver-safe — higher risk for MVP.
4. Baseline fails CFI → blocks T4.1 resume and G5 highlights.

Recorded in SDS §2.10 (2026-07-27). Integration into ReaderScreen is **out of scope** for T3.1 (see T3.3 / T3.4).
