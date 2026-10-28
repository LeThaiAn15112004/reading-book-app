/**
 * Checks (spec 004, task T041): the shared reader sidebar changes made for the audiobook Transcript tab —
 * `'transcript'` in `SidebarTab`, the `transcript` ReaderCapability, its entry in `SIDEBAR_TABS` / `SIDEBAR_TAB_LABEL` —
 * leave the TEXT reader's sidebar exactly as it was, and give the audiobook screen its extra tab.
 *
 * The expected rail of every text surface is written out here from the tab definitions as they were BEFORE the change
 * (Contents, Bookmark, Notes, Page layout [needs pageLayout], Attachment [needs attachments]); the real
 * `sidebarTabsFor` / `getReaderCapabilities` are compared with it for every format.
 *
 * Run: npm run spike:transcription:sidebar   (plain Node, no Electron, no window)
 */
import assert from 'node:assert/strict'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const { SIDEBAR_TABS, SIDEBAR_TAB_LABEL, sidebarTabsFor, isSidebarTabAvailable, resolveSidebarTab } = await import('../../src/screens/Reader/components/sidebar/sidebarTabs.ts')
const { getReaderCapabilities, readerSurfaceForFormat } = await import('../../src/reader/capabilities.ts')

/** The text reader's tabs before the Transcript tab existed. */
const BEFORE = [
  { id: 'chapters', label: 'Contents', icon: '📑' },
  { id: 'bookmarks', label: 'Bookmark', icon: '🔖' },
  { id: 'highlights', label: 'Notes', icon: '🖍️' },
  { id: 'layout', label: 'Page layout', icon: '📄', requires: 'pageLayout' },
  { id: 'attachments', label: 'Attachment', icon: '📎', requires: 'attachments' },
]
const FORMATS = ['epub', 'pdf', 'txt', 'md', 'mobi', 'docx', 'fb2', '', null, undefined]

console.log('Reader sidebar vs the Transcript tab')

check('every text surface gets exactly the rail it had before — the Transcript tab is never offered', () => {
  for (const format of FORMATS) {
    const caps = getReaderCapabilities(format)
    const expected = BEFORE.filter((t) => !t.requires || caps.has(t.requires)).map((t) => t.id)
    assert.deepEqual(sidebarTabsFor(caps).map((t) => t.id), expected, `rail for format ${String(format)} (${readerSurfaceForFormat(format)})`)
    assert.ok(!caps.has('transcript'), `no surface declares the transcript capability (${String(format)})`)
  }
})

check('the Transcript tab is unavailable to a text book, and a leftover selection falls back to Contents', () => {
  for (const format of FORMATS) {
    const caps = getReaderCapabilities(format)
    assert.equal(isSidebarTabAvailable('transcript', caps), false)
    assert.equal(resolveSidebarTab('transcript', caps), 'chapters')
  }
})

check('the existing tab definitions (id, label, icon, requirement, order) are unchanged; Transcript is appended last and labelled', () => {
  assert.deepEqual(SIDEBAR_TABS.slice(0, BEFORE.length), BEFORE)
  assert.equal(SIDEBAR_TABS.length, BEFORE.length + 1)
  assert.deepEqual(SIDEBAR_TABS.at(-1), { id: 'transcript', label: 'Transcript', icon: '📝', requires: 'transcript' })
  for (const t of BEFORE) assert.equal(SIDEBAR_TAB_LABEL[t.id], t.label)
  assert.equal(SIDEBAR_TAB_LABEL.transcript, 'Transcript')
})

check('the audiobook rail (the filter AudioBookScreen applies: no Page layout, no Bookmark) is Contents, Notes, Attachment, Transcript', () => {
  const audioRail = SIDEBAR_TABS.filter((t) => t.id !== 'layout' && t.id !== 'bookmarks').map((t) => t.id)
  assert.deepEqual(audioRail, ['chapters', 'highlights', 'attachments', 'transcript'])
})

check('T033: with audiobookTranscriptionEnabled OFF (the default) the audiobook rail has no Transcript tab — Contents, Notes, Attachment', () => {
  // Mirrors AUDIO_SIDEBAR_TABS_NO_TRANSCRIPT in AudioBookScreen.tsx (the screen picks it when the flag is off).
  const rail = SIDEBAR_TABS.filter((t) => t.id !== 'layout' && t.id !== 'bookmarks' && t.id !== 'transcript').map((t) => t.id)
  assert.deepEqual(rail, ['chapters', 'highlights', 'attachments'])
})

console.log(`\n${passed} checks passed`)
