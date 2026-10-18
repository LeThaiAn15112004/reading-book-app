/**
 * Checks for the capability-driven Reader toolbar (docs/implementation_plan/reader_toolbar.md). Pure
 * logic on the real registry / layout modules; no DOM.
 *
 *   1. registry        -> unique ids, known groups, shortcut ids exist in the shortcut registry, every
 *                         tool is shown by at least one surface (no dead entries)
 *   2. surfaces        -> format → surface mapping; EPUB / PDF / TXT / placeholder capability sets (PDF:
 *                         no Aa — its options are EPUB reflow; TXT: text markup + Aa, no Hand / Select,
 *                         no Page layout)
 *   3. EPUB layout     -> exact groups / order at fold level 0
 *   4. placeholder     -> only tools that work without a renderer (no Search / Audio / Translate / markup)
 *   5. folding         -> Annotation / Tools always dropdowns; navigate + settings never fold; clamps
 *   6. no duplicates   -> zoom / fit / fullscreen stay in the footer, not on the toolbar
 *   8. sidebar tabs    -> Page layout tab: PDF and placeholder yes, EPUB no (hidden from the rail, a
 *                         request to open it or a stale selection falls back to Contents); every other
 *                         tab on every surface; ReaderScreen routes rail / sidebar / shortcuts through
 *                         the resolved tab
 *   7. wiring (static) -> every tool id has a `handleTool` branch; no "coming soon" tool stubs; dropdown
 *                         reuses useDismissOnOutsideOrEscape with consumeEscape; PDF gets the toolbar tool
 *                         (Hand / Select), no 1-page / 2-page footer toggle, and a footer inset that
 *                         doesn't read the EPUB view-mode pref
 *
 * Not covered (needs the running app): ResizeObserver-driven folding at real widths, menu positioning,
 * focus / arrow-key behaviour, clicks inside the EPUB iframe closing the menu.
 *
 * Run: npm run spike:reader:toolbar
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const caps = await import('../../src/reader/capabilities.ts')
const registry = await import('../../src/screens/Reader/components/chrome/toolRegistry.ts')
const layoutMod = await import('../../src/screens/Reader/components/chrome/toolbarLayout.ts')
const shortcuts = await import('../../src/shortcuts/shortcutDefinitions.ts')
const sidebarTabs = await import('../../src/screens/Reader/components/sidebar/sidebarTabs.ts')

const { TOOL_REGISTRY, TOOL_GROUPS, FOLD_ORDER, INLINE_MAX } = registry
const { resolveToolbarLayout, foldableGroups } = layoutMod

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const shape = (layout) =>
  layout.map((g) => `${g.group.id}:${g.mode}[${g.tools.map((t) => t.id).join(',')}]`)

const epub = caps.getReaderCapabilities('epub')
const pdf = caps.getReaderCapabilities('pdf')
// The placeholder surface is whatever has no renderer: Markdown stands in (TXT has its own surface now).
const placeholder = caps.getReaderCapabilities('md')
const txt = caps.getReaderCapabilities('txt')

console.log('1. registry')
check('tool ids are unique', () => {
  const ids = TOOL_REGISTRY.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
})
check('every tool belongs to a declared group', () => {
  const groups = new Set(TOOL_GROUPS.map((g) => g.id))
  for (const t of TOOL_REGISTRY) assert.ok(groups.has(t.group), t.id)
  for (const g of FOLD_ORDER) assert.ok(groups.has(g), g)
})
check('shortcut ids exist in the shortcut registry', () => {
  const known = new Set(shortcuts.SHORTCUTS.map((s) => s.id))
  for (const t of TOOL_REGISTRY) if (t.shortcutId) assert.ok(known.has(t.shortcutId), t.id)
})
check('every tool is shown by at least one surface', () => {
  for (const t of TOOL_REGISTRY) {
    assert.ok([epub, placeholder].some((set) => t.requires.every((c) => set.has(c))), t.id)
  }
})

console.log('2. surfaces')
check('epub, pdf and txt map to their own surfaces, everything else to the placeholder', () => {
  assert.equal(caps.readerSurfaceForFormat('epub'), 'epub')
  assert.equal(caps.readerSurfaceForFormat('pdf'), 'pdf')
  assert.equal(caps.readerSurfaceForFormat('txt'), 'txt')
  for (const f of ['md', 'docx', 'doc', null, undefined]) {
    assert.equal(caps.readerSurfaceForFormat(f), 'placeholder', String(f))
  }
})
check('TXT = text markup + snapshot + word count + Aa; no Hand / Select, search painting, audio, translate or pages', () => {
  assert.deepEqual([...txt].sort(), ['markupAnnotations', 'readingSettings', 'snapshot', 'wordCount'])
  assert.ok(!txt.has('interaction') && !txt.has('search') && !txt.has('pageLayout'))
})
check('placeholder is a strict subset of EPUB, apart from Page layout', () => {
  for (const c of placeholder) if (c !== 'pageLayout') assert.ok(epub.has(c), c)
  assert.ok(placeholder.size - 1 < epub.size)
})
check('PDF = placeholder + search + text markup − Aa (no audio / translate yet)', () => {
  const expected = [...placeholder, 'search', 'markupAnnotations'].filter((c) => c !== 'readingSettings')
  assert.deepEqual([...pdf].sort(), expected.sort())
})
check('Aa (readingSettings) stays on EPUB and the placeholder, not PDF', () => {
  assert.ok(epub.has('readingSettings'))
  assert.ok(placeholder.has('readingSettings'))
  assert.ok(!pdf.has('readingSettings'))
})

console.log('3. EPUB layout')
check('groups and order at fold level 0', () => {
  assert.deepEqual(shape(resolveToolbarLayout(epub, 0)), [
    'navigate:inline[hand,select,search,speech,translate]',
    'annotation:inline[highlight,underline,squiggly,strikethrough,replace,insert]',
    'tools:menu[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})
check('no empty View group for EPUB', () => {
  assert.ok(!resolveToolbarLayout(epub, 0).some((g) => g.group.id === 'view'))
})

console.log('3b. TXT layout')
check('TXT toolbar: the inline Annotation icons, Tools, Settings — no Navigate group', () => {
  assert.deepEqual(shape(resolveToolbarLayout(txt, 0)), [
    'annotation:inline[highlight,underline,squiggly,strikethrough,replace,insert]',
    'tools:menu[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})

console.log('4. placeholder layout')
check('only renderer-independent tools', () => {
  assert.deepEqual(shape(resolveToolbarLayout(placeholder, 0)), [
    'navigate:inline[hand,select]',
    'tools:menu[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})

check('PDF layout: Search in the navigate group, the inline Annotation icons, no Settings group', () => {
  assert.deepEqual(shape(resolveToolbarLayout(pdf, 0)), [
    'navigate:inline[hand,select,search]',
    'annotation:inline[highlight,underline,squiggly,strikethrough,replace,insert]',
    'tools:menu[snapshot,wordCount]',
  ])
})

console.log('5. folding')
check('Tools is always a dropdown, Annotation always inline icons; nothing left to fold for EPUB', () => {
  assert.equal(TOOL_GROUPS.find((g) => g.id === 'tools').collapse, 'always')
  assert.equal(TOOL_GROUPS.find((g) => g.id === 'annotation').collapse, 'never')
  assert.deepEqual(foldableGroups(epub), [])
  assert.deepEqual(shape(resolveToolbarLayout(epub, 2)), shape(resolveToolbarLayout(epub, 0)))
})
check('levels beyond the foldable count clamp; negatives act as 0', () => {
  assert.deepEqual(shape(resolveToolbarLayout(epub, 9)), shape(resolveToolbarLayout(epub, 2)))
  assert.deepEqual(shape(resolveToolbarLayout(epub, -1)), shape(resolveToolbarLayout(epub, 0)))
})
check('navigate and settings never fold', () => {
  for (const g of TOOL_GROUPS) if (g.id === 'navigate' || g.id === 'settings') assert.equal(g.collapse, 'never')
  for (const level of [0, 1, 2, 3]) {
    for (const g of resolveToolbarLayout(epub, level)) {
      if (g.group.collapse === 'never') assert.equal(g.mode, 'inline')
    }
  }
})
check('groups over INLINE_MAX are always menus (rule)', () => {
  assert.equal(INLINE_MAX, 4)
  for (const g of resolveToolbarLayout(epub, 0)) {
    if (g.group.collapse === 'auto' && g.tools.length > INLINE_MAX) assert.equal(g.mode, 'menu')
  }
})

console.log('6. no duplicates with the footer')
check('no view.* shortcut / zoom / fullscreen tool on the toolbar', () => {
  for (const t of TOOL_REGISTRY) {
    assert.ok(!t.shortcutId?.startsWith('view.'), t.id)
    assert.ok(!/zoom|fullscreen|fit/i.test(t.id), t.id)
  }
})

console.log('7. wiring (static)')
const screen = readFileSync(
  new URL('../../src/screens/Reader/ReaderScreen.tsx', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const menu = readFileSync(
  new URL('../../src/screens/Reader/components/chrome/ToolGroupMenu.tsx', import.meta.url),
  'utf8',
)
const handleToolBody = (() => {
  const start = screen.indexOf('function handleTool(')
  assert.ok(start >= 0, 'handleTool not found')
  return screen.slice(start, screen.indexOf('\n  }\n', start))
})()
check('handleTool has a branch for every tool', () => {
  for (const t of TOOL_REGISTRY) assert.ok(handleToolBody.includes(`case '${t.id}':`), t.id)
})
check('no "coming soon" stubs behind toolbar tools', () => {
  assert.ok(!/coming soon/i.test(handleToolBody))
})
check('dropdown closes on outside click (incl. iframe) and consumes Escape', () => {
  assert.match(menu, /useDismissOnOutsideOrEscape\(menuRef, onDismiss, \{[^}]*consumeEscape: true/)
})
const pdfRendererJsx = (() => {
  const start = screen.search(/<PdfRenderer\s/)
  assert.ok(start >= 0, '<PdfRenderer> not found')
  return screen.slice(start, screen.indexOf('/>', start))
})()
check('PdfRenderer gets the toolbar tool, Hand pan and center tap', () => {
  for (const prop of ['interactionTool={activeTool}', 'onHandPanBy=', 'onCenterTap=']) {
    assert.ok(pdfRendererJsx.includes(prop), prop)
  }
})
check('footer: no 1-page / 2-page toggle for PDF and TXT (both continuous scroll); inset ignores the EPUB view-mode pref', () => {
  assert.match(screen, /onLayoutChange=\{\s*isPdfSurface \|\| isTxtSurface\s*\?\s*undefined/)
  assert.match(screen, /readerChromeBottomInset\(\s*isPdfSurface \|\| isTxtSurface \? 'scroll' : book\.prefs\.viewMode/)
})

console.log('8. sidebar tabs')
const railIds = (set) => sidebarTabs.sidebarTabsFor(set).map((t) => t.id)
check('TXT has no Page layout tab (one continuous text, no pages)', () => {
  assert.ok(!txt.has('pageLayout'))
  assert.ok(!railIds(txt).includes('layout'))
})
check('Page layout capability: PDF and placeholder only', () => {
  assert.ok(pdf.has('pageLayout'))
  assert.ok(placeholder.has('pageLayout'))
  assert.ok(!epub.has('pageLayout'))
})
check('rail: PDF keeps every tab including Page layout', () => {
  assert.deepEqual(railIds(pdf), ['chapters', 'bookmarks', 'highlights', 'layout', 'attachments'])
})
check('rail: EPUB hides only Page layout', () => {
  assert.deepEqual(railIds(epub), ['chapters', 'bookmarks', 'highlights', 'attachments'])
})
check('rail: TXT hides Page layout like EPUB (no pages)', () => {
  assert.deepEqual(railIds(txt), ['chapters', 'bookmarks', 'highlights', 'attachments'])
})
check('rail: other formats unchanged (placeholder keeps Page layout)', () => {
  for (const f of ['md', 'docx', 'doc', null]) {
    assert.deepEqual(railIds(caps.getReaderCapabilities(f)), sidebarTabs.SIDEBAR_TABS.map((t) => t.id), String(f))
  }
})
check('opening / showing Page layout on EPUB resolves to Contents; other tabs untouched', () => {
  assert.equal(sidebarTabs.resolveSidebarTab('layout', epub), 'chapters')
  assert.equal(sidebarTabs.isSidebarTabAvailable('layout', epub), false)
  for (const tab of ['chapters', 'bookmarks', 'highlights', 'attachments']) {
    assert.equal(sidebarTabs.resolveSidebarTab(tab, epub), tab)
  }
})
check('PDF -> EPUB -> PDF: a stale Page layout selection is hidden on EPUB, usable again on PDF', () => {
  const stale = 'layout'
  assert.equal(sidebarTabs.resolveSidebarTab(stale, pdf), 'layout')
  assert.equal(sidebarTabs.resolveSidebarTab(stale, epub), 'chapters')
  assert.equal(sidebarTabs.resolveSidebarTab(stale, pdf), 'layout')
})
check('ReaderScreen routes rail, sidebar and shortcuts through the resolved tab', () => {
  assert.match(screen, /const sidebarTab = resolveSidebarTab\(chrome\.sidebarTab, readerCapabilities\)/)
  assert.match(screen, /chromeOpenSidebarTab\(resolveSidebarTab\(tab, readerCapabilities\)\)/)
  assert.match(screen, /activeTab=\{sidebarTab\}\s+tabs=\{sidebarTabs\}/)
  assert.match(screen, /onOpenTab=\{openSidebarTab\}/)
  assert.match(screen, /tab=\{sidebarTab\}/)
  assert.match(screen, /sidebarTab,\s+openSidebarTab,/)
  assert.doesNotMatch(screen, /chrome\.sidebarTab\}|onOpenTab=\{chrome\.openSidebarTab\}/)
})

console.log(`\n${passed} checks passed`)
