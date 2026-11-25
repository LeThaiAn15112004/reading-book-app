#!/usr/bin/env node
/**
 * Renders the phone app's launcher icon layers and splash image from ONE vector book mark (the same shape and colours
 * as `source/app/platforms/native/assets/images/icon.png`): orange `#F3A93F` book on the navy of the app.
 *
 *   android-icon-foreground.png  1024², book inside the adaptive-icon safe zone (66 / 108 of the canvas), transparent
 *   android-icon-background.png  1024², navy radial gradient
 *   android-icon-monochrome.png  1024², white book (Android 13+ themed icons tint it)
 *   splash-icon.png              1024², book filling the image (expo-splash-screen scales it to `imageWidth`)
 *
 * Usage: `node source/scripts/mobile/render-app-icons.mjs` (needs the `sharp` package from the root node_modules).
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/platforms/native/assets/images')
const ORANGE = '#F3A93F'
const NAVY_CENTER = '#1C3A66'
const NAVY_EDGE = '#10223F'

/** The book, stroke centre-lines, in the 1024 space of icon.png (pages 297–763 wide, spine at 530). */
const BOOK = [
  'M530 430C530 382 492 346 444 346H315V668H466C501 668 530 697 530 732',
  'M530 430C530 382 568 346 616 346H745V668H594C559 668 530 697 530 732',
  'M530 430V732',
]

function bookSvg({ color, scale = 1 }) {
  // Centre of the book's box (315–745, 346–732) moved to the canvas centre, then scaled about it.
  const cx = 530
  const cy = 539
  const transform = `translate(512 512) scale(${scale}) translate(${-cx} ${-cy})`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="${transform}" fill="none" stroke="${color}" stroke-width="37" stroke-linecap="round" stroke-linejoin="round">
    ${BOOK.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`
}

const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="${NAVY_CENTER}"/>
      <stop offset="1" stop-color="${NAVY_EDGE}"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
</svg>`

async function render(svg, file) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file))
  console.log('wrote', file)
}

// The book is 430 px wide in icon.png (42 % of the canvas); the adaptive safe zone is 61 %: keep it near the original.
await render(bookSvg({ color: ORANGE, scale: 1.05 }), 'android-icon-foreground.png')
await render(backgroundSvg, 'android-icon-background.png')
await render(bookSvg({ color: '#FFFFFF', scale: 1.05 }), 'android-icon-monochrome.png')
await render(bookSvg({ color: ORANGE, scale: 1.85 }), 'splash-icon.png')
