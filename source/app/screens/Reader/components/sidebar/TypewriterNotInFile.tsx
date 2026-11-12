import { typewriterNotInFileMessage, useTypewriterFileStatusStore } from '../../logic/pdfTypewriter/typewriterFileStatusStore'
import { useT } from '../../../../i18n'

/** "Not in the file" + the reason and what to do, for a Typewriter note that could not be written into the PDF (renders nothing otherwise). */
export function TypewriterNotInFile({ id }: { id: string }) {
  const t = useT()
  const status = useTypewriterFileStatusStore((s) => s.byId[id])
  const message = typewriterNotInFileMessage(status)
  if (!message) return null
  return (
    <span data-tw-not-in-file={status?.code} role="status" className="mt-1 block text-[11px] leading-snug text-amber-500">
      <span className="font-semibold">{t('reader.sidebar.typewriter.notInFile')}</span> {message}
    </span>
  )
}
