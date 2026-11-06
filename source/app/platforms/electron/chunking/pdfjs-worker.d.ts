/** pdfjs-dist ships no typings for its worker entry; only its presence matters (`globalThis.pdfjsWorker`). */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
