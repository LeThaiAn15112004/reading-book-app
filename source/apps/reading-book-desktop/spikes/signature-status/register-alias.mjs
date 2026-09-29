/**
 * Node resolve hook for the signature checks: maps the workspace alias the Electron code imports
 * (`@reading-book/book-reader-sdk`) onto the one import-free SDK module they need at runtime, so the
 * checks run under plain `node --experimental-strip-types` without bundling the whole SDK.
 */
import { register } from 'node:module'

const target = new URL('../../../book-reader-sdk/src/domain/book/book-signature.ts', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === '@reading-book/book-reader-sdk') {
          return { url: ${JSON.stringify(target)}, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
