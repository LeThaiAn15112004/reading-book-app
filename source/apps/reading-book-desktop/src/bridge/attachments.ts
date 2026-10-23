/** Typed wrappers for attachments:* IPC via window.api (ids only — never bytes or paths). */

export type AttachmentListResult = Awaited<ReturnType<typeof window.api.attachments.list>>
export type AttachmentItem = Extract<AttachmentListResult, { ok: true }>['items'][number]

export const attachmentsApi = {
  list: (bookId: string) => window.api.attachments.list(bookId),
  open: (input: { bookId: string; attachmentId: string }) => window.api.attachments.open(input),
  saveAs: (input: { bookId: string; attachmentId: string }) => window.api.attachments.saveAs(input),
}
