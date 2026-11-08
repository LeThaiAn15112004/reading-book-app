// Spec 010 T042 — every Store logo and the desktop icon.ico from ONE master PNG (contracts/store-icons.md, FR-011).
//
//   node source/scripts/store/generate-icons.mjs        (npm run store:icons = this + check-store-icons.mjs)
//
// Output (git-ignored, emptied and rewritten on every run): source/app/platforms/electron/build-resources/
//   appx/<Logo>.scale-<n>.png, appx/Square44x44Logo.targetsize-<n>[_altform-unplated|_altform-lightunplated].png
//   icon.ico  (16–256, PNG entries) — win.icon for the window, taskbar and NSIS installer
// electron-builder's appx target finds the qualified names and runs makepri itself.
//
// The drawn icon is resized from the master onto a transparent canvas of the exact size, centred; it is never
// larger than the master (no upscaling). Cross-platform (sharp).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { writeIco } from './ico-writer.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/** The one source image (first release: the Mobile app icon, 1024 × 1024 RGBA). */
export const MASTER_ICON = 'source/app/platforms/native/assets/images/icon.png'
/** Optional second art for the light taskbar (`_altform-lightunplated`); absent → the master is used. */
export const MASTER_ICON_LIGHT = 'source/app/platforms/electron/store/icon-light.png'
export const OUT_DIR = 'source/app/platforms/electron/build-resources'
export const MIN_MASTER = 1024
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const SCALES = [100, 125, 150, 200, 400]
const PLATED_SHARE = 0.66
const LOGOS = [
  { name: 'StoreLogo', width: 50, height: 50, content: 1 },
  { name: 'Square44x44Logo', width: 44, height: 44, content: PLATED_SHARE },
  { name: 'Square150x150Logo', width: 150, height: 150, content: PLATED_SHARE },
  { name: 'Wide310x150Logo', width: 310, height: 150, content: PLATED_SHARE },
  { name: 'SmallTile', width: 71, height: 71, content: PLATED_SHARE },
  { name: 'LargeTile', width: 310, height: 310, content: PLATED_SHARE },
]
const TARGET_SIZES = [16, 24, 32, 48, 256]
const PLATES = [
  ['', 'plated'],
  ['_altform-unplated', 'unplated'],
  ['_altform-lightunplated', 'lightunplated'],
]

/** Every PNG of the contract table → `{ file, width, height, plate, content }[]` (file names relative to appx/). */
export function expectedAssets() {
  const out = []
  for (const logo of LOGOS) {
    for (const scale of SCALES) {
      out.push({
        file: `${logo.name}.scale-${scale}.png`,
        width: Math.round((logo.width * scale) / 100),
        height: Math.round((logo.height * scale) / 100),
        plate: 'plated',
        content: logo.content,
      })
    }
  }
  for (const n of TARGET_SIZES) {
    for (const [suffix, plate] of PLATES) {
      out.push({ file: `Square44x44Logo.targetsize-${n}${suffix}.png`, width: n, height: n, plate, content: 1 })
    }
  }
  return out
}

/** null when the master is usable, else the `icon_master_invalid` message (contracts/store-build.md). */
export function validateMaster({ width, height, hasAlpha }, file = MASTER_ICON) {
  const ok = Number.isInteger(width) && width === height && width >= MIN_MASTER && hasAlpha === true
  if (ok) return null
  return `Master icon ${file}: ${width ?? '?'}×${height ?? '?'}${hasAlpha ? '' : ', no alpha'}, needs a square PNG ≥ ${MIN_MASTER} px with transparency`
}

/** Side and position of the drawn icon on a `canvasW × canvasH` canvas: `share` of the shorter side, ≤ master. */
export function contentBox(canvasW, canvasH, share, masterSize) {
  const side = Math.max(1, Math.min(masterSize, Math.round(Math.min(canvasW, canvasH) * share)))
  return { side, left: Math.floor((canvasW - side) / 2), top: Math.floor((canvasH - side) / 2) }
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

async function render(masterPath, masterSize, width, height, share) {
  const box = contentBox(width, height, share, masterSize)
  const art = await sharp(masterPath)
    .resize(box.side, box.side, { kernel: 'lanczos3', fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer()
  return sharp({ create: { width, height, channels: 4, background: TRANSPARENT } })
    .composite([{ input: art, left: box.left, top: box.top }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function readMaster(rel) {
  const abs = path.join(repoRoot, rel)
  if (!existsSync(abs)) return { abs, error: `Master icon ${rel}: file not found, needs a square PNG ≥ ${MIN_MASTER} px with transparency` }
  const meta = await sharp(abs).metadata()
  const error = meta.format === 'png' ? validateMaster(meta, rel) : `Master icon ${rel}: not a PNG, needs a square PNG ≥ ${MIN_MASTER} px with transparency`
  return { abs, size: meta.width, error }
}

/** Generates everything into `outDir`. Returns `{ files }`; throws `icon_master_invalid` errors. */
export async function generateIcons({ outDir = path.join(repoRoot, OUT_DIR) } = {}) {
  const master = await readMaster(MASTER_ICON)
  if (master.error) throw Object.assign(new Error(master.error), { code: 'icon_master_invalid' })
  let light = master
  if (existsSync(path.join(repoRoot, MASTER_ICON_LIGHT))) {
    light = await readMaster(MASTER_ICON_LIGHT)
    if (light.error) throw Object.assign(new Error(light.error), { code: 'icon_master_invalid' })
  }

  const appxDir = path.join(outDir, 'appx')
  rmSync(appxDir, { recursive: true, force: true })
  mkdirSync(appxDir, { recursive: true })
  const files = []
  for (const a of expectedAssets()) {
    const src = a.plate === 'lightunplated' ? light : master
    writeFileSync(path.join(appxDir, a.file), await render(src.abs, src.size, a.width, a.height, a.content))
    files.push(`appx/${a.file}`)
  }
  const ico = writeIco(
    await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: await render(master.abs, master.size, size, size, 1) }))),
  )
  writeFileSync(path.join(outDir, 'icon.ico'), ico)
  files.push('icon.ico')
  return { files }
}

async function main() {
  try {
    const { files } = await generateIcons()
    console.log(`store:icons: ${files.length} files from ${MASTER_ICON} → ${OUT_DIR}/`)
    return 0
  } catch (err) {
    console.error(err.code === 'icon_master_invalid' ? `[icon_master_invalid] ${err.message}` : err)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code))
}
