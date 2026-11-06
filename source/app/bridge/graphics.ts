/** Typed wrappers for graphics:* IPC via window.api (ids + a validated op only — never bytes or paths). */
export type GraphicsListResult = Awaited<ReturnType<typeof window.api.graphics.list>>
export type GraphicsApplyResult = Awaited<ReturnType<typeof window.api.graphics.apply>>
export type PdfGraphicOpInput = Parameters<typeof window.api.graphics.apply>[0]['op']

export const graphicsApi = {
  list: (bookId: string) => window.api.graphics.list(bookId),
  apply: (input: { bookId: string; objectId: string; op: PdfGraphicOpInput }) => window.api.graphics.apply(input),
}
