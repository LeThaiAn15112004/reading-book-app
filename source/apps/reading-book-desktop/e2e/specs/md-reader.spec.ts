import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '../fixtures/app'
import { activeTocEntry, openContents, tocEntry } from '../support/reader'

/**
 * Markdown reader (docs/implementation_plan/markdown_reader.md), driven in the BUILT Electron app on
 * a throw-away userData folder and generated fixtures. The window is hidden (rendered off-screen) —
 * see `launchApp` in e2e/fixtures/app.ts. Manual only: `npm run e2e:md`.
 *
 * A — open from the Library, render the content, keep the file untouched, leave and reopen.
 * B — a file above the 5 MB limit is refused with a clear message.
 */

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

const MARKDOWN = [
  '# Tiêu đề chính 🌳',
  '',
  'Đoạn văn có **chữ đậm**, *chữ nghiêng*, ~~gạch ngang~~ và `mã inline`.',
  '',
  '## Danh sách',
  '',
  '- mục một',
  '- mục hai',
  '  - mục con',
  '',
  '1. bước một',
  '2. bước hai',
  '',
  '## Bảng',
  '',
  '| Cột A | Cột B |',
  '|:------|------:|',
  '| a1    | b1    |',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  '[Trang web](https://example.com) và [liên kết nguy hiểm](javascript:window.__pwned=1) và [mục](#bảng).',
  '',
  '![Ảnh cục bộ](img/local.png)',
  '',
  '![Ảnh từ xa](https://example.com/remote.png)',
  '',
  '<script>window.__pwned = 1</script>',
  '<img src="x" onerror="window.__pwned = 1">',
  '',
  'Cuối tài liệu.',
  '',
].join('\r\n')

const surface = (page: import('@playwright/test').Page) => page.locator('[data-md-surface]')

test('A: a Markdown book opens from the Library, renders safely, and survives leaving and reopening', async ({
  reader,
}) => {
  test.setTimeout(120_000)
  const { page } = reader
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MARKDOWN, 'utf8')])
  mkdirSync(path.join(reader.workDir, 'img'))
  writeFileSync(path.join(reader.workDir, 'img', 'local.png'), PNG)
  const file = reader.writeFixture('notes.md', bytes)
  const mtime = statSync(file).mtimeMs

  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })

  const content = page.locator('[data-md-content]')
  // The real content, not the placeholder reading canvas.
  await expect(content.getByRole('heading', { level: 1 })).toHaveText('Tiêu đề chính 🌳')
  await expect(content.getByRole('heading', { level: 2 })).toHaveCount(2)
  await expect(content.locator('ul > li')).toHaveCount(3)
  await expect(content.locator('ol > li')).toHaveCount(2)
  await expect(content.locator('table th')).toHaveText(['Cột A', 'Cột B'])
  await expect(content.locator('pre code')).toContainText('const answer = 42')
  await expect(content.locator('strong')).toHaveText('chữ đậm')
  await expect(content.locator('del')).toHaveText('gạch ngang')
  await expect(content).toContainText('Cuối tài liệu.')
  // BOM / CRLF never leak into the text.
  const shown = await content.evaluate((el) => el.textContent ?? '')
  expect(shown).not.toContain(String.fromCharCode(0xfeff))
  expect(shown).not.toContain(String.fromCharCode(13))

  // The relative image is loaded through the Main protocol; the remote one is not requested.
  const local = content.locator('img[data-md-image="ok"]')
  await expect(local).toHaveCount(1)
  await expect
    .poll(() => local.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await expect(local).toHaveAttribute('src', /^rb-md-asset:\/\/local\/[^/]+\/img\/local\.png$/)
  await expect(content.locator('[data-md-image="blocked"]')).toHaveCount(1)
  await expect(content.locator('img')).toHaveCount(1)

  // Nothing in the file ran, and no link can navigate the window.
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  await expect(content.locator('script')).toHaveCount(0)
  await expect(content.locator('a[href]')).toHaveCount(0)
  const urlBefore = page.url()
  await content.getByRole('link', { name: 'Trang web' }).click()
  await content.getByText('liên kết nguy hiểm').click()
  expect(page.url()).toBe(urlBefore)
  await content.getByRole('link', { name: 'mục', exact: true }).click() // in-document anchor
  expect(page.url()).toBe(urlBefore)
  await expect(surface(page)).toBeVisible()

  // The Reader shell is intact: footer progress, no annotation tools on a read-only surface.
  await expect(page.getByRole('slider', { name: 'Reading progress' })).toBeVisible()

  // The user's file is never written.
  expect(sha(readFileSync(file))).toBe(sha(bytes))
  expect(statSync(file).mtimeMs).toBe(mtime)

  // Leave to the Library and open again from there.
  await page
    .getByRole('link', { name: 'Library', exact: true })
    .or(page.getByRole('button', { name: 'Library', exact: true }))
    .first()
    .click()
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume).toBeVisible({ timeout: 20_000 })
  await resume.click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-md-content]').getByRole('heading', { level: 1 })).toHaveText('Tiêu đề chính 🌳')
})

test('B: a Markdown file above 5 MB is not opened and says why', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  const file = reader.writeFixture('huge.md', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText(/larger than 5 MB/)).toBeVisible({ timeout: 20_000 })
  await expect(surface(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back to Library' })).toBeVisible()
})

test('C: an empty Markdown file opens and says it is empty', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  const file = reader.writeFixture('empty.md', Buffer.alloc(0))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.locator('[data-md-empty]')).toBeVisible({ timeout: 20_000 })
})

test('D: the Contents sidebar lists the headings, jumps to them, and follows the scroll (also in a long document)', async ({
  reader,
}) => {
  test.setTimeout(120_000)
  const { page } = reader
  const filler = 'Đoạn văn dài để tài liệu vượt quá kích thước tách mảnh, có tiếng Việt và emoji 🌳.\n\n'.repeat(500)
  const text = ['# Mở đầu', '', filler, '## Phần con', '', filler, '# Chương giữa', '', filler, '# Kết luận cuối', '', 'Hết.', ''].join('\n')
  expect(text.length).toBeGreaterThan(60_000) // long enough to be split and mounted piece by piece
  const file = reader.writeFixture('long.md', Buffer.from(text, 'utf8'))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })

  await openContents(page)
  // The outline fills in while the rest of the document mounts; nesting follows the heading levels.
  for (const label of ['Mở đầu', 'Phần con', 'Chương giữa', 'Kết luận cuối']) {
    await expect(tocEntry(page, label)).toBeVisible({ timeout: 20_000 })
  }
  await expect(page.getByText('This book has no table of contents.')).toHaveCount(0)
  await expect(activeTocEntry(page)).toHaveAccessibleName('Mở đầu')

  // Jump to the last heading: it ends up at the top of the reading area, and its entry is current.
  await tocEntry(page, 'Kết luận cuối').click()
  const heading = page.locator('[data-md-content]').getByRole('heading', { name: 'Kết luận cuối' })
  await expect
    .poll(async () => {
      const box = await heading.boundingBox()
      return box ? box.y : 99_999
    })
    .toBeLessThan(250)
  await expect(activeTocEntry(page)).toHaveAccessibleName('Kết luận cuối')

  // Scrolling back to the top moves the current entry back.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-md-surface]')!.scrollTop = 0
  })
  await expect(activeTocEntry(page)).toHaveAccessibleName('Mở đầu')

  // A middle entry works too.
  await tocEntry(page, 'Chương giữa').click()
  await expect(activeTocEntry(page)).toHaveAccessibleName('Chương giữa')
})

test('E: links of a table of contents inside the book scroll to their heading (Vietnamese, Japanese, repeats, long document); a missing target and external links are safe', async ({
  reader,
}) => {
  test.setTimeout(180_000)
  const { page, app } = reader
  const filler = 'Đoạn văn dài để tạo khoảng cuộn, có tiếng Việt, 日本語 và emoji 🌳.\n\n'.repeat(450)
  const text = [
    '# Tài liệu',
    '',
    '## Mục lục',
    '',
    // Anchors the way another tool writes them: ASCII slugs, punctuation turned into hyphens.
    '- [1. Giới thiệu](#1-gioi-thieu)',
    '  - [1.1 Bổ sung list 60 mục (31–60)](#11-bo-sung-list-60-muc-31-60)',
    '    - [Phần tiếng Nhật](#日本語の見出し)',
    '- [Trùng tên](#trung-ten)',
    '- [Trùng tên, lần hai](#trung-ten-1)',
    '- [Kết thúc (GitHub kiểu)](#kết-thúc)',
    '- [Không có đích](#khong-co-dich-nay)',
    '- [Trang web](https://example.com/page)',
    '',
    filler,
    '## 1. Giới thiệu',
    '',
    filler,
    '### 1.1 Bổ sung list 60 mục (31–60)',
    '',
    filler,
    '#### 日本語の見出し',
    '',
    filler,
    '## Trùng tên',
    '',
    filler,
    '## Trùng tên',
    '',
    filler,
    '## Kết thúc',
    '',
    'Hết.',
    '',
  ].join('\n')
  expect(text.length).toBeGreaterThan(200_000) // split into many pieces, mounted one by one
  const file = reader.writeFixture('toc.md', Buffer.from(text, 'utf8'))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })

  const content = page.locator('[data-md-content]')
  const scrollTop = () => surface(page).evaluate((el) => el.scrollTop)
  const toTop = () => surface(page).evaluate((el) => { el.scrollTop = 0 })
  const urlBefore = page.url()
  // Links in the text are not real anchors: no href anywhere.
  await expect(content.locator('a[href]')).toHaveCount(0)

  // Click the link, then expect the heading at the top of the reading area, inside THE surface.
  async function followLink(linkName: string, headingName: string, nth = 0) {
    await toTop()
    await content.getByRole('link', { name: linkName, exact: true }).click()
    const heading = content.getByRole('heading', { name: headingName, exact: true }).nth(nth)
    await expect
      .poll(async () => {
        const box = await heading.boundingBox().catch(() => null)
        return box ? Math.round(box.y) : 99_999
      }, { timeout: 30_000 })
      .toBeLessThan(260)
    expect(await scrollTop()).toBeGreaterThan(0)
    expect(page.url()).toBe(urlBefore)
  }

  // First click right after opening: the target is far down, probably not mounted yet.
  await followLink('1. Giới thiệu', '1. Giới thiệu')
  // Nested levels of the in-book table of contents.
  await followLink('1.1 Bổ sung list 60 mục (31–60)', '1.1 Bổ sung list 60 mục (31–60)')
  await followLink('Phần tiếng Nhật', '日本語の見出し')
  // Repeated heading names: the second link goes to the second heading.
  await followLink('Trùng tên', 'Trùng tên', 0)
  await followLink('Trùng tên, lần hai', 'Trùng tên', 1)
  // GitHub-style anchor with diacritics kept.
  await followLink('Kết thúc (GitHub kiểu)', 'Kết thúc')

  // A target that does not exist: nothing moves, nothing navigates, the reader says so.
  await toTop()
  await content.getByRole('link', { name: 'Không có đích', exact: true }).click()
  await expect(page.getByText('That section was not found in this document.')).toBeVisible()
  expect(await scrollTop()).toBe(0)
  expect(page.url()).toBe(urlBefore)
  await expect(surface(page)).toBeVisible()

  // Regression: an external link still goes through Main (stubbed here, nothing is opened).
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as unknown as { __opened: string[] }).__opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  await toTop()
  await content.getByRole('link', { name: 'Trang web', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __opened?: string[] }).__opened ?? []))
    .toEqual(['https://example.com/page'])
  expect(page.url()).toBe(urlBefore)
})

test('F: there is no Hand tool, and text can be selected by dragging', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  const file = reader.writeFixture('select.md', Buffer.from('# Tiêu đề\n\nĐoạn văn đầu tiên để kéo chọn.\n\nĐoạn thứ hai.\n', 'utf8'))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })

  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Hand', exact: true })).toHaveCount(0)

  const para = page.locator('[data-md-content] p', { hasText: 'Đoạn văn đầu tiên' })
  const box = (await para.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected.length).toBeGreaterThan(5)
  expect('Đoạn văn đầu tiên để kéo chọn.').toContain(selected.trim())
})
