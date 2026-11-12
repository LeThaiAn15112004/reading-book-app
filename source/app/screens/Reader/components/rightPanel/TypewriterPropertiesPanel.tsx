import { applyAlign, emptyTypewriterDoc, type TypewriterAlign, type TypewriterTextStyle } from '@core'
import type { PdfTypewriterMark } from '../../../../components/reader/renderers/pdf/PdfTypewriterLayer'
import { usePdfTypewriterPrefsStore } from '../../logic/pdfTypewriter/pdfTypewriterPrefsStore'
import { useTypewriterEditorStore } from '../../logic/pdfTypewriter/typewriterEditorStore'
import { typewriterFormatValues } from '../../logic/pdfTypewriter/typewriterFormatValues'
import { useTypewriterPanelStore } from '../../logic/pdfTypewriter/typewriterPanelStore'
import { TypewriterNotInFile } from '../sidebar/TypewriterNotInFile'
import { TypewriterFormatControls } from './TypewriterFormatControls'
import { TransText, useT } from '../../../../i18n'

type Props = {
  marks: readonly PdfTypewriterMark[]
  onFormatNote: (id: string, change: { style?: Partial<TypewriterTextStyle>; align?: TypewriterAlign }) => void
  onEditNote: (id: string) => void
}

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

/**
 * Typewriter Properties (docked right sidebar). Three things can be edited, and the panel says which one:
 * the text being typed (its selection, or the caret = what the next typed text looks like), a saved note (the whole
 * box), or the defaults of the next box. Values are always read from that target, never kept here.
 */
export function TypewriterPropertiesPanel({ marks, onFormatNote, onEditNote }: Props) {
  const t = useT()
  const target = useTypewriterPanelStore((s) => s.target)
  const session = useTypewriterEditorStore((s) => s.session)
  const formatStyle = useTypewriterEditorStore((s) => s.formatStyle)
  const formatAlign = useTypewriterEditorStore((s) => s.formatAlign)
  const prefs = usePdfTypewriterPrefsStore()
  const mark = target.mode === 'note' ? (marks.find((m) => m.id === target.id) ?? null) : null

  if (session) {
    const range = session.selection.start !== session.selection.end
    return (
      <div data-tw-panel="session" className="flex flex-col gap-3">
        <p className="m-0 text-xs text-lib-muted">
          {range
            ? t('reader.sidebar.typewriter.selectedText')
            : session.text.length === 0
              ? t('reader.sidebar.typewriter.wholeBox')
              : t('reader.sidebar.typewriter.nextTyped')}
        </p>
        <TypewriterFormatControls
          values={typewriterFormatValues(session.doc, session.text, session.selection, session.pending)}
          onStyle={formatStyle}
          onAlign={formatAlign}
        />
        <p className="m-0 text-[11px] text-lib-muted">{t('reader.sidebar.typewriter.shortcuts')}</p>
      </div>
    )
  }

  if (mark) {
    return (
      <div data-tw-panel="note" className="flex flex-col gap-3">
        <p className="m-0 text-xs text-lib-muted">
          <TransText
            k="reader.sidebar.typewriter.selectedNote"
            params={{ excerpt: excerpt(mark.text) }}
            slots={{ b: (text) => <span className="font-semibold text-lib-text-strong">{text}</span> }}
          />
        </p>
        <TypewriterFormatControls
          key={mark.id}
          values={typewriterFormatValues(mark.doc, mark.text, null, null)}
          onStyle={(style) => onFormatNote(mark.id, { style })}
          onAlign={(align) => onFormatNote(mark.id, { align })}
        />
        <TypewriterNotInFile id={mark.id} />
        <button
          type="button"
          className="h-8 cursor-pointer self-start rounded-md border border-lib-border bg-transparent px-3 text-xs font-semibold text-lib-text-strong hover:bg-lib-surface-hover"
          onClick={() => onEditNote(mark.id)}
        >
          {t('reader.sidebar.typewriter.editText')}
        </button>
        <p className="m-0 text-[11px] text-lib-muted">{t('reader.sidebar.typewriter.someWords')}</p>
      </div>
    )
  }

  return (
    <div data-tw-panel="defaults" className="flex flex-col gap-3">
      <p className="m-0 text-xs text-lib-muted">
        <TransText
          k="reader.sidebar.typewriter.defaults"
          slots={{ b: (text) => <span className="font-semibold text-lib-text-strong">{text}</span> }}
        />
      </p>
      <TypewriterFormatControls
        key="defaults"
        values={typewriterFormatValues(
          applyAlign(emptyTypewriterDoc(prefs.style), ' ', null, prefs.align),
          ' ',
          null,
          null,
        )}
        onStyle={prefs.setStyle}
        onAlign={prefs.setAlign}
      />
    </div>
  )
}
