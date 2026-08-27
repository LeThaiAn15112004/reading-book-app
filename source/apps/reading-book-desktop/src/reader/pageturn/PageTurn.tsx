import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import { PageTurnController, type PageTurnDirection } from './page-turn-controller'
import './page-turn.css'

export interface PageTurnHandle {
  /** Programmatic next-page flip — wire to a button, arrow key, or wheel tick. */
  turnNext: () => void
  /** Programmatic previous-page flip. */
  turnPrev: () => void
}

export interface PageTurnProps {
  /** The page that becomes current once a flip lands — stays flat, underneath. */
  baseContent: ReactNode
  /** Currently showing page — the flip's front face. */
  frontContent: ReactNode
  /**
   * Page revealed once the leaf has rotated past 90deg. Must render the same
   * page as `baseContent` — keep both in sync so the swap at 90deg is
   * invisible (per-`direction` content is the caller's responsibility; this
   * component only drives the animation).
   */
  backContent: ReactNode
  onTurnStart?: (direction: PageTurnDirection) => void
  /** Flip landed past the threshold — swap `frontContent`/state to the new page here. */
  onTurnComplete: (direction: PageTurnDirection) => void
  onTurnCancel?: (direction: PageTurnDirection) => void
  className?: string
}

/**
 * Realistic 3D page-turn surface for EPUB Page-turn mode. Purely presentational
 * plus gesture wiring — page content and pagination state live with the caller;
 * see `PageTurnController` for the underlying drag/tap/settle mechanics.
 */
export const PageTurn = forwardRef<PageTurnHandle, PageTurnProps>(function PageTurn(
  { baseContent, frontContent, backContent, onTurnStart, onTurnComplete, onTurnCancel, className },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const leafRef = useRef<HTMLDivElement>(null)
  const frontFaceRef = useRef<HTMLDivElement>(null)
  const backFaceRef = useRef<HTMLDivElement>(null)
  const curlWrapperRef = useRef<HTMLDivElement>(null)
  const curlSeamRef = useRef<HTMLDivElement>(null)
  const curlTipRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PageTurnController | null>(null)

  // Refs so the controller (created once) always calls the latest callbacks
  // without needing to be torn down and rebuilt on every render.
  const onTurnStartRef = useRef(onTurnStart)
  onTurnStartRef.current = onTurnStart
  const onTurnCompleteRef = useRef(onTurnComplete)
  onTurnCompleteRef.current = onTurnComplete
  const onTurnCancelRef = useRef(onTurnCancel)
  onTurnCancelRef.current = onTurnCancel

  useEffect(() => {
    const viewport = viewportRef.current
    const leaf = leafRef.current
    const frontFace = frontFaceRef.current
    const backFace = backFaceRef.current
    const curlWrapper = curlWrapperRef.current
    const curlSeam = curlSeamRef.current
    const curlTip = curlTipRef.current
    if (!viewport || !leaf || !frontFace || !backFace) return

    const controller = new PageTurnController({
      elements: {
        viewport,
        leaf,
        frontFace,
        backFace,
        curl:
          curlWrapper && curlSeam && curlTip
            ? { wrapper: curlWrapper, segments: [curlSeam, curlTip] }
            : undefined,
      },
      callbacks: {
        onPrepare: (direction) => onTurnStartRef.current?.(direction),
        onCommit: (direction) => onTurnCompleteRef.current(direction),
        onCancel: (direction) => onTurnCancelRef.current?.(direction),
      },
    })
    controllerRef.current = controller

    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      turnNext: () => controllerRef.current?.turn('forward'),
      turnPrev: () => controllerRef.current?.turn('backward'),
    }),
    [],
  )

  return (
    <div ref={viewportRef} className={`pt-viewport ${className ?? ''}`}>
      <div className="pt-base">{baseContent}</div>
      <div ref={leafRef} className="pt-leaf" data-direction="forward">
        <div ref={frontFaceRef} className="pt-face pt-face--front">
          {frontContent}
          <div className="pt-face-shade" aria-hidden="true" />
        </div>
        <div ref={backFaceRef} className="pt-face pt-face--back">
          {backContent}
          <div className="pt-face-shade" aria-hidden="true" />
        </div>
      </div>
      <div ref={curlWrapperRef} className="pt-curl" data-direction="forward" aria-hidden="true">
        <div ref={curlSeamRef} className="pt-curl-seg pt-curl-seg--seam">
          <div className="pt-curl-face" />
          <div ref={curlTipRef} className="pt-curl-seg pt-curl-seg--tip">
            <div className="pt-curl-face" />
          </div>
        </div>
      </div>
      <div className="pt-drop-shadow" aria-hidden="true" />
    </div>
  )
})
