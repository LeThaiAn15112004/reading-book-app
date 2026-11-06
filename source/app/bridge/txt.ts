/** Typed wrappers for txt:* IPC via window.api. */

export type TxtOpenResult = Awaited<ReturnType<typeof window.api.txt.open>>
export type TxtCommitInput = Parameters<typeof window.api.txt.commit>[0]
export type TxtCommitResult = Awaited<ReturnType<typeof window.api.txt.commit>>

export const txtApi = {
  open: (bookId: string) => window.api.txt.open(bookId),
  commit: (input: TxtCommitInput) => window.api.txt.commit(input),
}
