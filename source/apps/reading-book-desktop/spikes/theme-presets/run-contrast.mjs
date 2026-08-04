import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const presetsPath = path.resolve(
  __dirname,
  '../../../../packages/shared/models/reading-prefs.ts',
)
const source = await readFile(presetsPath, 'utf8')

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((value) =>
      value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    )
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  )
  return (lighter + 0.05) / (darker + 0.05)
}

for (const id of ['night', 'sepia', 'paper']) {
  const block = source.match(new RegExp(`${id}: \\{([\\s\\S]*?)\\n  \\},`))?.[1]
  assert.ok(block, `Missing ${id} preset`)
  const color = block.match(/color: '(#[0-9a-f]{6})'/i)?.[1]
  const background = block.match(/background: '(#[0-9a-f]{6})'/i)?.[1]
  assert.ok(color && background, `Missing ${id} body color pair`)
  const ratio = contrastRatio(color, background)
  assert.ok(ratio >= 4.5, `${id} contrast ${ratio.toFixed(2)} is below 4.5:1`)
  console.log(`ok ${id} body contrast ${ratio.toFixed(2)}:1`)
}
