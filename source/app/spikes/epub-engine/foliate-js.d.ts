declare module 'foliate-js/view.js' {
  export const makeBook: (file: File | Blob | string) => Promise<unknown>
  export class ResponseError extends Error {}
  export class NotFoundError extends Error {}
  export class UnsupportedTypeError extends Error {}
}

declare module 'foliate-js/search.js' {
  const mod: unknown
  export default mod
}
