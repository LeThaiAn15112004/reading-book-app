import { typewriterNotInFileMessage, useTypewriterFileStatusStore } from '../../logic/pdfTypewriter/typewriterFileStatusStore'

/** "Not in the file" + the reason and what to do, for a Typewriter note that could not be written into the PDF (renders nothing otherwise). */
export function TypewriterNotInFile({ id }: { id: string }) {
  const status = useTypewriterFileStatusStore((s) => s.byId[id])
  const message = typewriterNotInFileMessage(status)
  if (!message) return null
  return (
    <span data-tw-not-in-file={status?.code} role="status" className="mt-1 block text-[11px] leading-snug text-amber-500">
      <span className="font-semibold">Not in the file.</span> {message}
    </span>
  )
}
