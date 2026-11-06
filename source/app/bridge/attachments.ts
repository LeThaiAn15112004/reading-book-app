/** Typed wrappers for attachments:* IPC via api (ids only — never bytes or paths). */

import { api } from '../platforms/api'
export type AttachmentListResult = Awaited<ReturnType<typeof api.attachments.list>>
export type AttachmentItem = Extract<AttachmentListResult, { ok: true }>['items'][number]

export const attachmentsApi = {
  list: (bookId: string) => api.attachments.list(bookId),
  open: (input: { bookId: string; attachmentId: string }) => api.attachments.open(input),
  saveAs: (input: { bookId: string; attachmentId: string }) => api.attachments.saveAs(input),
  /** Place a file on a PDF page (the picker is Main's; the renderer sends page + point only). */
  create: (input: CreatePdfAttachmentRequest) => api.attachments.create(input),
  /** Move or delete a Readmate-made page attachment. */
  change: (input: ChangePdfAttachmentRequest) => api.attachments.change(input),
}

export type CreatePdfAttachmentRequest = Parameters<typeof api.attachments.create>[0]
export type CreatePdfAttachmentResult = Awaited<ReturnType<typeof api.attachments.create>>
export type ChangePdfAttachmentRequest = Parameters<typeof api.attachments.change>[0]
export type ChangePdfAttachmentResult = Awaited<ReturnType<typeof api.attachments.change>>
