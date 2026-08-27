/**
 * Framework-agnostic 3D page-turn gesture engine.
 *
 * Drives a "leaf" element (perspective child with `transform-style: preserve-3d`)
 * between two states — flat (0deg) and fully turned (+/-180deg) — from mouse drag,
 * touch swipe, or a single click/tap on either page edge. Only `transform` and
 * opacity-driven CSS custom properties are ever written, and pointermove writes are
 * coalesced to one `requestAnimationFrame` tick so dragging never triggers layout
 * thrashing.
 *
 * This module owns gesture math only. It does not touch page content — the host
 * (see `PageTurn.tsx`) supplies the DOM structure and swaps content in `onPrepare`
 * (before the flip becomes visible) and `onCommit` (once it has fully landed).
 */

export type PageTurnDirection = 'forward' | 'backward'

type PageTurnPhase = 'idle' | 'dragging' | 'settling'

export interface PageTurnCurlElements {
  /** Fixed-position flap container, pinned to whichever page edge is the free corner. */
  wrapper: HTMLElement
  /**
   * Exactly two nested hinge segments, [seam-side, tip-side] — `segments[1]`
   * must be a real DOM child of `segments[0]` so their rotations compound via
   * `transform-style: preserve-3d` without any manual matrix math.
   */
  segments: readonly [HTMLElement, HTMLElement]
}

export interface PageTurnElements {
  /** Positioned ancestor with `perspective` set; also the pointer-event target. */
  viewport: HTMLElement
  /** The element that physically rotates. */
  leaf: HTMLElement
  /** Front face of the leaf — mirrors the page currently on screen. */
  frontFace: HTMLElement
  /** Back face of the leaf, revealed past the 90 degree midpoint. */
  backFace: HTMLElement
  /** Optional decorative corner curl. Omit to fall back to a flat single-plane flip. */
  curl?: PageTurnCurlElements
}

export interface PageTurnCallbacks {
  /**
   * Fired synchronously right before the flip becomes visible (drag start or a
   * programmatic `turn()`). The host must ensure `backFace` already shows the
   * page that should appear once the flip lands.
   */
  onPrepare: (direction: PageTurnDirection) => void
  /** Fired once per animation frame while dragging or settling, with 0..1 progress. */
  onProgress?: (progress: number, direction: PageTurnDirection) => void
  /** The flip landed past the threshold — host should swap "current" to the new page. */
  onCommit: (direction: PageTurnDirection) => void
  /** Released/cancelled below the threshold — page springs back, nothing changes. */
  onCancel?: (direction: PageTurnDirection) => void
}

export interface PageTurnOptions {
  elements: PageTurnElements
  callbacks: PageTurnCallbacks
  /** Fraction of viewport width, from each edge, that arms a drag (0..0.5). */
  edgeActivationRatio?: number
  /** Released progress (0..1) that snaps forward to completion instead of springing back. */
  snapThreshold?: number
  /** px/ms flick speed, in the completing direction, that forces completion outright. */
  flingVelocityPxPerMs?: number
  /** Settle/tap-turn animation duration in ms. */
  animationDurationMs?: number
  /** Pointer movement (px) below which a release counts as a tap/click, not a drag. */
  tapMoveThresholdPx?: number
  /** Width of the decorative corner curl, as a fraction of viewport width (0..0.5). */
  curlWidthRatio?: number
}

interface ResolvedPageTurnOptions {
  edgeActivationRatio: number
  snapThreshold: number
  flingVelocityPxPerMs: number
  animationDurationMs: number
  tapMoveThresholdPx: number
  curlWidthRatio: number
}

const DEFAULT_OPTIONS: ResolvedPageTurnOptions = {
  edgeActivationRatio: 0.35,
  // Spec: releasing past the halfway mark always completes the turn.
  snapThreshold: 0.5,
  flingVelocityPxPerMs: 0.5,
  animationDurationMs: 320,
  tapMoveThresholdPx: 6,
  curlWidthRatio: 0.24,
}

/**
 * How far the two curl hinges lead the main leaf's own rotation at the
 * midpoint of the drag. 0 at progress 0 and 1 (so the flap is always flush
 * with the leaf at rest); peaks mid-drag via `Math.sin(progress * PI)`. The
 * tip segment gets the full bump, the seam segment only a fraction of it, so
 * the flap fans out rather than folding as one rigid plate.
 */
const CURL_MAX_BUMP_DEG = 20
const CURL_SEAM_WEIGHT = 0.35
const CURL_TIP_WEIGHT = 1

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export class PageTurnController {
  private readonly el: PageTurnElements
  private readonly cb: PageTurnCallbacks
  private readonly opts: ResolvedPageTurnOptions

  private phase: PageTurnPhase = 'idle'
  private direction: PageTurnDirection = 'forward'
  private pointerId: number | null = null

  private viewportWidth = 0
  private startX = 0
  private startY = 0
  private startTime = 0
  private lastX = 0
  private lastTime = 0
  private velocityPxPerMs = 0
  private pendingProgress = 0
  private frameScheduled = false
  private prevUserSelect = ''

  constructor(options: PageTurnOptions) {
    this.el = options.elements
    this.cb = options.callbacks
    this.opts = {
      edgeActivationRatio: options.edgeActivationRatio ?? DEFAULT_OPTIONS.edgeActivationRatio,
      snapThreshold: options.snapThreshold ?? DEFAULT_OPTIONS.snapThreshold,
      flingVelocityPxPerMs:
        options.flingVelocityPxPerMs ?? DEFAULT_OPTIONS.flingVelocityPxPerMs,
      animationDurationMs: options.animationDurationMs ?? DEFAULT_OPTIONS.animationDurationMs,
      tapMoveThresholdPx: options.tapMoveThresholdPx ?? DEFAULT_OPTIONS.tapMoveThresholdPx,
      curlWidthRatio: options.curlWidthRatio ?? DEFAULT_OPTIONS.curlWidthRatio,
    }

    this.el.leaf.style.setProperty('--pt-duration', `${this.opts.animationDurationMs}ms`)
    // Baked once: whichever face ends up facing the camera after a 180deg leaf
    // rotation must itself be pre-rotated 180deg so its content reads normally.
    this.el.backFace.style.transform = 'rotateY(180deg)'
    if (this.el.curl) {
      this.el.curl.wrapper.style.setProperty(
        '--pt-curl-width',
        `${this.opts.curlWidthRatio * 100}%`,
      )
    }

    this.el.viewport.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('blur', this.onWindowBlur)
  }

  /** Removes all listeners. Safe to call once the host component unmounts. */
  destroy(): void {
    this.el.viewport.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('blur', this.onWindowBlur)
    this.detachDragListeners()
    this.restoreTextSelection()
  }

  /** Programmatic full flip — wire this to a footer button, arrow keys, or wheel ticks. */
  turn(direction: PageTurnDirection): void {
    if (this.phase !== 'idle') return
    this.beginGesture(direction)
    this.settleTo(1, direction)
  }

  // ---- pointer lifecycle -----------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    if (this.phase !== 'idle' || event.button !== 0) return

    const rect = this.el.viewport.getBoundingClientRect()
    const localXRatio = (event.clientX - rect.left) / rect.width
    const direction: PageTurnDirection | null =
      localXRatio >= 1 - this.opts.edgeActivationRatio
        ? 'forward'
        : localXRatio <= this.opts.edgeActivationRatio
          ? 'backward'
          : null
    // Pointer landed in the untouched middle of the page — let the event
    // through so text selection / reader tools keep working there.
    if (!direction) return

    event.preventDefault()
    this.pointerId = event.pointerId
    this.viewportWidth = rect.width
    this.startX = event.clientX
    this.startY = event.clientY
    this.lastX = event.clientX
    this.startTime = event.timeStamp
    this.lastTime = event.timeStamp
    this.velocityPxPerMs = 0

    this.el.viewport.setPointerCapture(event.pointerId)
    this.el.viewport.addEventListener('pointermove', this.onPointerMove)
    this.el.viewport.addEventListener('pointerup', this.onPointerUp)
    this.el.viewport.addEventListener('pointercancel', this.onPointerCancel)

    this.beginGesture(direction)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.phase !== 'dragging' || event.pointerId !== this.pointerId) return

    const dx = event.clientX - this.startX
    const dyAbs = Math.abs(event.clientY - this.startY)
    // A gesture that turns out to be mostly vertical is a scroll, not a page
    // turn — bail early and let it spring back rather than fighting the user.
    if (dyAbs > 40 && dyAbs > Math.abs(dx) * 1.5) {
      this.cancelGesture()
      return
    }

    const elapsedMs = Math.max(1, event.timeStamp - this.lastTime)
    this.velocityPxPerMs = (event.clientX - this.lastX) / elapsedMs
    this.lastX = event.clientX
    this.lastTime = event.timeStamp

    // Forward drags move the pointer leftward; backward drags move it rightward.
    const completingDistance = this.direction === 'forward' ? -dx : dx
    this.pendingProgress = clamp01(completingDistance / this.viewportWidth)
    this.scheduleFrame()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.phase !== 'dragging' || event.pointerId !== this.pointerId) return

    const elapsedMs = event.timeStamp - this.startTime
    const movedPx = Math.abs(event.clientX - this.startX)
    const isTap = movedPx < this.opts.tapMoveThresholdPx && elapsedMs < 400

    // Positive => flicked toward completing the turn; negative => flicked back.
    const completionVelocity =
      this.direction === 'forward' ? -this.velocityPxPerMs : this.velocityPxPerMs

    const shouldComplete = isTap
      ? true
      : completionVelocity > this.opts.flingVelocityPxPerMs
        ? true
        : completionVelocity < -this.opts.flingVelocityPxPerMs
          ? false
          : this.pendingProgress >= this.opts.snapThreshold

    this.detachDragListeners()
    this.settleTo(shouldComplete ? 1 : 0, this.direction)
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return
    this.cancelGesture()
  }

  /** Alt-tab, an OS share sheet, a DevTools focus steal, etc. — never leave a page stuck mid-flip. */
  private onWindowBlur = (): void => {
    if (this.phase === 'dragging') this.cancelGesture()
  }

  private cancelGesture(): void {
    this.detachDragListeners()
    this.settleTo(0, this.direction)
  }

  private detachDragListeners(): void {
    if (this.pointerId != null) {
      try {
        this.el.viewport.releasePointerCapture(this.pointerId)
      } catch {
        /* capture already released (e.g. pointercancel) */
      }
    }
    this.el.viewport.removeEventListener('pointermove', this.onPointerMove)
    this.el.viewport.removeEventListener('pointerup', this.onPointerUp)
    this.el.viewport.removeEventListener('pointercancel', this.onPointerCancel)
    this.pointerId = null
  }

  // ---- gesture / animation state machine --------------------------------

  private beginGesture(direction: PageTurnDirection): void {
    this.phase = 'dragging'
    this.direction = direction
    this.pendingProgress = 0
    this.el.leaf.classList.remove('is-settling')
    // A forward (next-page) turn pivots on the spine — the edge *opposite*
    // the one the user grabs — so the point under their finger sweeps
    // through the widest arc and visibly tracks the drag. Pivoting on the
    // grabbed edge instead (the earlier version of this file) barely moves
    // that point at all.
    this.el.leaf.style.transformOrigin = direction === 'forward' ? '0% 50%' : '100% 50%'
    this.el.leaf.dataset.direction = direction

    if (this.el.curl) {
      const [seam, tip] = this.el.curl.segments
      this.el.curl.wrapper.dataset.direction = direction
      const seamOrigin = direction === 'forward' ? '0% 50%' : '100% 50%'
      seam.style.transformOrigin = seamOrigin
      tip.style.transformOrigin = seamOrigin
    }

    this.suppressTextSelection()
    this.cb.onPrepare(direction)
    this.applyProgress(0)
  }

  /** Coalesces pointermove into a single transform write per animation frame. */
  private scheduleFrame(): void {
    if (this.frameScheduled) return
    this.frameScheduled = true
    requestAnimationFrame(() => {
      this.frameScheduled = false
      if (this.phase === 'dragging') this.applyProgress(this.pendingProgress)
    })
  }

  private applyProgress(progress: number): void {
    // NOTE: sign picked to match the corrected pivot above; if the leaf
    // visually recedes away from the viewer instead of curling toward them
    // on your first run, this is the one number to flip (-180 <-> 180) — I
    // can reason about the rotation math but can't render 3D CSS here to
    // confirm which way it reads on screen.
    const angle = this.direction === 'forward' ? -180 * progress : 180 * progress
    this.el.leaf.style.transform = `rotateY(${angle}deg)`

    // Paper-fold shading: 0 when flat on either side, peaking at the 90deg
    // midpoint where a real page is edge-on to the light. Also tracks a fold
    // position so the drop-shadow cast on the base page sweeps with the drag.
    const shadow = Math.sin(progress * Math.PI)
    const foldPercent = this.direction === 'forward' ? (1 - progress) * 100 : progress * 100
    this.el.viewport.style.setProperty('--pt-shadow', shadow.toFixed(3))
    this.el.viewport.style.setProperty('--pt-fold', `${foldPercent.toFixed(1)}%`)

    if (this.el.curl) this.applyCurl(progress, angle)

    this.cb.onProgress?.(progress, this.direction)
  }

  /**
   * Two-hinge corner flap, independent of the main leaf's own transform tree.
   * Each segment's *world* angle is the leaf's angle plus a bump that is zero
   * at progress 0 and 1 (so the flap is always flush at both rest states) and
   * peaks mid-drag (so it fans out ahead of the flat leaf while dragging —
   * the "flexing under tension" look). The tip segment is nested inside the
   * seam segment in the DOM, so `preserve-3d` compounds their rotations —
   * the value written to the tip is therefore the *local* delta on top of
   * the seam, not its world angle.
   */
  private applyCurl(progress: number, leafAngle: number): void {
    const curl = this.el.curl
    if (!curl) return
    const bumpSign = this.direction === 'forward' ? -1 : 1
    const bump = Math.sin(progress * Math.PI) * CURL_MAX_BUMP_DEG * bumpSign
    const seamWorldAngle = leafAngle + bump * CURL_SEAM_WEIGHT
    const tipWorldAngle = leafAngle + bump * CURL_TIP_WEIGHT
    const [seam, tip] = curl.segments
    seam.style.transform = `rotateY(${seamWorldAngle.toFixed(3)}deg)`
    tip.style.transform = `rotateY(${(tipWorldAngle - seamWorldAngle).toFixed(3)}deg)`
  }

  private settleTo(target: 0 | 1, direction: PageTurnDirection): void {
    this.phase = 'settling'
    const leaf = this.el.leaf
    leaf.classList.add('is-settling')

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== leaf || event.propertyName !== 'transform') return
      leaf.removeEventListener('transitionend', onTransitionEnd)
      leaf.classList.remove('is-settling')
      this.phase = 'idle'
      this.restoreTextSelection()
      if (target === 1) this.cb.onCommit(direction)
      else this.cb.onCancel?.(direction)
      // Host has swapped content by now — reset the leaf to its resting pose.
      this.applyProgress(0)
    }
    leaf.addEventListener('transitionend', onTransitionEnd)

    // Force a style flush so the `is-settling` class (which enables the CSS
    // transition) is committed before the target transform is written below —
    // otherwise the browser can coalesce both writes into one frame and the
    // page would jump instead of animating.
    void leaf.offsetWidth
    this.applyProgress(target)
  }

  // ---- text-selection guard ----------------------------------------------

  private suppressTextSelection(): void {
    this.prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.setProperty('-webkit-user-select', 'none')
  }

  private restoreTextSelection(): void {
    document.body.style.userSelect = this.prevUserSelect
    document.body.style.removeProperty('-webkit-user-select')
  }
}
