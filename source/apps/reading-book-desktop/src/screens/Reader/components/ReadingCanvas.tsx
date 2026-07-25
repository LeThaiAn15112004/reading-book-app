import type { FakeChapter } from '../fakeReaderContent'
import type {
  AnnotateTool,
  ESignStamp,
  HighlightColor,
  ReaderComment,
  ReaderHighlight,
  TypewriterMark,
} from '../readerSession'

type MarginMode = 'narrow' | 'normal' | 'wide' | 'off'

type ReadingCanvasProps = {
  chapter: FakeChapter
  chapterIndex: number
  margin: MarginMode
  pageMode: 'scroll' | 'paginated'
  layout: 'single' | 'dual'
  activeTool: AnnotateTool
  highlights: ReaderHighlight[]
  comments: ReaderComment[]
  typewriterMarks: TypewriterMark[]
  eSignStamps: ESignStamp[]
  onCanvasBackgroundClick: () => void
  onParagraphClick: (paragraphIndex: number) => void
  onTextSelected: (
    paragraphIndex: number,
    selectedText: string,
    rect: DOMRect,
  ) => void
  onPlaceTypewriter: (xPct: number, yPct: number) => void
  onPlaceESign: (xPct: number, yPct: number) => void
  onTypewriterChange: (id: string, text: string) => void
}

const HL_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-amber-500/25 [border-bottom:2px_solid_#f59e0b]',
  green: 'bg-emerald-500/25 [border-bottom:2px_solid_#10b981]',
  pink: 'bg-pink-500/25 [border-bottom:2px_solid_#ec4899]',
}

const MARGIN: Record<MarginMode, string> = {
  narrow: 'max-w-[580px]',
  normal: 'max-w-[680px]',
  wide: 'max-w-[780px]',
  off: 'max-w-full px-3',
}

export function ReadingCanvas({
  chapter,
  chapterIndex,
  margin,
  pageMode,
  layout,
  activeTool,
  highlights,
  comments,
  typewriterMarks,
  eSignStamps,
  onCanvasBackgroundClick,
  onParagraphClick,
  onTextSelected,
  onPlaceTypewriter,
  onPlaceESign,
  onTypewriterChange,
}: ReadingCanvasProps) {
  const chapterHighlights = highlights.filter(
    (h) => h.chapterIndex === chapterIndex,
  )
  const chapterComments = comments.filter((c) => c.chapterIndex === chapterIndex)
  const chapterTw = typewriterMarks.filter((m) => m.chapterIndex === chapterIndex)
  const chapterSign = eSignStamps.filter((s) => s.chapterIndex === chapterIndex)

  const areaLayout =
    layout === 'dual'
      ? 'max-w-[min(1200px,95vw)] columns-1 min-[900px]:columns-2 min-[900px]:gap-16 min-[900px]:[column-rule:1px_dashed_rgb(51_65_85_/_0.45)]'
      : MARGIN[margin]

  function handleMouseUp(paragraphIndex: number) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    const text = sel.toString().trim()
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    if (!range) return
    onTextSelected(paragraphIndex, text, range.getBoundingClientRect())
  }

  return (
    <main
      key={chapter.num}
      className={`app-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-8 pb-20 overscroll-y-contain ${
        pageMode === 'paginated' ? 'snap-y snap-mandatory' : ''
      } ${activeTool === 'typewriter' || activeTool === 'esign' ? 'cursor-crosshair' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCanvasBackgroundClick()
      }}
    >
      <div
        className={`relative mx-auto w-full transition-[max-width] duration-300 ${areaLayout} ${
          pageMode === 'paginated' ? 'min-h-[calc(100%-48px)] snap-start' : ''
        }`}
        onClick={(e) => {
          if (activeTool === 'typewriter' || activeTool === 'esign') {
            const area = e.currentTarget.getBoundingClientRect()
            const xPct = ((e.clientX - area.left) / area.width) * 100
            const yPct = ((e.clientY - area.top) / area.height) * 100
            e.stopPropagation()
            if (activeTool === 'typewriter') onPlaceTypewriter(xPct, yPct)
            else onPlaceESign(xPct, yPct)
          }
        }}
      >
        <div className="mb-9 border-b border-dashed border-current/15 pb-6 text-center">
          <p className="m-0 mb-2 text-[11px] font-bold tracking-[0.2em] text-amber-500 uppercase">
            {chapter.num}
          </p>
          <h2 className="m-0 px-2 font-['Playfair_Display',Georgia,serif] text-[clamp(24px,6vw,32px)] leading-tight font-semibold text-current">
            {chapter.title}
          </h2>
        </div>

        <div
          className="select-text"
          style={{
            fontFamily: 'var(--reader-font-reading)',
            fontSize: 'var(--reader-reading-size)',
            fontWeight: 'var(--reader-reading-weight)' as unknown as number,
            lineHeight: 'var(--reader-reading-line-height)',
            textAlign: 'var(--reader-reading-align)' as 'left',
            color: 'var(--reader-text, #cbd5e1)',
          }}
        >
          {chapter.paragraphs.map((text, i) => {
            const hl = chapterHighlights.find((h) => h.paragraphIndex === i)
            const commentCount = chapterComments.filter(
              (c) => c.paragraphIndex === i,
            ).length
            return (
              <div
                key={`${chapter.num}-${i}`}
                className={`relative mb-[1.5em] rounded-md ${
                  activeTool === 'comment'
                    ? 'cursor-pointer outline outline-1 outline-transparent hover:bg-amber-500/5 hover:outline-amber-500/45'
                    : ''
                }`}
                onClick={(e) => {
                  if (activeTool === 'comment') {
                    e.stopPropagation()
                    onParagraphClick(i)
                    return
                  }
                  if (activeTool === 'typewriter' || activeTool === 'esign') {
                    return
                  }
                  const sel = window.getSelection()
                  if (sel && !sel.isCollapsed && sel.toString().trim()) return
                  e.stopPropagation()
                  onCanvasBackgroundClick()
                }}
                onMouseUp={() => handleMouseUp(i)}
              >
                <p
                  className={`m-0 ${i === 0 ? 'indent-0' : 'indent-[1.5em]'} ${
                    hl ? HL_CLASS[hl.color] : ''
                  } ${
                    i === 0
                      ? 'first-letter:float-left first-letter:mt-1 first-letter:pr-2.5 first-letter:font-["Playfair_Display",Georgia,serif] first-letter:text-[clamp(2.2em,8vw,3.2em)] first-letter:leading-[0.85] first-letter:font-bold first-letter:text-amber-500'
                      : ''
                  }`}
                >
                  {text}
                </p>
                {commentCount > 0 ? (
                  <button
                    className="absolute top-0 -right-1 inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full border-none bg-amber-500/15 px-1.5 text-[11px] font-bold text-amber-400"
                    type="button"
                    title={`${commentCount} comment(s)`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onParagraphClick(i)
                    }}
                  >
                    {commentCount}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>

        {chapterTw.map((m) => (
          <div
            key={m.id}
            className="absolute z-[5] min-w-[120px] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${m.xPct}%`, top: `${m.yPct}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={m.text}
              placeholder="Type…"
              aria-label="Typewriter text"
              className="h-8 w-40 rounded border border-dashed border-amber-500 bg-slate-950/85 px-2 font-mono text-[13px] text-slate-100 outline-none"
              onChange={(e) => onTypewriterChange(m.id, e.target.value)}
            />
          </div>
        ))}

        {chapterSign.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded border-2 border-red-400 bg-red-400/10 px-3.5 py-2 font-['Segoe_Script','Comic_Sans_MS',cursive] text-base font-bold text-red-400 select-none"
            style={{ left: `${s.xPct}%`, top: `${s.yPct}%` }}
          >
            {s.label}
          </div>
        ))}
      </div>

      <div
        className="min-h-[40vh]"
        aria-hidden
        onClick={onCanvasBackgroundClick}
      />
    </main>
  )
}
