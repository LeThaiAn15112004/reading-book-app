/**
 * Minimal PDF.js rendering proof (see docs/implementation_plan/pdf_library_setup.md).
 *
 * Renders one page of a PDF (canvas + selectable text layer) from the bytes the Main process
 * already returns through `library.openBookContent` — no file paths, no Node APIs in the renderer.
 * Not the PDF Reader MVP: no toolbar, zoom UI, progress persistence or annotations yet.
 */
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
// `?url` makes Vite emit the worker as a local asset in dist/ — never loaded from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfRendererProps {
  data: ArrayBuffer
  /** 1-based page to show. */
  initialPage?: number
  scale?: number
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

export function PdfRenderer({ data, initialPage = 1, scale = 1.25 }: PdfRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(initialPage)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  // Open the document. PDF.js transfers the buffer to its worker, so hand it a copy and keep
  // the caller's ArrayBuffer intact.
  useEffect(() => {
    setStatus({ kind: 'loading' })
    setDoc(null)
    const task = getDocument({ data: new Uint8Array(data.slice(0)) })
    let cancelled = false
    task.promise.then(
      (pdf) => {
        if (cancelled) return
        setDoc(pdf)
        setPageNumber((p) => Math.min(Math.max(1, p), pdf.numPages))
      },
      (err: unknown) => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not open this PDF.' })
        }
      },
    )
    return () => {
      cancelled = true
      // Destroys the document and terminates its worker-side state.
      void task.destroy()
    }
  }, [data])

  // Render the current page (canvas + text layer); cancel in-flight work on change/unmount.
  useEffect(() => {
    const canvas = canvasRef.current
    const textContainer = textLayerRef.current
    if (!doc || !canvas || !textContainer) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    let textLayer: TextLayer | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = page.render({
          canvas,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        })
        await renderTask.promise
        if (cancelled) return

        textContainer.replaceChildren()
        textContainer.style.setProperty('--scale-factor', String(scale))
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer,
          viewport,
        })
        await textLayer.render()
        if (!cancelled) setStatus({ kind: 'ready' })
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not render this page.' })
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [doc, pageNumber, scale])

  const numPages = doc?.numPages ?? 0

  return (
    <div className="flex h-full w-full flex-col items-center overflow-auto py-4" data-pdf-status={status.kind}>
      {status.kind === 'error' ? (
        <p role="alert" className="m-auto text-sm">
          {status.message}
        </p>
      ) : (
        <>
          {numPages > 1 && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)}>
                ‹ Prev
              </button>
              <span>
                {pageNumber} / {numPages}
              </span>
              <button type="button" disabled={pageNumber >= numPages} onClick={() => setPageNumber((p) => p + 1)}>
                Next ›
              </button>
            </div>
          )}
          <div className="relative shadow" style={{ opacity: status.kind === 'ready' ? 1 : 0.4 }}>
            <canvas ref={canvasRef} className="block" />
            <div ref={textLayerRef} className="textLayer" />
          </div>
          {status.kind === 'loading' && <p className="mt-3 text-sm">Loading PDF…</p>}
        </>
      )}
    </div>
  )
}
