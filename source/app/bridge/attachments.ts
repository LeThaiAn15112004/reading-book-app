/** Typed wrappers for attachments:* IPC via window.api (ids only — never bytes or paths). */

export type AttachmentListResult = Awaited<ReturnType<typeof window.api.attachments.list>>
export type AttachmentItem = Extract<AttachmentListResult, { ok: true }>['items'][number]

export const attachmentsApi = {
  list: (bookId: string) => window.api.attachments.list(bookId),
  open: (input: { bookId: string; attachmentId: string }) => window.api.attachments.open(input),
  saveAs: (input: { bookId: string; attachmentId: string }) => window.api.attachments.saveAs(input),
  /** Place a file on a PDF page (the picker is Main's; the renderer sends page + point only). */
  create: (input: CreatePdfAttachmentRequest) => window.api.attachments.create(input),
  /** Move or delete a Readmate-made page attachment. */
  change: (input: ChangePdfAttachmentRequest) => window.api.attachments.change(input),
}

export type CreatePdfAttachmentRequest = Parameters<typeof window.api.attachments.create>[0]
export type CreatePdfAttachmentResult = Awaited<ReturnType<typeof window.api.attachments.create>>
export type ChangePdfAttachmentRequest = Parameters<typeof window.api.attachments.change>[0]
export type ChangePdfAttachmentResult = Awaited<ReturnType<typeof window.api.attachments.change>>
