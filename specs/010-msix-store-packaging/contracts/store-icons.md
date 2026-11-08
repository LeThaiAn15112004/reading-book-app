# Contract: generated icons

Source: one master PNG (constant `MASTER_ICON` in `source/scripts/store/generate-icons.mjs`; first release
`source/app/platforms/native/assets/images/icon.png`, 1024 × 1024 RGBA). Square, ≥ 1024 px, with alpha, or the
generator stops (`icon_master_invalid`).

Output: `source/app/platforms/electron/build-resources/` (gitignored, emptied and rewritten on every run).

## `appx/` — package logos

`content` = side of the drawn icon inside the canvas as a share of the canvas's shorter side; the rest is transparent.
The drawn icon is never larger than the master (no upscaling).

| Logo (manifest) | Base size | Scales → canvas px | content |
|---|---|---|---|
| `StoreLogo` | 50 × 50 | 100: 50 · 125: 63 · 150: 75 · 200: 100 · 400: 200 | 100 % |
| `Square44x44Logo` | 44 × 44 | 44 · 55 · 66 · 88 · 176 | 66 % (plated) |
| `Square44x44Logo.targetsize-N` | N × N | N ∈ 16, 24, 32, 48, 256 | 100 % |
| `…targetsize-N_altform-unplated` | N × N | same N | 100 %, for dark taskbar |
| `…targetsize-N_altform-lightunplated` | N × N | same N | 100 %, for light taskbar |
| `Square150x150Logo` | 150 × 150 | 150 · 188 · 225 · 300 · 600 | 66 % |
| `Wide310x150Logo` | 310 × 150 | 310×150 · 388×188 · 465×225 · 620×300 · 1240×600 | 66 % of height, centred |
| `SmallTile` (Square71x71) | 71 × 71 | 71 · 89 · 107 · 142 · 284 | 66 % |
| `LargeTile` (Square310x310) | 310 × 310 | 310 · 388 · 465 · 620 · 1240 | 66 % |

File names follow the MRT qualifier form electron-builder detects, e.g. `Square150x150Logo.scale-200.png`,
`Square44x44Logo.targetsize-32_altform-unplated.png`. `BackgroundColor` = `transparent`. No `SplashScreen` /
`BadgeLogo` (desktop apps do not show them).

If the master's art is too dark or too light for one taskbar theme, the `lightunplated` variant may use a second
master (`MASTER_ICON_LIGHT`, optional); without it both variants use the same art.

## `icon.ico` — window, taskbar, NSIS installer

PNG-compressed entries 16, 24, 32, 48, 64, 128, 256, written by `source/scripts/store/ico-writer.mjs`. Referenced by
`win.icon` in `electron-builder.json5`.

## Checks (`check-store-icons.mjs`)

For every row above: file exists; exact pixel size; at least one pixel with alpha > 0 (not blank); `icon.ico` has the
7 entries. Fails listing every missing / wrong file.
