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
// The placeholder surface is whatever has no renderer: an unknown format (null) stands in (TXT and Markdown have their own surfaces now).
const placeholder = caps.getReaderCapabilities(null)
const txt = caps.getReaderCapabilities('txt')
const md = caps.getReaderCapabilities('md')

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
    assert.ok([epub, pdf, txt, placeholder].some((set) => t.requires.every((c) => set.has(c))), t.id)
  }
})

console.log('2. surfaces')
check('epub, pdf, txt and md map to their own surfaces, everything else to the placeholder', () => {
  assert.equal(caps.readerSurfaceForFormat('epub'), 'epub')
  assert.equal(caps.readerSurfaceForFormat('pdf'), 'pdf')
  assert.equal(caps.readerSurfaceForFormat('txt'), 'txt')
  assert.equal(caps.readerSurfaceForFormat('md'), 'md')
  for (const f of [null, undefined]) {
    assert.equal(caps.readerSurfaceForFormat(f), 'placeholder', String(f))
  }
})
check('TXT = EPUB toolbar UI (no audio) + Edit; no pages', () => {
  assert.deepEqual([...txt].sort(), ['markupAnnotations', 'readingSettings', 'search', 'snapshot', 'textEdit', 'translate', 'wordCount'])
  assert.ok(!txt.has('readAloud') && !txt.has('pageLayout'))
})
check('MD = EPUB toolbar UI (no audio); no pages', () => {
  assert.deepEqual([...md].sort(), ['interaction', 'markupAnnotations', 'readingSettings', 'search', 'snapshot', 'translate', 'wordCount'])
})
check('placeholder is a strict subset of EPUB, apart from Page layout', () => {
  for (const c of placeholder) if (c !== 'pageLayout') assert.ok(epub.has(c), c)
  assert.ok(placeholder.size - 1 < epub.size)
})
check('PDF = placeholder + search + text markup + freehand ink + shapes + file attachments + attachments − Aa (no audio / translate yet)', () => {
  const expected = [...placeholder, 'search', 'markupAnnotations', 'inkAnnotations', 'shapeAnnotations', 'typewriterAnnotations', 'fileAttachments', 'attachments'].filter((c) => c !== 'readingSettings')
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
    'tools:inline[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})
check('no empty View group for EPUB', () => {
  assert.ok(!resolveToolbarLayout(epub, 0).some((g) => g.group.id === 'view'))
})

console.log('3b. TXT layout')
check('TXT toolbar: Edit + Search/Translate (no Hand/Select), the inline Annotation icons, Tools, Settings', () => {
  assert.deepEqual(shape(resolveToolbarLayout(txt, 0)), [
    'navigate:inline[edit,search,translate]',
    'annotation:inline[highlight,underline,squiggly,strikethrough,replace,insert]',
    'tools:inline[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})

console.log('4. placeholder layout')
check('only renderer-independent tools', () => {
  assert.deepEqual(shape(resolveToolbarLayout(placeholder, 0)), [
    'navigate:inline[hand,select]',
    'tools:inline[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})

check('PDF layout: Search in the navigate group, the inline Annotation icons, the Freehand group (Freehand + Shapes + Eraser), no Settings group', () => {
  assert.deepEqual(shape(resolveToolbarLayout(pdf, 0)), [
    'navigate:inline[hand,select,search]',
    'annotation:inline[highlight,underline,squiggly,strikethrough,replace,insert]',
    'freehand:inline[pen,shape,eraser,typewriter,fileAttachment]',
    'tools:inline[snapshot,wordCount]',
  ])
})

console.log('5. folding')
check('Tools and Annotation are always inline; nothing left to fold for EPUB', () => {
  assert.equal(TOOL_GROUPS.find((g) => g.id === 'tools').collapse, 'never')
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
  assert.match(screen, /onLayoutChange=\{\s*isPdfSurface \|\| isTextSurface\s*\?\s*undefined/)
  assert.match(screen, /readerChromeBottomInset\(\s*isPdfSurface \|\| isTextSurface \? 'scroll' : book\.prefs\.viewMode/)
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
check('rail: EPUB hides Page layout and Attachment (PDF-only)', () => {
  assert.deepEqual(railIds(epub), ['chapters', 'bookmarks', 'highlights'])
})
check('rail: TXT hides Page layout and Attachment like EPUB', () => {
  assert.deepEqual(railIds(txt), ['chapters', 'bookmarks', 'highlights'])
})
check('rail: MD hides Page layout and Attachment like EPUB', () => {
  assert.deepEqual(railIds(md), ['chapters', 'bookmarks', 'highlights'])
})
check('rail: placeholder keeps Page layout, has no Attachment tab', () => {
  for (const f of [null]) {
    assert.deepEqual(railIds(caps.getReaderCapabilities(f)), sidebarTabs.SIDEBAR_TABS.map((t) => t.id).filter((id) => id !== 'attachments'), String(f))
  }
})
check('Attachment capability: PDF only', () => {
  assert.ok(pdf.has('attachments'))
  for (const other of [epub, txt, md, placeholder]) assert.ok(!other.has('attachments'))
})
check('opening / showing Page layout on EPUB resolves to Contents; other tabs untouched', () => {
  assert.equal(sidebarTabs.resolveSidebarTab('layout', epub), 'chapters')
  assert.equal(sidebarTabs.isSidebarTabAvailable('layout', epub), false)
  for (const tab of ['chapters', 'bookmarks', 'highlights']) {
    assert.equal(sidebarTabs.resolveSidebarTab(tab, epub), tab)
  }
  assert.equal(sidebarTabs.resolveSidebarTab('attachments', epub), 'chapters')
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

const toolsMenu = readFileSync(new URL('../../src/screens/Reader/components/chrome/ToolsMenu.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

check('Eraser mode dropdown: an arrow beside the Eraser only picks the mode; the Eraser button arms whichever mode is set', () => {
  // the arrow sits right after the Eraser button, inside the same tool group
  assert.match(
    toolsMenu,
    /tool\.id === 'eraser' && onEraserMode \? \(\s*<div key=\{tool\.id\} className="contents">\s*\{renderButton\(tool, resolved\.group\.iconOnly\)\}\s*<EraserModeButton/,
  )
  // the arrow only toggles its own menu (never the tool) and exposes menu semantics
  const arrow = toolsMenu.slice(toolsMenu.indexOf('function EraserModeButton'), toolsMenu.indexOf('/** Tooltip: description'))
  assert.match(arrow, /onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/)
  assert.doesNotMatch(arrow, /onTool|handleTool/)
  assert.match(arrow, /aria-haspopup="menu"/)
  assert.match(arrow, /aria-expanded=\{showMenu\}/)
  assert.match(arrow, /aria-label=\{`Eraser mode:/)
  // both modes are offered, the current one is checked, choosing one calls onMode
  assert.match(toolsMenu, /label: 'Stroke Eraser'/)
  assert.match(toolsMenu, /label: 'Partial Eraser'/)
  assert.match(arrow, /active: m\.id === mode/)
  assert.match(arrow, /onSelect: \(\) => onMode\(m\.id\)/)
  // the shared popup closes first, on an outside click and on Escape, and supports arrow keys
  assert.match(menu, /onClose\(false\)\s+item\.onSelect\(\)/)
  assert.match(menu, /useDismissOnOutsideOrEscape\(menuRef, onDismiss, \{ ignoreRef: anchorRef, consumeEscape: true \}\)/)
  assert.match(menu, /ArrowDown/)
})
check('Eraser mode lives in ReaderScreen state (survives switching tools); the Eraser button toggles the tool; the renderer reads the mode', () => {
  assert.match(screen, /const \[eraserMode, setEraserMode\] = useState<EraserMode>\('stroke'\)/)
  assert.match(screen, /onEraserMode=\{setEraserMode\}/)
  assert.match(screen, /case 'eraser':\s+\/\/ Click the armed tool again[^]*selectTool\(\(current\) => \(current === tool \? 'select' : tool\)\)/)
  assert.match(screen, /eraserMode=\{eraserMode\}\s+onInkPartialErase=\{pdfInk\.applyPartialErase\}/)
  assert.doesNotMatch(screen, /setEraserMode\([^)]*\)[^\n]*setActiveTool/)
})
check('Eraser stays PDF-only (capability inkAnnotations) and is left when the surface is not a PDF', () => {
  assert.match(screen, /activeTool === 'pen' \|\| activeTool === 'eraser' \|\| activeTool === 'shape' \|\| activeTool === 'typewriter' \|\| activeTool === 'fileAttachment'\)\) setActiveTool\('select'\)/)
})

console.log('7b. shape tools')
check('Typewriter: PDF-only (capability typewriterAnnotations), last tool of the Freehand group, armed like the other drawing tools', () => {
  assert.ok(pdf.has('typewriterAnnotations'))
  for (const other of [epub, txt, placeholder]) assert.ok(!other.has('typewriterAnnotations'))
  assert.deepEqual(registry.toolsForGroup('freehand', epub).map((t) => t.id), [])
  assert.match(screen, /case 'typewriter':\s*case 'fileAttachment':\s*case 'pen':[^]*case 'eraser':\s*\/\/ Click the armed tool again/)
  assert.match(screen, /activeTool === 'typewriter' \|\| activeTool === 'fileAttachment'\)\) setActiveTool\('select'\)/)
})
check('File Attachment (specs/007): PDF-only (capability fileAttachments), last tool of the Freehand group, armed like the drawing tools, Escape backs out', () => {
  assert.ok(pdf.has('fileAttachments'))
  for (const other of [epub, txt, md, placeholder]) assert.ok(!other.has('fileAttachments'))
  assert.equal(registry.toolsForGroup('freehand', pdf).at(-1)?.id, 'fileAttachment')
  for (const other of [epub, txt, md, placeholder]) assert.ok(!registry.toolsForGroup('freehand', other).some((t) => t.id === 'fileAttachment'))
  assert.match(screen, /fileAttachment: \{ active: activeTool === 'fileAttachment' \}/)
  assert.match(screen, /activeToolRef\.current !== 'fileAttachment'/)
})

check('Shapes: PDF-only (capability shapeAnnotations), sits between Freehand and Eraser, with its own settings arrow that never arms the tool', () => {
  assert.deepEqual(registry.toolsForGroup('freehand', pdf).map((t) => t.id), ['pen', 'shape', 'eraser', 'typewriter', 'fileAttachment'])
  assert.deepEqual(registry.toolsForGroup('freehand', epub).map((t) => t.id), [])
  assert.match(toolsMenu, /tool\.id === 'shape' \? \(\s*<div key=\{tool\.id\} className="contents">\s*\{renderButton\(tool, resolved\.group\.iconOnly\)\}\s*<FreehandSettingsButton hidden=\{hidden\} shapes \/>/)
  assert.match(screen, /case 'shape':\s+case 'eraser':\s+\/\/ Click the armed tool again/)
  assert.match(screen, /shape: \{ active: activeTool === 'shape' \}/)
})
check('Escape backs a Shape tool out to Select like the pen', () => {
  assert.match(screen, /activeToolRef\.current !== 'shape'\) return false/)
})

check('Typewriter properties: right-click on the tool opens the typewriter panel in defaults mode (no arm / disarm); RightPanelId has it', () => {
  const rightPanelStore = readFileSync(new URL('../../src/screens/Reader/logic/rightPanel/rightPanelStore.ts', import.meta.url), 'utf8')
  assert.match(rightPanelStore, /RightPanelId = 'settings' \| 'typewriter'/)
  assert.match(toolsMenu, /tool\.id === 'typewriter' && onToolContextMenu \? \(e\) => \{ e\.preventDefault\(\); onToolContextMenu\(tool\.id\) \}/)
  assert.match(screen, /onToolContextMenu=\{\(tool\) => \{[^]*if \(tool !== 'typewriter'\) return\s+useTypewriterPanelStore\.getState\(\)\.showDefaults\(\)\s+openRightPanel\('typewriter'\)/)
  assert.doesNotMatch(screen, /onToolContextMenu=\{\(tool\) => \{[^}]*setActiveTool/)
})

console.log(`\n${passed} checks passed`)
