// Tests for `readmate/no-ui-literals` (spec 012). Run: node --test source/scripts/eslint-rules/no-ui-literals.test.mjs
import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import { noUiLiterals } from './no-ui-literals.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
})

tester.run('no-ui-literals', noUiLiterals, {
  valid: [
    { code: 'const a = <span>{t("library.title")}</span>' },
    { code: 'const a = <button title={t("common.actions.delete")} aria-label={label} />' },
    // Punctuation / numbers / separators only
    { code: 'const a = <span> · {n} / {m} — 100% </span>' },
    // Non-text attributes are not checked
    { code: 'const a = <div className="flex gap-2" data-testid="library-grid" role="button" type="submit" />' },
    // Template literal with an expression is not a plain literal
    { code: 'const a = <div title={`${name}`} />' },
    // Pending file (not converted yet)
    { code: '/* i18n-pending: library */\nconst a = <span>Delete</span>' },
    // Ignore with a reason: same line and line before
    { code: 'const a = <kbd>Ctrl</kbd> // i18n-ignore: keyboard key name' },
    { code: 'const a = (\n  <>\n    {/* i18n-ignore: file format name */}\n    <span>EPUB</span>\n  </>\n)' },
    { code: '// i18n-ignore: brand\nconst a = <img alt="Readmate" />' },
  ],
  invalid: [
    { code: 'const a = <span>Delete</span>', errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>\n  Tiếng Việt chưa dịch\n</p>', errors: [{ messageId: 'text' }] },
    { code: 'const a = <button title="Delete book" />', errors: [{ messageId: 'attribute' }] },
    { code: "const a = <input placeholder={'Search'} />", errors: [{ messageId: 'attribute' }] },
    { code: 'const a = <Dialog confirmLabel={`Remove`} cancelLabel="Cancel" />', errors: 2 },
    { code: 'const a = <i aria-label="Close" />', errors: [{ messageId: 'attribute' }] },
    // A pending header NOT on the first line does not count
    { code: 'const x = 1\n/* i18n-pending: library */\nconst a = <span>Delete</span>', errors: 1 },
    // Ignore without a reason is itself an error, and ignores nothing
    {
      code: 'const a = <span>Delete</span> // i18n-ignore:',
      // (reported in source order: the JSX text comes before the comment)
      errors: [{ messageId: 'text' }, { messageId: 'ignoreReason' }],
    },
    // The ignore reaches only the same line and the next one
    { code: '// i18n-ignore: brand\n\nconst a = <span>Readmate</span>', errors: [{ messageId: 'text' }] },
  ],
})
