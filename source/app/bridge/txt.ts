/** Typed wrappers for txt:* IPC via api. */

import { api } from '../platforms/api'
export type TxtOpenResult = Awaited<ReturnType<typeof api.txt.open>>
export type TxtCommitInput = Parameters<typeof api.txt.commit>[0]
export type TxtCommitResult = Awaited<ReturnType<typeof api.txt.commit>>

export const txtApi = {
  open: (bookId: string) => api.txt.open(bookId),
  commit: (input: TxtCommitInput) => api.txt.commit(input),
}
