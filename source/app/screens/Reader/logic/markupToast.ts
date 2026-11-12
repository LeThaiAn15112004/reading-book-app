import type { MarkupInteractionTool, MessageKey } from '@core'
import { getT } from '../../../i18n'

const DONE: Record<MarkupInteractionTool, MessageKey> = {
  highlight: 'reader.logic.markup.highlight',
  underline: 'reader.logic.markup.underline',
  squiggly: 'reader.logic.markup.squiggly',
  strikethrough: 'reader.logic.markup.strikethrough',
  replace: 'reader.logic.markup.replace',
  insert: 'reader.logic.markup.insert',
}

/** Toast after a markup tool saved a mark. */
export function markupToast(tool: MarkupInteractionTool): string {
  const t = getT()
  return t('reader.logic.markup.done', { action: t(DONE[tool]) })
}
