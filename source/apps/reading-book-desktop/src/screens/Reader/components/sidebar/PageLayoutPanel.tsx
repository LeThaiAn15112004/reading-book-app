import { useCallback, useState } from 'react'

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
        title="Zoom out — smaller cards"
        aria-label="Zoom out section cards"
        disabled={!canZoomOut}
        onClick={zoomOut}
      >
        −
      </button>
      <button
        type="button"
        className={zoomButtonClass}
        title="Zoom in — larger cards"
        aria-label="Zoom in section cards"
        disabled={!canZoomIn}
        onClick={zoomIn}
      >
        +
      </button>
    </div>
  )
}

type PageLayoutPanelProps = {
  /** 1-based visible spine *section* (not a rendered page). */
  pageCurrent: number
  pageTotal: number
  /** Section titles indexed by 0-based section position. */
  sectionLabels?: string[]
  columns: PageLayoutColumnCount
  onGoToPage: (page: number) => void
}

function SectionCard({
  page,
  label,
  active,
  columns,
  onSelect,
}: {
  page: number
  label: string
  active: boolean
  columns: PageLayoutColumnCount
  onSelect: () => void
}) {
  const labelSize =
    columns >= 4 ? 'text-[9px]' : columns === 2 ? 'text-[10px]' : 'text-xs'

  return (
    <button
      type="button"
      className="group flex w-full min-w-0 cursor-pointer flex-col gap-1 border-none bg-transparent p-0 text-left"
      aria-label={`Go to ${label}`}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      <div
        className={`relative flex aspect-[3/4] w-full flex-col gap-1.5 overflow-hidden rounded-md border bg-lib-surface p-2 transition-[border-color,box-shadow] duration-300 ease-out group-hover:border-lib-accent-ring group-hover:shadow-sm ${
          active
            ? 'border-lib-accent ring-2 ring-lib-accent-ring/60'
            : 'border-lib-border-soft'
        }`}
      >
        <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" aria-hidden />
        <span className="block h-1.5 w-full rounded-full bg-lib-muted/20" aria-hidden />
        <span className="block h-1.5 w-4/5 rounded-full bg-lib-muted/15" aria-hidden />
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
        title={label}
      >
        {label}
      </span>
    </button>
  )
}

export function PageLayoutPanel({
  pageCurrent,
  pageTotal,
  sectionLabels,
  columns,
  onGoToPage,
}: PageLayoutPanelProps) {
  if (pageTotal <= 0) {
    return (
      <p className="m-0 px-2 py-6 text-center text-[13px] leading-relaxed text-lib-faint">
        Sections are not available yet.
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
          <SectionCard
            key={page}
            page={page}
            label={sectionLabels?.[index] ?? `Section ${page}`}
            active={page === pageCurrent}
            columns={columns}
            onSelect={() => onGoToPage(page)}
          />
        )
      })}
    </div>
  )
}
