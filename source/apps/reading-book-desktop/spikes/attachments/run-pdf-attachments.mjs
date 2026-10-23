/**
 * PDF attachment checks: the REAL PDF.js reader (`electron/attachments/pdf-attachments.ts`), the REAL
 * Main service (`attachment-service.ts`) on real temp files, and the REAL renderer zustand store —
 * with the OS opener and the save dialog mocked (nothing external is ever launched and no window
 * is shown). Only the IPC hop is a direct call (`window.api.attachments`).
 *
 *   1. listing      document-level + page-level files, any extension, empty / missing metadata, duplicates
 *   2. identity     ids are stable, distinct for duplicates, bound to THIS file's content
 *   3. open         temp file, containment, sanitised names, mocked OS call, errors
 *   4. policy       prohibited / disguised / extension-less files are blocked; Save As is separate
 *   5. limits       empty, malformed, > 100 MB (on the extracted bytes)
 *   6. authorization  ids validated, non-PDF books, an attachment of ANOTHER pdf, single in-flight open
 *   7. integrity    the original PDF is never modified; temp cleanup
 *   8. store        double-click → confirm → one open; Cancel never extracts; blocked → explicit Save As
 *   9. wiring       channels / preload / registration / no shell or child_process
 *
 * Run: npm run spike:pdf:attachments   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildPdf } from './pdf-fixtures.mjs'

const { listPdfAttachmentBytes, extractPdfAttachmentBytes } = await import('../../electron/attachments/pdf-attachments.ts')
const { createAttachmentService, cleanAttachmentTemp } = await import('../../electron/attachments/attachment-service.ts')
const { ATTACHMENT_MAX_BYTES } = await import('@reading-book/book-reader-sdk')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-attachments-'))
const tempRoot = path.join(tmp, 'attachment-tmp')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const text = (s) => new TextEncoder().encode(s)

// ---- fixtures -------------------------------------------------------------------------------
const files = {}
function addPdf(id, bytes) {
  const file = path.join(tmp, `${id}.pdf`)
  fs.writeFileSync(file, bytes)
  files[id] = { path: file, bytes, sha: sha(bytes) }
}
addPdf('plain', buildPdf({ pages: 2 }))
addPdf(
  'docs',
  buildPdf({
    pages: 2,
    docFiles: [
      { name: 'notes.txt', desc: 'Meeting notes', data: text('hello notes') },
      { name: 'README', data: text('no extension here') },
      { name: 'setup.exe', data: text('MZ-but-named-exe') },
      { name: 'dup.txt', data: text('first copy') },
      { name: 'dup.txt', data: text('second copy') },
      { name: 'same.txt', data: text('identical') },
      { name: 'same.txt', data: text('identical') },
    ],
  }),
)
addPdf(
  'pages',
  buildPdf({
    pages: 3,
    pageFiles: [
      { page: 2, name: 'figure.png', desc: 'A figure', data: text('png-ish') },
      { page: 2, name: 'second.csv', data: text('a,b') },
      { page: 3, name: 'appendix.txt', data: text('appendix') },
    ],
  }),
)
addPdf(
  'both',
  buildPdf({
    pages: 2,
    docFiles: [{ name: 'doc.txt', data: text('doc level') }],
    pageFiles: [{ page: 1, name: 'page.txt', data: text('page level') }],
  }),
)
addPdf(
  'hostile',
  buildPdf({
    docFiles: [
      { key: 'a', name: '../../evil.txt', data: text('traversal') },
      { key: 'b', name: '..\\..\\evil2.txt', data: text('backslash traversal') },
      { key: 'c', name: 'C:\\Windows\\drop.txt', data: text('absolute') },
      { key: 'd', name: 'invoice.pdf.exe', data: text('double ext') },
      { key: 'e', name: 'holiday.jpg', data: Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]) },
      { key: 'f', name: 'script.txt', data: text('#!/bin/sh\nrm -rf ~') },
      { key: 'g', name: 'CON', data: text('device') },
      { key: 'h', name: 'page.html', data: text('<html></html>') },
    ],
  }),
)
addPdf(
  'odd',
  buildPdf({
    docFiles: [
      { name: null, data: text('nameless') },
      { name: 'empty.txt', data: new Uint8Array(0) },
      { name: 'broken.txt', noStream: true },
    ],
  }),
)
addPdf('garbage', new Uint8Array(text('%PDF-1.7 this is not a pdf at all')))

const idOf = async (id, name, nth = 0) => {
  const { items } = await listPdfAttachmentBytes(files[id].bytes)
  return items.filter((i) => i.name === name)[nth].id
}

// ---- service harness ------------------------------------------------------------------------
function harness(books = { plain: 'plain', docs: 'docs', pages: 'pages', both: 'both', hostile: 'hostile', odd: 'odd', garbage: 'garbage' }) {
  const calls = { open: [], save: 0, read: 0 }
  const state = { openError: '', saveTarget: null, extract: extractPdfAttachmentBytes }
  const svc = createAttachmentService({
    resolvePdf: async (bookId) => {
      if (bookId === 'epub-book') return { ok: false, code: 'not_found' }
      if (bookId === 'gone') return { ok: false, code: 'missing_file' }
      return books[bookId] ? { ok: true, path: files[books[bookId]].path } : { ok: false, code: 'not_found' }
    },
    readFile: async (p) => {
      calls.read += 1
      return new Uint8Array(fs.readFileSync(p))
    },
    list: listPdfAttachmentBytes,
    extract: (bytes, id) => state.extract(bytes, id),
    tempRoot,
    openPath: async (p) => {
      calls.open.push({ path: p, content: fs.existsSync(p) ? fs.readFileSync(p) : null })
      return state.openError
    },
    chooseSaveTarget: async () => {
      calls.save += 1
      return state.saveTarget
    },
    isForbiddenTarget: (target, pdfPath) => path.resolve(target) === path.resolve(pdfPath) || path.resolve(target).startsWith(path.resolve(tempRoot)),
  })
  return { svc, calls, state }
}

console.log('1. listing')
await check('document-level files are listed whatever their extension, with size and description', async () => {
  const { items, truncated } = await listPdfAttachmentBytes(files.docs.bytes)
  assert.equal(truncated, false)
  assert.deepEqual(items.map((i) => i.name).sort(), ['README', 'dup.txt', 'dup.txt', 'notes.txt', 'same.txt', 'same.txt', 'setup.exe'])
  const notes = items.find((i) => i.name === 'notes.txt')
  assert.equal(notes.source, 'document')
  assert.equal(notes.page, null)
  assert.equal(notes.size, 11)
  assert.equal(notes.description, 'Meeting notes')
})
await check('page-level FileAttachment annotations are listed with their page', async () => {
  const { items } = await listPdfAttachmentBytes(files.pages.bytes)
  assert.deepEqual(items.map((i) => [i.name, i.page, i.source]), [
    ['figure.png', 2, 'page'],
    ['second.csv', 2, 'page'],
    ['appendix.txt', 3, 'page'],
  ])
  assert.equal(items[0].description, 'A figure')
})
await check('both sources together: document-level first, then pages', async () => {
  const { items } = await listPdfAttachmentBytes(files.both.bytes)
  assert.deepEqual(items.map((i) => [i.name, i.source]), [['doc.txt', 'document'], ['page.txt', 'page']])
})
await check('a PDF without attachments lists nothing (ordinary resources are not attachments)', async () => {
  assert.deepEqual(await listPdfAttachmentBytes(files.plain.bytes), { items: [], truncated: false })
})
await check('missing metadata: no name → "unnamed", no content → size null, no description → null', async () => {
  const { items } = await listPdfAttachmentBytes(files.odd.bytes)
  assert.equal(items.length, 3)
  assert.ok(items.every((i) => i.name.length > 0))
  assert.ok(items.some((i) => i.name === 'unnamed'))
  assert.equal(items.find((i) => i.name === 'broken.txt').size, null)
  assert.ok(items.every((i) => i.description === null))
})
await check('the listing never carries bytes or paths', async () => {
  const { items } = await listPdfAttachmentBytes(files.docs.bytes)
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['description', 'id', 'name', 'page', 'size', 'source'])
})

console.log('2. identity')
await check('ids are stable across listings and distinct for duplicate names', async () => {
  const a = (await listPdfAttachmentBytes(files.docs.bytes)).items.map((i) => i.id)
  const b = (await listPdfAttachmentBytes(files.docs.bytes)).items.map((i) => i.id)
  assert.deepEqual(a, b)
  assert.equal(new Set(a).size, a.length)
})
await check('extraction returns the bytes of exactly the id asked for (duplicates are not confused)', async () => {
  const first = await extractPdfAttachmentBytes(files.docs.bytes, await idOf('docs', 'dup.txt', 0))
  const second = await extractPdfAttachmentBytes(files.docs.bytes, await idOf('docs', 'dup.txt', 1))
  assert.equal(new TextDecoder().decode(first.content), 'first copy')
  assert.equal(new TextDecoder().decode(second.content), 'second copy')
  const page = await extractPdfAttachmentBytes(files.both.bytes, await idOf('both', 'page.txt'))
  assert.equal(new TextDecoder().decode(page.content), 'page level')
})
await check('a valid-looking id that is not in the file is not found', async () => {
  const result = await extractPdfAttachmentBytes(files.docs.bytes, 'doc-0-000000000000')
  assert.deepEqual(result, { ok: false, code: 'not_found' })
})

console.log('3. open')
await check('open writes a temp copy inside the Main temp root and calls the OS once with it', async () => {
  const { svc, calls } = harness()
  const result = await svc.open('docs', await idOf('docs', 'notes.txt'))
  assert.deepEqual(result, { ok: true, fileName: 'notes.txt' })
  assert.equal(calls.open.length, 1)
  const opened = calls.open[0]
  assert.equal(path.basename(opened.path), 'notes.txt')
  assert.ok(path.resolve(opened.path).startsWith(path.resolve(tempRoot) + path.sep))
  assert.equal(path.dirname(path.dirname(opened.path)), tempRoot)
  assert.equal(opened.content.toString(), 'hello notes')
  assert.equal(calls.save, 0)
})
await check('two opens of same-named files never collide (fresh directory each)', async () => {
  const { svc, calls } = harness()
  await svc.open('docs', await idOf('docs', 'dup.txt', 0))
  await svc.open('docs', await idOf('docs', 'dup.txt', 1))
  assert.notEqual(path.dirname(calls.open[0].path), path.dirname(calls.open[1].path))
  assert.equal(calls.open[0].content.toString(), 'first copy')
  assert.equal(calls.open[1].content.toString(), 'second copy')
})
await check('page-level attachments open the same way', async () => {
  const { svc, calls } = harness()
  assert.deepEqual(await svc.open('pages', await idOf('pages', 'figure.png')), { ok: true, fileName: 'figure.png' })
  assert.equal(calls.open.length, 1)
})
await check('traversal / absolute / device names are reduced to a safe basename inside the temp dir', async () => {
  const { svc, calls } = harness()
  const listed = (await listPdfAttachmentBytes(files.hostile.bytes)).items
  for (const safeName of ['evil.txt', 'evil2.txt', 'drop.txt']) {
    const item = listed.find((i) => i.name === safeName)
    assert.ok(item, safeName)
    const result = await svc.open('hostile', item.id)
    assert.equal(result.ok, true, safeName)
    const opened = calls.open.at(-1).path
    assert.equal(path.dirname(path.dirname(opened)), tempRoot, safeName)
    assert.equal(path.basename(opened), safeName)
  }
  const names = (await listPdfAttachmentBytes(files.hostile.bytes)).items.map((i) => i.name)
  assert.ok(names.includes('evil.txt') && names.includes('evil2.txt') && names.includes('drop.txt') && names.includes('_CON'))
  assert.ok(!fs.existsSync(path.join(tmp, '..', 'evil.txt')))
})
await check('an OS opening failure is reported as open_failed and leaves no temp file behind', async () => {
  const { svc, calls, state } = harness()
  state.openError = 'no association'
  const result = await svc.open('docs', await idOf('docs', 'notes.txt'))
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'open_failed')
  assert.match(result.errorMessage, /No application could open/)
  assert.equal(calls.open.length, 1)
  assert.equal(fs.existsSync(path.dirname(calls.open[0].path)), false)
})
await check('an extraction failure is reported as extract_failed (nothing opened)', async () => {
  const { svc, calls } = harness()
  const result = await svc.open('garbage', 'doc-0-000000000000')
  assert.equal(result.errorCode, 'extract_failed')
  assert.equal(calls.open.length, 0)
  const listed = await svc.list('garbage')
  assert.equal(listed.ok, false)
  assert.equal(listed.errorCode, 'extract_failed')
})
await check('a book whose file is gone reports missing_file', async () => {
  const { svc } = harness()
  assert.equal((await svc.list('gone')).errorCode, 'missing_file')
})

console.log('4. policy and Save As')
await check('prohibited types are blocked before anything is written or launched', async () => {
  const before = fs.existsSync(tempRoot) ? fs.readdirSync(tempRoot).length : 0
  const { svc, calls } = harness()
  for (const name of ['setup.exe']) {
    const result = await svc.open('docs', await idOf('docs', name))
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'blocked')
    assert.equal(result.fileName, name)
  }
  const hostile = (await listPdfAttachmentBytes(files.hostile.bytes)).items
  for (const name of ['invoice.pdf.exe', 'page.html']) {
    assert.equal((await svc.open('hostile', hostile.find((i) => i.name === name).id)).errorCode, 'blocked', name)
  }
  assert.equal(calls.open.length, 0)
  assert.equal(calls.save, 0)
  assert.equal(fs.existsSync(tempRoot) ? fs.readdirSync(tempRoot).length : 0, before)
})
await check('executable / script content behind a harmless name, and a missing extension, are blocked', async () => {
  const { svc, calls } = harness()
  const hostile = (await listPdfAttachmentBytes(files.hostile.bytes)).items
  assert.equal((await svc.open('hostile', hostile.find((i) => i.name === 'holiday.jpg').id)).errorCode, 'blocked')
  assert.equal((await svc.open('hostile', hostile.find((i) => i.name === 'script.txt').id)).errorCode, 'blocked')
  assert.equal((await svc.open('docs', await idOf('docs', 'README'))).errorCode, 'blocked')
  assert.equal(calls.open.length, 0)
})
await check('Save As is a separate explicit call: the dialog opens only then, and the bytes are written unchanged', async () => {
  const { svc, calls, state } = harness()
  const id = await idOf('docs', 'setup.exe')
  assert.equal((await svc.open('docs', id)).errorCode, 'blocked')
  assert.equal(calls.save, 0)
  state.saveTarget = path.join(tmp, 'saved-setup.exe')
  assert.deepEqual(await svc.saveAs('docs', id), { ok: true, fileName: 'saved-setup.exe' })
  assert.equal(calls.save, 1)
  assert.equal(fs.readFileSync(state.saveTarget).toString(), 'MZ-but-named-exe')
  assert.equal(calls.open.length, 0)
})
await check('Save As: cancel writes nothing; the book file and the temp root are refused as targets', async () => {
  const { svc, state } = harness()
  const id = await idOf('docs', 'setup.exe')
  state.saveTarget = null
  assert.equal((await svc.saveAs('docs', id)).errorCode, 'canceled')
  state.saveTarget = files.docs.path
  assert.equal((await svc.saveAs('docs', id)).errorCode, 'access_denied')
  state.saveTarget = path.join(tempRoot, 'x.exe')
  assert.equal((await svc.saveAs('docs', id)).errorCode, 'access_denied')
  assert.equal(sha(fs.readFileSync(files.docs.path)), files.docs.sha)
  state.saveTarget = path.join(tmp, 'no-such-dir', 'x.exe')
  const failed = await svc.saveAs('docs', id)
  assert.equal(failed.ok, false)
  assert.equal(failed.errorCode, 'write_failed')
})

console.log('5. limits and malformed data')
await check('an empty attachment and a record with no data are reported as empty', async () => {
  const { svc, calls } = harness()
  assert.equal((await svc.open('odd', await idOf('odd', 'empty.txt'))).errorCode, 'empty')
  assert.equal((await svc.open('odd', await idOf('odd', 'broken.txt'))).errorCode, 'empty')
  assert.equal(calls.open.length, 0)
})
await check('the 100 MB limit is applied to the extracted bytes, not to declared metadata', async () => {
  const { svc, calls, state } = harness()
  const id = await idOf('docs', 'notes.txt')
  state.extract = async () => ({ ok: true, name: 'big.txt', content: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) })
  const refused = await svc.open('docs', id)
  assert.equal(refused.errorCode, 'too_large')
  assert.equal(calls.open.length, 0)
  state.extract = async () => ({ ok: true, name: 'edge.txt', content: new Uint8Array(ATTACHMENT_MAX_BYTES) })
  assert.equal((await svc.open('docs', id)).ok, true)
  assert.equal(calls.open.at(-1).content.byteLength, ATTACHMENT_MAX_BYTES)
  await cleanAttachmentTemp(tempRoot)
  state.extract = async () => ({ ok: false, code: 'too_large' })
  assert.equal((await svc.open('docs', id)).errorCode, 'too_large')
})

console.log('6. authorization')
await check('malformed ids are rejected before any file is read', async () => {
  const { svc, calls } = harness()
  for (const [book, att] of [['', 'doc-0-000000000000'], ['docs', '../../etc/passwd'], ['docs', ''], [null, 'doc-0-000000000000'], ['docs', 7], ['x'.repeat(300), 'doc-0-000000000000']]) {
    assert.equal((await svc.open(book, att)).errorCode, 'invalid_request')
    assert.equal((await svc.saveAs(book, att)).errorCode, 'invalid_request')
  }
  assert.equal((await svc.list('')).errorCode, 'invalid_request')
  assert.equal(calls.read, 0)
})
await check('a non-PDF or unknown book is not_found', async () => {
  const { svc } = harness()
  assert.equal((await svc.open('epub-book', 'doc-0-000000000000')).errorCode, 'not_found')
  assert.equal((await svc.list('nope')).errorCode, 'not_found')
})
await check('an attachment id that belongs to ANOTHER pdf is refused for this book', async () => {
  const { svc, calls } = harness()
  const idOfDocs = await idOf('docs', 'notes.txt')
  const result = await svc.open('both', idOfDocs)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'attachment_not_found')
  assert.equal(calls.open.length, 0)
})
await check('only one open per attachment runs at a time (a repeat while busy is refused)', async () => {
  const { svc, calls } = harness()
  const id = await idOf('docs', 'notes.txt')
  const [a, b] = await Promise.all([svc.open('docs', id), svc.open('docs', id)])
  assert.deepEqual([a.ok, b.ok].sort(), [false, true])
  assert.ok([a, b].some((r) => r.errorCode === 'busy'))
  assert.equal(calls.open.length, 1)
})

console.log('7. integrity')
await check('no operation modified any PDF', () => {
  for (const f of Object.values(files)) assert.equal(sha(fs.readFileSync(f.path)), f.sha)
})
await check('temp cleanup removes the root; a missing root is fine', async () => {
  assert.equal(await cleanAttachmentTemp(tempRoot), true)
  assert.equal(fs.existsSync(tempRoot), false)
  assert.equal(await cleanAttachmentTemp(tempRoot), true)
})

console.log('8. renderer store (real store → real service → real PDF.js)')
{
  const h = harness()
  const api = {
    attachments: {
      list: (bookId) => h.svc.list(bookId),
      open: (input) => {
        api.counts.open += 1
        return h.svc.open(input.bookId, input.attachmentId)
      },
      saveAs: (input) => {
        api.counts.saveAs += 1
        return h.svc.saveAs(input.bookId, input.attachmentId)
      },
    },
    counts: { open: 0, saveAs: 0 },
  }
  globalThis.window = { api }
  const { useAttachmentsStore } = await import('../../src/screens/Reader/logic/attachments/attachmentsStore.ts')
  const store = useAttachmentsStore
  const reset = () => {
    store.getState().reset()
    api.counts.open = 0
    api.counts.saveAs = 0
    h.calls.open.length = 0
    h.calls.save = 0
    h.state.openError = ''
    h.state.saveTarget = null
  }
  const find = (name) => store.getState().items.find((i) => i.name === name)

  await check('load lists the PDF’s attachments; a PDF without any is an empty ready state', async () => {
    reset()
    await store.getState().load('docs')
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().items.length, 7)
    await store.getState().load('plain')
    assert.equal(store.getState().status, 'ready')
    assert.deepEqual(store.getState().items, [])
    await store.getState().load('garbage')
    assert.equal(store.getState().status, 'error')
    assert.ok(store.getState().loadError)
  })
  await check('double-click shows the confirmation; Cancel never extracts or launches anything', async () => {
    reset()
    await store.getState().load('docs')
    store.getState().requestOpen(find('notes.txt'))
    store.getState().requestOpen(find('notes.txt'))
    assert.equal(store.getState().confirming.name, 'notes.txt')
    assert.equal(api.counts.open, 0)
    store.getState().cancelOpen()
    assert.equal(store.getState().confirming, null)
    await store.getState().confirmOpen()
    assert.equal(api.counts.open, 0)
    assert.equal(h.calls.open.length, 0)
  })
  await check('Continue triggers exactly one open, even if pressed twice', async () => {
    reset()
    await store.getState().load('docs')
    store.getState().requestOpen(find('notes.txt'))
    await Promise.all([store.getState().confirmOpen(), store.getState().confirmOpen()])
    assert.equal(api.counts.open, 1)
    assert.equal(h.calls.open.length, 1)
    assert.equal(store.getState().busy, false)
    assert.equal(store.getState().notice.kind, 'info')
  })
  await check('a second double-click while a dialog is open or an open is running starts nothing', async () => {
    reset()
    await store.getState().load('docs')
    store.getState().requestOpen(find('notes.txt'))
    store.getState().requestOpen(find('dup.txt'))
    assert.equal(store.getState().confirming.name, 'notes.txt')
    const running = store.getState().confirmOpen()
    store.getState().requestOpen(find('dup.txt'))
    assert.equal(store.getState().confirming, null)
    await running
  })
  await check('an OS failure surfaces the actual error, not an "unsupported type" message', async () => {
    reset()
    await store.getState().load('docs')
    h.state.openError = 'x'
    store.getState().requestOpen(find('notes.txt'))
    await store.getState().confirmOpen()
    const { notice } = store.getState()
    assert.equal(notice.kind, 'error')
    assert.match(notice.message, /No application could open/)
    assert.doesNotMatch(notice.message, /unsupported/i)
  })
  await check('a prohibited file shows the blocked dialog; Save As only runs when asked for', async () => {
    reset()
    await store.getState().load('docs')
    store.getState().requestOpen(find('setup.exe'))
    await store.getState().confirmOpen()
    assert.equal(store.getState().blocked.attachment.name, 'setup.exe')
    assert.equal(h.calls.save, 0)
    assert.equal(api.counts.saveAs, 0)
    store.getState().dismissBlocked()
    assert.equal(h.calls.save, 0)
    store.getState().requestOpen(find('setup.exe'))
    await store.getState().confirmOpen()
    h.state.saveTarget = null
    await store.getState().saveBlocked()
    assert.equal(h.calls.save, 1)
    assert.ok(store.getState().blocked, 'canceling the save dialog keeps the blocked dialog')
    h.state.saveTarget = path.join(tmp, 'from-store.exe')
    await store.getState().saveBlocked()
    assert.equal(store.getState().blocked, null)
    assert.match(store.getState().notice.message, /Saved as/)
    assert.equal(fs.readFileSync(h.state.saveTarget).toString(), 'MZ-but-named-exe')
    assert.equal(h.calls.open.length, 0)
  })
  await check('switching books drops the old list and a late answer for the old book', async () => {
    reset()
    const first = store.getState().load('docs')
    const second = store.getState().load('pages')
    await Promise.all([first, second])
    assert.equal(store.getState().bookId, 'pages')
    assert.deepEqual(store.getState().items.map((i) => i.name), ['figure.png', 'second.csv', 'appendix.txt'])
  })
  delete globalThis.window
}

console.log('9. wiring (static)')
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
await check('channels, preload, api types and registration agree', () => {
  const channels = read('electron/ipc/channels.ts')
  for (const c of ['attachments:list', 'attachments:open', 'attachments:saveAs']) assert.ok(channels.includes(`'${c}'`), c)
  const preload = read('electron/preload.ts')
  for (const c of ['AttachmentChannels.list', 'AttachmentChannels.open', 'AttachmentChannels.saveAs']) assert.ok(preload.includes(c), c)
  assert.match(read('electron/ipc/index.ts'), /registerAttachmentsIpc\(\)/)
  assert.match(read('electron/ipc/api-types.ts'), /attachments: \{/)
  assert.match(read('electron/main.ts'), /disposeAttachmentTemp\(\)/)
})
await check('Main opens files only through shell.openPath: no child_process, exec or openExternal on attachments', () => {
  for (const file of ['electron/attachments/attachment-service.ts', 'electron/attachments/pdf-attachments.ts', 'electron/ipc/attachments.ipc.ts']) {
    const source = read(file)
    assert.doesNotMatch(source, /child_process|execFile|exec\(|spawn|openExternal/, file)
  }
  assert.match(read('electron/ipc/attachments.ipc.ts'), /shell\.openPath\(file\)/)
})
await check('the renderer store touches no filesystem and sends only ids', () => {
  const store = read('src/screens/Reader/logic/attachments/attachmentsStore.ts')
  assert.doesNotMatch(store, /node:|require\(|\bfs\b/)
  const bridge = read('src/bridge/attachments.ts')
  assert.match(bridge, /bookId: string; attachmentId: string/)
})
await check('the PDF-only capability gates the tab', () => {
  const caps = read('src/reader/capabilities.ts')
  assert.match(caps, /pdf: \[[^\]]*'attachments'\]/)
  assert.doesNotMatch(caps, /(epub|txt|md|placeholder): \[[^\]]*'attachments'/)
  assert.match(read('src/screens/Reader/components/sidebar/sidebarTabs.ts'), /id: 'attachments'[^}]*requires: 'attachments'/)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
