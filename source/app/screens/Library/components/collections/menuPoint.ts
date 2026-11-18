/** Where a collection menu opens: a pointer / button point on Desktop; `null` = phone sheet (or no point). */
export type CollectionMenuPoint = { x: number; y: number; flipY?: number }

/** Point below a menu button, flipping above it near the window's bottom (same rule as the book menu). */
export function menuPointFromButton(button: HTMLElement): CollectionMenuPoint {
  const rect = button.getBoundingClientRect()
  return { x: rect.right, y: rect.bottom + 4, flipY: rect.top - 4 }
}
