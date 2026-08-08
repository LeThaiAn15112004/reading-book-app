import { useCallback, useEffect, useRef, useState } from 'react'

import type {

  PagePreviewEntry,

  PreviewRequestPriority,

} from '../../logic/pagePreview/usePagePreviewStore'

import {

  PAGE_LAYOUT_COLUMN_STEPS,

  PAGE_LAYOUT_DEFAULT_STEP,

  columnsForStep,

  type PageLayoutColumnCount,

} from './pageLayoutGrid'



const zoomButtonClass =

  'inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-lib-border-soft bg-lib-bg-mid/40 text-sm font-bold text-lib-muted transition-colors hover:border-lib-accent-ring hover:bg-lib-accent-soft hover:text-lib-accent disabled:cursor-not-allowed disabled:opacity-35'



export type PageLayoutGridState = {

  columns: PageLayoutColumnCount

  step: number

  zoomIn: () => void

  zoomOut: () => void

  canZoomIn: boolean

  canZoomOut: boolean

}



export function usePageLayoutGrid(

  initialStep = PAGE_LAYOUT_DEFAULT_STEP,

): PageLayoutGridState {

  const [step, setStep] = useState(initialStep)



  const zoomIn = useCallback(() => {

    setStep((current) => Math.max(0, current - 1))

  }, [])



  const zoomOut = useCallback(() => {

    setStep((current) =>

      Math.min(PAGE_LAYOUT_COLUMN_STEPS.length - 1, current + 1),

    )

  }, [])



  const columns = columnsForStep(step)



  return {

    columns,

    step,

    zoomIn,

    zoomOut,

    canZoomIn: step > 0,

    canZoomOut: step < PAGE_LAYOUT_COLUMN_STEPS.length - 1,

  }

}



type PageLayoutZoomControlsProps = Pick<

  PageLayoutGridState,

  'zoomIn' | 'zoomOut' | 'canZoomIn' | 'canZoomOut'

>



export function PageLayoutZoomControls({

  zoomIn,

  zoomOut,

  canZoomIn,

  canZoomOut,

}: PageLayoutZoomControlsProps) {

  return (

    <div className="inline-flex items-center gap-0.5 rounded-md bg-lib-hint/50 p-0.5">

      <button

        type="button"

        className={zoomButtonClass}

        title="Zoom out — smaller thumbnails"

        aria-label="Zoom out thumbnails"

        disabled={!canZoomOut}

        onClick={zoomOut}

      >

        −

      </button>

      <button

        type="button"

        className={zoomButtonClass}

        title="Zoom in — larger thumbnails"

        aria-label="Zoom in thumbnails"

        disabled={!canZoomIn}

        onClick={zoomIn}

      >

        +

      </button>

    </div>

  )

}



type PageLayoutPanelProps = {

  pageCurrent: number

  pageTotal: number

  columns: PageLayoutColumnCount

  onGoToPage: (page: number) => void

  previews: Map<number, PagePreviewEntry>

  onRequestPreview: (page: number, priority?: PreviewRequestPriority) => void

}



function PageThumbnailPreview({ src }: { src: string }) {

  return (

    <img

      src={src}

      alt=""

      draggable={false}

      className="h-full w-full object-cover object-top"

    />

  )

}



function PageThumbnail({

  page,

  active,

  columns,

  preview,

  onSelect,

  onRequestPreview,

}: {

  page: number

  active: boolean

  columns: PageLayoutColumnCount

  preview: PagePreviewEntry | undefined

  onSelect: () => void

  onRequestPreview: (priority: PreviewRequestPriority) => void

}) {

  const rootRef = useRef<HTMLButtonElement>(null)

  const onRequestRef = useRef(onRequestPreview)

  onRequestRef.current = onRequestPreview

  const labelSize =

    columns >= 4 ? 'text-[9px]' : columns === 2 ? 'text-[10px]' : 'text-xs'



  useEffect(() => {

    const el = rootRef.current

    if (!el) return

    const io = new IntersectionObserver(

      (entries) => {

        for (const entry of entries) {

          if (!entry.isIntersecting) continue

          const priority: PreviewRequestPriority =

            entry.intersectionRatio >= 0.12 ? 'high' : 'normal'

          onRequestRef.current(priority)

        }

      },

      { root: null, rootMargin: '120px 0px', threshold: [0, 0.12, 0.5] },

    )

    io.observe(el)

    return () => io.disconnect()

  }, [page])



  return (

    <button

      ref={rootRef}

      type="button"

      className="group flex w-full min-w-0 cursor-pointer flex-col gap-1 border-none bg-transparent p-0 text-left"

      aria-label={`Go to page ${page}`}

      aria-current={active ? 'page' : undefined}

      onClick={onSelect}

    >

      <div

        className={`relative aspect-[3/4] w-full overflow-hidden rounded-md border bg-lib-surface transition-[border-color,box-shadow,transform] duration-300 ease-out group-hover:border-lib-accent-ring group-hover:shadow-sm ${

          active

            ? 'border-lib-accent ring-2 ring-lib-accent-ring/60'

            : 'border-lib-border-soft'

        }`}

      >

        {preview ? (

          <PageThumbnailPreview src={preview.src} />

        ) : (

          <div

            className="flex h-full w-full animate-pulse flex-col gap-1.5 bg-lib-hint/40 p-2"

            aria-hidden

          >

            <span className="block h-2 w-1/2 rounded-full bg-lib-muted/25" />

            <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" />

            <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" />

            <span className="block h-1.5 w-4/5 rounded-full bg-lib-muted/15" />

            <span className="mt-auto block h-1.5 w-2/5 rounded-full bg-lib-muted/15" />

          </div>

        )}

        <span

          className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1 pt-4 pb-1 text-center font-semibold text-white ${labelSize}`}

        >

          {page}

        </span>

      </div>

      <span

        className={`truncate text-center font-semibold transition-[font-size] duration-300 ${labelSize} ${

          active ? 'text-lib-accent' : 'text-lib-muted group-hover:text-lib-text'

        }`}

      >

        {page}

      </span>

    </button>

  )

}



export function PageLayoutPanel({

  pageCurrent,

  pageTotal,

  columns,

  onGoToPage,

  previews,

  onRequestPreview,

}: PageLayoutPanelProps) {

  if (pageTotal <= 0) {

    return (

      <p className="m-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint">

        Page thumbnails are not available yet.

      </p>

    )

  }



  return (

    <div

      className="grid gap-2 transition-[grid-template-columns,gap] duration-300 ease-out"

      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}

      data-page-layout-columns={columns}

    >

      {Array.from({ length: pageTotal }, (_, index) => {

        const page = index + 1

        return (

          <PageThumbnail

            key={page}

            page={page}

            active={page === pageCurrent}

            columns={columns}

            preview={previews.get(page)}

            onSelect={() => onGoToPage(page)}

            onRequestPreview={(priority) => onRequestPreview(page, priority)}

          />

        )

      })}

    </div>

  )

}


