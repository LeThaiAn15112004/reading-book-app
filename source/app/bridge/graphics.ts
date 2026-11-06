/** Typed wrappers for graphics:* IPC via api (ids + a validated op only — never bytes or paths). */

import { api } from '../platforms/api'
export type GraphicsListResult = Awaited<ReturnType<typeof api.graphics.list>>
export type GraphicsApplyResult = Awaited<ReturnType<typeof api.graphics.apply>>
export type PdfGraphicOpInput = Parameters<typeof api.graphics.apply>[0]['op']

export const graphicsApi = {
  list: (bookId: string) => api.graphics.list(bookId),
  apply: (input: { bookId: string; objectId: string; op: PdfGraphicOpInput }) => api.graphics.apply(input),
}
