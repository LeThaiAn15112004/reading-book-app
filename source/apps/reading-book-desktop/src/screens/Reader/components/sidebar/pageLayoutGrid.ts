/** Column counts from zoomed-out (dense) to zoomed-in (large thumbnails). */
export const PAGE_LAYOUT_COLUMN_STEPS = [6, 4, 2, 1] as const

export type PageLayoutColumnCount = (typeof PAGE_LAYOUT_COLUMN_STEPS)[number]

export const PAGE_LAYOUT_DEFAULT_STEP = 2 // 2 columns

export function columnsForStep(step: number): PageLayoutColumnCount {
  const clamped = Math.min(
    Math.max(step, 0),
    PAGE_LAYOUT_COLUMN_STEPS.length - 1,
  )
  return PAGE_LAYOUT_COLUMN_STEPS[clamped]!
}
