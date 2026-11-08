// Spec 010 T041 — tests for the Store icon generator, ICO writer and checks (contracts/store-icons.md).
// Run: node --test source/scripts/store/icons.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ICO_SIZES, contentBox, expectedAssets, validateMaster } from './generate-icons.mjs'
import { readIcoDirectory, writeIco } from './ico-writer.mjs'

describe('expectedAssets', () => {
  const assets = expectedAssets()
  const byFile = new Map(assets.map((a) => [a.file, a]))

  it('has exactly the 45 PNGs of the contract table (6 logos × 5 scales + 5 target sizes × 3 variants)', () => {
    assert.equal(assets.length, 45)
    assert.equal(new Set(assets.map((a) => a.file)).size, 45)
  })

  const scaled = {
    StoreLogo: [[50, 50], [63, 63], [75, 75], [100, 100], [200, 200]],
    Square44x44Logo: [[44, 44], [55, 55], [66, 66], [88, 88], [176, 176]],
    Square150x150Logo: [[150, 150], [188, 188], [225, 225], [300, 300], [600, 600]],
    Wide310x150Logo: [[310, 150], [388, 188], [465, 225], [620, 300], [1240, 600]],
    SmallTile: [[71, 71], [89, 89], [107, 107], [142, 142], [284, 284]],
    LargeTile: [[310, 310], [388, 388], [465, 465], [620, 620], [1240, 1240]],
  }
  for (const [logo, sizes] of Object.entries(scaled)) {
    it(`${logo} at scale-100/125/150/200/400 with the contract sizes`, () => {
      ;[100, 125, 150, 200, 400].forEach((scale, i) => {
        const a = byFile.get(`${logo}.scale-${scale}.png`)
        assert.ok(a, `${logo}.scale-${scale}.png`)
        assert.deepEqual([a.width, a.height], sizes[i])
      })
    })
  }

  it('Square44x44Logo target sizes 16/24/32/48/256, each plated + unplated + lightunplated, full bleed', () => {
    for (const n of [16, 24, 32, 48, 256]) {
      for (const [suffix, plate] of [['', 'plated'], ['_altform-unplated', 'unplated'], ['_altform-lightunplated', 'lightunplated']]) {
        const a = byFile.get(`Square44x44Logo.targetsize-${n}${suffix}.png`)
        assert.ok(a, `targetsize-${n}${suffix}`)
        assert.deepEqual([a.width, a.height, a.plate, a.content], [n, n, plate, 1])
      }
    }
  })

  it('content share: 100 % for StoreLogo and target sizes, 66 % otherwise', () => {
    for (const a of assets) {
      const full = a.file.startsWith('StoreLogo') || a.file.includes('.targetsize-')
      assert.equal(a.content, full ? 1 : 0.66, a.file)
    }
  })

  it('the ICO has the 7 contract sizes', () => {
    assert.deepEqual(ICO_SIZES, [16, 24, 32, 48, 64, 128, 256])
  })
})

describe('validateMaster', () => {
  it('accepts a square ≥ 1024 px image with alpha', () => {
    assert.equal(validateMaster({ width: 1024, height: 1024, hasAlpha: true }), null)
    assert.equal(validateMaster({ width: 2048, height: 2048, hasAlpha: true }), null)
  })
  for (const [meta, why] of [
    [{ width: 512, height: 512, hasAlpha: true }, 'too small'],
    [{ width: 1024, height: 1000, hasAlpha: true }, 'not square'],
    [{ width: 1024, height: 1024, hasAlpha: false }, 'no alpha'],
    [{ width: undefined, height: undefined, hasAlpha: true }, 'unreadable'],
  ]) {
    it(`refuses a master that is ${why}`, () => {
      const msg = validateMaster(meta)
      assert.match(msg, /needs a square PNG ≥ 1024 px with transparency/)
    })
  }
})

describe('contentBox', () => {
  it('centres the drawn icon and never makes it larger than the master', () => {
    for (const a of expectedAssets()) {
      const box = contentBox(a.width, a.height, a.content, 1024)
      assert.ok(box.side <= 1024, a.file)
      assert.ok(box.side >= 1)
      assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.side <= a.width && box.top + box.side <= a.height, a.file)
    }
  })
  it('sizes a wide logo by its height', () => {
    assert.deepEqual(contentBox(1240, 600, 0.66, 1024), { side: 396, left: 422, top: 102 })
  })
  it('clamps to the master size', () => {
    assert.equal(contentBox(2000, 2000, 1, 1024).side, 1024)
  })
})

describe('writeIco', () => {
  const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]) // only the bytes matter here
  const ico = writeIco(ICO_SIZES.map((size) => ({ size, png: png(size & 0xff) })))

  it('writes ICONDIR: reserved 0, type 1, count 7', () => {
    assert.equal(ico.readUInt16LE(0), 0)
    assert.equal(ico.readUInt16LE(2), 1)
    assert.equal(ico.readUInt16LE(4), 7)
  })
  it('writes one entry per image, 256 stored as 0, offsets pointing at each PNG', () => {
    const dir = readIcoDirectory(ico)
    assert.deepEqual(dir.map((e) => e.size), ICO_SIZES)
    assert.equal(ico[6 + 16 * 6], 0, 'width byte of the 256 entry')
    let offset = 6 + 16 * 7
    for (const e of dir) {
      assert.equal(e.offset, offset)
      assert.equal(e.bytes, 5)
      assert.equal(ico.readUInt32BE(e.offset), 0x89504e47)
      offset += e.bytes
    }
    assert.equal(ico.length, offset)
  })
  it('refuses a size above 256', () => {
    assert.throws(() => writeIco([{ size: 512, png: png(0) }]), /1–256/)
  })
})
