/**
 * T4.3 round-trip checks for session location packing + SQLite UPSERT.
 * Uses Node built-in `node:sqlite` (no Electron-native better-sqlite3).
 * Run: node spikes/session-store/run-roundtrip.mjs
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const STARTED = 'Started'
const IN_PROGRESS = 'In progress'

function packSessionLocation(locationPlain, label) {
  const plain = { ...locationPlain }
  const trimmed = typeof label === 'string' ? label.trim() : ''
  if (trimmed) plain.label = trimmed
  else delete plain.label
  return JSON.stringify(plain)
}

function unpackSessionLocation(raw) {
  const trimmed = raw?.trim()
  if (!trimmed || trimmed === STARTED) return undefined
  try {
    const data = JSON.parse(trimmed)
    if (typeof data.kind !== 'string' || !data.kind) return undefined
    const { label, ...rest } = data
    if (rest.kind === 'cfi' && (!rest.cfi || !String(rest.cfi).trim())) {
      return undefined
    }
    return {
      location: rest,
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
    }
  } catch {
    return undefined
  }
}

function displayLabelFromStoredLocation(raw) {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  if (trimmed === STARTED) return STARTED
  const unpacked = unpackSessionLocation(trimmed)
  if (unpacked) return unpacked.label ?? IN_PROGRESS
  try {
    JSON.parse(trimmed)
    return undefined
  } catch {
    return trimmed
  }
}

function isPersistedLocationJson(raw) {
  return unpackSessionLocation(raw) !== undefined
}

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_format TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE reading_session_states (
      book_id TEXT PRIMARY KEY NOT NULL,
      last_read_location TEXT NOT NULL,
      percent REAL NOT NULL DEFAULT 0,
      font_family TEXT,
      font_size REAL,
      font_weight TEXT,
      line_height REAL,
      text_align TEXT,
      layout_mode TEXT,
      page_turn_mode TEXT,
      margins_enabled INTEGER,
      margin_preset TEXT,
      is_landscape INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
    );
  `)
  return db
}

function insertBook(db, id) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO books (id, title, file_path, file_format, sha256, added_at, updated_at)
     VALUES (?, ?, ?, 'epub', ?, ?, ?)`,
  ).run(id, 'Test', `/tmp/${id}.epub`, `hash-${id}`, now, now)
}

function saveSession(db, state) {
  const locationText = packSessionLocation(
    JSON.parse(state.lastReadLocation),
    state.lastReadLabel,
  )
  db.prepare(
    `INSERT INTO reading_session_states (
      book_id, last_read_location, percent,
      font_family, font_size, font_weight, line_height, text_align,
      layout_mode, page_turn_mode, margins_enabled, margin_preset,
      is_landscape, updated_at
    ) VALUES (
      @book_id, @last_read_location, @percent,
      @font_family, @font_size, @font_weight, @line_height, @text_align,
      @layout_mode, @page_turn_mode, @margins_enabled, @margin_preset,
      @is_landscape, @updated_at
    )
    ON CONFLICT(book_id) DO UPDATE SET
      last_read_location = excluded.last_read_location,
      percent = excluded.percent,
      font_family = excluded.font_family,
      font_size = excluded.font_size,
      font_weight = excluded.font_weight,
      line_height = excluded.line_height,
      text_align = excluded.text_align,
      layout_mode = excluded.layout_mode,
      page_turn_mode = excluded.page_turn_mode,
      margins_enabled = excluded.margins_enabled,
      margin_preset = excluded.margin_preset,
      is_landscape = excluded.is_landscape,
      updated_at = excluded.updated_at`,
  ).run({
    book_id: state.bookId,
    last_read_location: locationText,
    percent: state.percent,
    font_family: state.fontFamily ?? null,
    font_size: state.fontSize,
    font_weight: state.fontWeight ?? null,
    line_height: state.lineHeight ?? null,
    text_align: state.textAlign ?? null,
    layout_mode: state.layoutMode ?? null,
    page_turn_mode: state.pageTurnMode ?? null,
    margins_enabled:
      state.marginsEnabled === undefined ? null : state.marginsEnabled ? 1 : 0,
    margin_preset: state.marginPreset ?? null,
    is_landscape: state.isLandscape ? 1 : 0,
    updated_at: state.updatedAt,
  })
}

function getSession(db, bookId) {
  const row = db
    .prepare(
      `SELECT last_read_location, percent, font_family, font_size, font_weight,
              line_height, text_align, layout_mode, page_turn_mode,
              margins_enabled, margin_preset, is_landscape, updated_at
       FROM reading_session_states WHERE book_id = ?`,
    )
    .get(bookId)
  if (!row) return undefined
  const unpacked = unpackSessionLocation(row.last_read_location)
  if (!unpacked) return undefined
  return {
    bookId,
    lastReadLocation: JSON.stringify(unpacked.location),
    lastReadLabel: unpacked.label,
    percent: row.percent,
    fontFamily: row.font_family ?? undefined,
    fontSize: row.font_size,
    fontWeight: row.font_weight ?? undefined,
    lineHeight: row.line_height ?? undefined,
    textAlign: row.text_align ?? undefined,
    layoutMode: row.layout_mode ?? undefined,
    pageTurnMode: row.page_turn_mode ?? undefined,
    marginsEnabled:
      row.margins_enabled === null ? undefined : row.margins_enabled === 1,
    marginPreset: row.margin_preset ?? undefined,
    isLandscape: row.is_landscape === 1,
    updatedAt: row.updated_at,
  }
}

function getSummary(db, bookId) {
  const row = db
    .prepare(
      `SELECT last_read_location, updated_at FROM reading_session_states WHERE book_id = ?`,
    )
    .get(bookId)
  if (!row) return undefined
  const label = displayLabelFromStoredLocation(row.last_read_location)
  if (!label) return undefined
  return { lastReadLocation: label, lastReadAt: row.updated_at }
}

function markAsReading(db, bookId, now = new Date().toISOString()) {
  const existing = db
    .prepare(`SELECT last_read_location FROM reading_session_states WHERE book_id = ?`)
    .get(bookId)
  if (!existing) {
    db.prepare(
      `INSERT INTO reading_session_states (
        book_id, last_read_location, percent, is_landscape, updated_at
      ) VALUES (?, ?, 0, 0, ?)`,
    ).run(bookId, STARTED, now)
    return
  }
  if (isPersistedLocationJson(existing.last_read_location)) {
    db.prepare(
      `UPDATE reading_session_states SET updated_at = ? WHERE book_id = ?`,
    ).run(now, bookId)
    return
  }
  const loc = existing.last_read_location?.trim()
  db.prepare(
    `UPDATE reading_session_states
     SET last_read_location = ?, updated_at = ?
     WHERE book_id = ?`,
  ).run(loc || STARTED, now, bookId)
}

function testPackUnpack() {
  const cfi = { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2/2[chap]/1)' }
  const packed = packSessionLocation(cfi, 'Chapter 3')
  const parsed = JSON.parse(packed)
  assert.equal(parsed.kind, 'cfi')
  assert.equal(parsed.cfi, cfi.cfi)
  assert.equal(parsed.label, 'Chapter 3')

  const unpacked = unpackSessionLocation(packed)
  assert.ok(unpacked)
  assert.equal(unpacked.location.kind, 'cfi')
  assert.equal(unpacked.label, 'Chapter 3')
  assert.equal(displayLabelFromStoredLocation(packed), 'Chapter 3')
  assert.equal(displayLabelFromStoredLocation(STARTED), STARTED)
  assert.equal(displayLabelFromStoredLocation(''), undefined)
  assert.equal(
    displayLabelFromStoredLocation(packSessionLocation(cfi)),
    IN_PROGRESS,
  )
  assert.equal(unpackSessionLocation(STARTED), undefined)
  assert.equal(unpackSessionLocation(''), undefined)
  console.log('ok pack/unpack + display label')
}

function testRoundTrip() {
  const db = createDb()
  const bookId = 'book-1'
  insertBook(db, bookId)

  const cfiJson = JSON.stringify({
    kind: 'cfi',
    cfi: 'epubcfi(/6/14!/4/2/1:0)',
  })
  const updatedAt = '2026-07-29T05:00:00.000Z'

  saveSession(db, {
    bookId,
    lastReadLocation: cfiJson,
    lastReadLabel: 'Chương 3',
    percent: 42.5,
    fontSize: 18,
    fontFamily: 'serif',
    fontWeight: '400',
    lineHeight: 1.65,
    textAlign: 'justify',
    layoutMode: 'single',
    pageTurnMode: 'paginated',
    marginsEnabled: true,
    marginPreset: 'normal',
    isLandscape: false,
    updatedAt,
  })

  const loaded = getSession(db, bookId)
  assert.ok(loaded)
  assert.equal(loaded.lastReadLocation, cfiJson)
  assert.equal(loaded.lastReadLabel, 'Chương 3')
  assert.equal(loaded.percent, 42.5)
  assert.equal(loaded.fontFamily, 'serif')
  assert.equal(loaded.fontWeight, '400')
  assert.equal(loaded.textAlign, 'justify')
  assert.equal(loaded.layoutMode, 'single')
  assert.equal(loaded.pageTurnMode, 'paginated')
  assert.equal(loaded.marginsEnabled, true)
  assert.equal(loaded.marginPreset, 'normal')
  assert.equal(loaded.updatedAt, updatedAt)

  const summary = getSummary(db, bookId)
  assert.deepEqual(summary, {
    lastReadLocation: 'Chương 3',
    lastReadAt: updatedAt,
  })
  assert.ok(!summary.lastReadLocation.includes('epubcfi'))
  assert.ok(!summary.lastReadLocation.includes('{'))

  saveSession(db, {
    bookId,
    lastReadLocation: cfiJson,
    lastReadLabel: 'Chương 4',
    percent: 55,
    fontSize: 20,
    isLandscape: true,
    updatedAt: '2026-07-29T06:00:00.000Z',
  })
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM reading_session_states WHERE book_id = ?`)
    .get(bookId).n
  assert.equal(count, 1)
  const after = getSession(db, bookId)
  assert.equal(after.lastReadLabel, 'Chương 4')
  assert.equal(after.percent, 55)
  assert.equal(after.isLandscape, true)

  db.close()
  console.log('ok SQLite round-trip + UPSERT')
}

function testLegacyAndMarkAsReading() {
  const db = createDb()
  const bookId = 'book-legacy'
  insertBook(db, bookId)

  db.prepare(
    `INSERT INTO reading_session_states (
      book_id, last_read_location, percent, is_landscape, updated_at
    ) VALUES (?, '', 0, 0, ?)`,
  ).run(bookId, '2026-07-29T01:00:00.000Z')
  assert.equal(getSession(db, bookId), undefined)
  assert.equal(getSummary(db, bookId), undefined)

  markAsReading(db, bookId, '2026-07-29T02:00:00.000Z')
  assert.deepEqual(getSummary(db, bookId), {
    lastReadLocation: STARTED,
    lastReadAt: '2026-07-29T02:00:00.000Z',
  })
  assert.equal(getSession(db, bookId), undefined)

  const cfiJson = JSON.stringify({ kind: 'cfi', cfi: 'epubcfi(/6/2!/4)' })
  saveSession(db, {
    bookId,
    lastReadLocation: cfiJson,
    lastReadLabel: 'Intro',
    percent: 10,
    fontSize: 18,
    isLandscape: false,
    updatedAt: '2026-07-29T03:00:00.000Z',
  })

  markAsReading(db, bookId, '2026-07-29T04:00:00.000Z')
  const loaded = getSession(db, bookId)
  assert.ok(loaded)
  assert.equal(loaded.lastReadLabel, 'Intro')
  assert.equal(loaded.lastReadLocation, cfiJson)
  assert.equal(loaded.updatedAt, '2026-07-29T04:00:00.000Z')
  assert.deepEqual(getSummary(db, bookId), {
    lastReadLocation: 'Intro',
    lastReadAt: '2026-07-29T04:00:00.000Z',
  })

  db.close()
  console.log('ok legacy empty/Started + markAsReading preserves CFI')
}

try {
  testPackUnpack()
  testRoundTrip()
  testLegacyAndMarkAsReading()
  console.log(`\nAll T4.3 session-store checks passed (${path.relative(process.cwd(), __dirname)})`)
} catch (err) {
  console.error(err)
  process.exit(1)
}
