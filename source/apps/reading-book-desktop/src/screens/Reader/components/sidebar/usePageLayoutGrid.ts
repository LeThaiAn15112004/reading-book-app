import { useCallback, useState } from 'react'

import {
  PAGE_LAYOUT_COLUMN_STEPS,
  PAGE_LAYOUT_DEFAULT_STEP,
  columnsForStep,
  type PageLayoutColumnCount,
} from './pageLayoutGrid'

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
