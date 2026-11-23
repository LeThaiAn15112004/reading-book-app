import { describe, expect, it } from 'vitest'
import { VI_CATALOGUE } from '../../src/i18n/registry'
import { isPluralMessage, translate, type AnyMessageKey } from '../../src/i18n/translate'

/**
 * Spec 012 FR-016: the Vietnamese texts follow specs/012-app-ui-i18n/contracts/glossary.md. A few anchor terms are
 * pinned here (a rename of one of them is a glossary change, not a drive-by edit), plus the tone rules that can be
 * checked mechanically: no "bạn", action labels without a trailing period.
 */

const ANCHORS: ReadonlyArray<[AnyMessageKey, string]> = [
  ['chrome.nav.library', 'Thư viện'],
  ['chrome.nav.tools', 'Tiện ích'],
  ['library.sidebar.heading', 'Thư viện'],
  ['common.actions.delete', 'Xóa'],
  ['common.actions.remove', 'Gỡ'],
  ['common.actions.cancel', 'Hủy'],
  ['common.actions.undo', 'Hoàn tác'],
  ['reader.sidebar.tabs.chapters', 'Mục lục'],
  ['reader.sidebar.tabs.bookmarks', 'Dấu trang'],
  ['settings.appearance.language.system', 'Theo hệ thống'],
  ['settings.appearance.language.title', 'Ngôn ngữ'],
  ['exports.kinds.highlight', 'Tô sáng'],
  ['exports.headings.chapter', 'Chương {n}'],
]

type Leaf = { path: string; texts: string[] }

function leaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string') return [{ path: prefix, texts: [node] }]
  if (isPluralMessage(node)) return [{ path: prefix, texts: Object.values(node as Record<string, string>) }]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

const viLeaves = leaves(VI_CATALOGUE)

describe('Vietnamese glossary anchors (spec 012 FR-016)', () => {
  it.each(ANCHORS)('%s = %s', (key, expected) => {
    // Read the raw template: `translate` would fill {n} with nothing.
    expect(translate('vi', key, { n: '{n}' })).toBe(expected)
  })

  it('no Vietnamese message addresses the reader as "bạn"', () => {
    const offending = viLeaves.filter((l) => l.texts.some((t) => /(^|[^\p{L}])bạn([^\p{L}]|$)/iu.test(t))).map((l) => l.path)
    expect(offending).toEqual([])
  })

  it('action labels (common.actions) have no trailing period', () => {
    const actions = viLeaves.filter((l) => l.path.startsWith('common.actions.'))
    expect(actions.length).toBeGreaterThan(5)
    for (const l of actions) expect(l.texts[0], l.path).not.toMatch(/\.$/)
  })
})
