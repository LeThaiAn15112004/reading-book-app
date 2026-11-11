/**
 * `readmate/no-ui-literals` (spec 012, research R3): interface text must come from the i18n catalogue, not a literal.
 *
 * Reports, in a `.tsx` file:
 *   - JSX text that contains a letter (`<span>Delete</span>`);
 *   - a string literal (or a template literal without `${}`) containing a letter in one of the TEXT_ATTRIBUTES
 *     (`title="Delete"`, `aria-label={'Close'}`).
 *
 * Not reported:
 *   - a file whose first line is `/* i18n-pending: <area> *\/` — not converted yet; the release gate requires that
 *     no such header is left;
 *   - a node on the same line as, or the line right after, a comment `i18n-ignore: <reason>` (keyboard key names,
 *     format names, brand…). The reason is required.
 */

export const TEXT_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  'description',
  'message',
  'confirmLabel',
  'cancelLabel',
])

export const PENDING_HEADER = /^﻿?\/\*\s*i18n-pending:\s*([A-Za-z][\w.]*)\s*\*\//
const IGNORE = /i18n-ignore\s*:(.*)$/s
const LETTER = /\p{L}/u

function attributeName(node) {
  const { name } = node
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`
  return ''
}

function literalText(value) {
  if (!value) return null
  if (value.type === 'Literal' && typeof value.value === 'string') return value.value
  if (value.type === 'JSXExpressionContainer') {
    const e = value.expression
    if (e.type === 'Literal' && typeof e.value === 'string') return e.value
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0) return e.quasis.map((q) => q.value.cooked).join('')
  }
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
export const noUiLiterals = {
  meta: {
    type: 'problem',
    docs: { description: 'Interface text comes from the i18n catalogue (spec 012).' },
    // `includePending: true` (inventory script only) also reports files with an `i18n-pending` header.
    schema: [{ type: 'object', properties: { includePending: { type: 'boolean' } }, additionalProperties: false }],
    messages: {
      text: 'Interface text "{{text}}" must come from the i18n catalogue (useT / t(…)); see docs/implementation_plan/app_i18n.md.',
      attribute:
        'Attribute {{name}}="{{text}}" must come from the i18n catalogue (useT / t(…)); see docs/implementation_plan/app_i18n.md.',
      ignoreReason: 'i18n-ignore needs a reason: `i18n-ignore: <why this is not interface text>`.',
    },
  },
  create(context) {
    const source = context.sourceCode
    const includePending = context.options[0]?.includePending === true
    if (!includePending && PENDING_HEADER.test(source.text)) return {}

    const ignoredLines = new Set()
    for (const comment of source.getAllComments()) {
      const match = IGNORE.exec(comment.value)
      if (!match) continue
      if (match[1].replace(/\*\/?$/, '').trim() === '') {
        context.report({ loc: comment.loc, messageId: 'ignoreReason' })
        continue
      }
      ignoredLines.add(comment.loc.end.line)
      ignoredLines.add(comment.loc.end.line + 1)
    }
    const ignored = (node) => ignoredLines.has(node.loc.start.line)
    const short = (text) => {
      const one = text.replace(/\s+/g, ' ').trim()
      return one.length > 40 ? `${one.slice(0, 37)}…` : one
    }

    return {
      JSXText(node) {
        if (!LETTER.test(node.value) || ignored(node)) return
        context.report({ node, messageId: 'text', data: { text: short(node.value) } })
      },
      JSXAttribute(node) {
        const name = attributeName(node)
        if (!TEXT_ATTRIBUTES.has(name)) return
        const text = literalText(node.value)
        if (text === null || !LETTER.test(text) || ignored(node)) return
        context.report({ node, messageId: 'attribute', data: { name, text: short(text) } })
      },
    }
  },
}

/** ESLint plugin object: `plugins: { readmate: readmatePlugin }`, rule `readmate/no-ui-literals`. */
export const readmatePlugin = { rules: { 'no-ui-literals': noUiLiterals } }
