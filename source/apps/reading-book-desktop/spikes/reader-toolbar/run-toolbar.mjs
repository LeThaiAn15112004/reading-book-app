/**
 * Checks for the capability-driven Reader toolbar (docs/implementation_plan/reader_toolbar.md). Pure
 * logic on the real registry / layout modules; no DOM.
 *
 *   1. registry        -> unique ids, known groups, shortcut ids exist in the shortcut registry, every
 *                         tool is shown by at least one surface (no dead entries)
 *   2. surfaces        -> format → surface mapping; EPUB vs placeholder capability sets
 *   3. EPUB layout     -> exact groups / order at fold level 0
 *   4. placeholder     -> only tools that work without a renderer (no Search / Audio / Translate / markup)
 *   5. folding         -> Annotation / Tools always dropdowns; navigate + settings never fold; clamps
 *   6. no duplicates   -> zoom / fit / fullscreen stay in the footer, not on the toolbar
 *   7. wiring (static) -> every tool id has a `handleTool` branch; no "coming soon" tool stubs; dropdown
 *                         reuses useDismissOnOutsideOrEscape with consumeEscape
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
const placeholder = caps.getReaderCapabilities('pdf')

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
check('only epub maps to the EPUB surface', () => {
  assert.equal(caps.readerSurfaceForFormat('epub'), 'epub')
  for (const f of ['pdf', 'txt', 'md', 'docx', 'doc', null, undefined]) {
    assert.equal(caps.readerSurfaceForFormat(f), 'placeholder', String(f))
  }
})
check('placeholder is a strict subset of EPUB', () => {
  for (const c of placeholder) assert.ok(epub.has(c), c)
  assert.ok(placeholder.size < epub.size)
})

console.log('3. EPUB layout')
check('groups and order at fold level 0', () => {
  assert.deepEqual(shape(resolveToolbarLayout(epub, 0)), [
    'navigate:inline[hand,select,search,speech,translate]',
    'annotation:menu[highlight,underline,strikethrough]',
    'tools:menu[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})
check('no empty View group for EPUB', () => {
  assert.ok(!resolveToolbarLayout(epub, 0).some((g) => g.group.id === 'view'))
})

console.log('4. placeholder layout')
check('only renderer-independent tools', () => {
  assert.deepEqual(shape(resolveToolbarLayout(placeholder, 0)), [
    'navigate:inline[hand,select]',
    'tools:menu[snapshot,wordCount]',
    'settings:inline[settings]',
  ])
})

console.log('5. folding')
check('Annotation and Tools are always dropdowns; nothing left to fold for EPUB', () => {
  for (const id of ['annotation', 'tools']) assert.equal(TOOL_GROUPS.find((g) => g.id === id).collapse, 'always')
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

console.log(`\n${passed} checks passed`)
