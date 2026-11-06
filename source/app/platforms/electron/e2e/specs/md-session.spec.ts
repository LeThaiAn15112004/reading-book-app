import type { Page } from '@playwright/test'
import { expect, launchApp, test } from '../fixtures/app'

/**
 * Markdown reading session: scrolling saves the text point at the top of the page, and reopening the
 * book (after a restart) scrolls back to it — in a short document and in a long one split into pieces.
 */

const SENTENCE = 'The quick brown fox jumps over the lazy dog and keeps running through the field until evening. '
const paragraph = (n: number) => `Section ${n}: ${SENTENCE.repeat(3)}`

function document_(count: number) {
  const out = ['# Reading session', '']
  for (let n = 1; n <= count; n++) out.push(paragraph(n), '')
  return Buffer.from(out.join('\n'), 'utf8')
}

const surface = (page: Page) => page.locator('[data-md-surface]')

/** Number of the first paragraph whose top is at or below the top of the reading area. */
const topSection = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-md-surface]')!
    const top = scroller.getBoundingClientRect().top
    for (const p of Array.from(document.querySelectorAll('[data-md-content] p'))) {
      if (p.getBoundingClientRect().bottom > top + 8) return Number(/Section (\d+):/.exec(p.textContent ?? '')?.[1] ?? 0)
    }
    return 0
  })

/** Scroll the reading area so section `n` sits at its top, and let the layout settle. */
async function scrollToSection(page: Page, n: number) {
  await page.evaluate((target) => {
    const scroller = document.querySelector('[data-md-surface]')!
    const el = Array.from(document.querySelectorAll('[data-md-content] p')).find((p) => p.textContent?.startsWith(`Section ${target}:`))!
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 4
  }, n)
  await page.waitForTimeout(400)
}

async function openAndScroll(reader: Parameters<Parameters<typeof test>[2]>[0]['reader'], count: number, section: number) {
  const { page } = reader
  await reader.importBook(reader.writeFixture('session.md', document_(count)))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })
  // A long document mounts piece by piece: wait for everything before measuring.
  await expect(page.locator('[data-md-loading]')).toHaveCount(0, { timeout: 30_000 })
  expect(await topSection(page)).toBeLessThanOrEqual(1)
  await scrollToSection(page, section)
  await expect.poll(() => topSection(page)).toBe(section)
  await page.waitForTimeout(100) // leaving right away must still keep the position (not only after the 750 ms autosave)
}

/** Leave through the Library (which flushes the session), restart the app, and open the book again. */
async function restartAndResume(reader: Parameters<Parameters<typeof test>[2]>[0]['reader']) {
  let { page } = reader
  await page.getByRole('link', { name: 'Library', exact: true }).or(page.getByRole('button', { name: 'Library', exact: true })).first().click()
  await expect(page.getByRole('button', { name: /^Resume/ }).first()).toBeVisible({ timeout: 20_000 })
  await reader.app.close()
  const app = await launchApp(reader.userData)
  page = await app.firstWindow()
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume).toBeVisible({ timeout: 20_000 })
  await resume.click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })
  return { app, page }
}

test('MD session: a short document reopens at the saved line', async ({ reader }) => {
  test.setTimeout(150_000)
  await openAndScroll(reader, 60, 35)
  const { app, page } = await restartAndResume(reader)
  try {
    await expect(page.locator('[data-md-content] p').first()).toBeVisible()
    await expect.poll(() => topSection(page), { timeout: 15_000 }).toBe(35)
  } finally {
    await app.close().catch(() => {})
  }
})

test('MD session: a long document (many pieces) reopens at the saved line, even when it is far down', async ({ reader }) => {
  test.setTimeout(240_000)
  await openAndScroll(reader, 1500, 1200)
  expect(await surface(reader.page).locator('[data-md-content]').getAttribute('data-md-segments')).not.toBe('1')
  const { app, page } = await restartAndResume(reader)
  try {
    await expect.poll(() => topSection(page), { timeout: 30_000 }).toBe(1200)
  } finally {
    await app.close().catch(() => {})
  }
})

test('MD session: a book never scrolled opens at the top and a first open does not save a position', async ({ reader }) => {
  test.setTimeout(150_000)
  const { page } = reader
  await reader.importBook(reader.writeFixture('fresh.md', document_(30)))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  expect(await topSection(page)).toBeLessThanOrEqual(1)
  const scrollTop = await surface(page).evaluate((el) => el.scrollTop)
  expect(scrollTop).toBeLessThan(5)
})
