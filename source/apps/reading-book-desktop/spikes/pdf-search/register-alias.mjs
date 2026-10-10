/**
 * Node resolve hook for the PDF search checks (`node --experimental-strip-types`, no Vite):
 *   - `@reading-book/book-reader-sdk` → `sdk-stub.mjs` (real text-search + chunk-text sources);
 *   - extensionless relative imports → the `.ts` file next to the importer.
 */
import { register } from 'node:module'

const sdkStub = new URL('./sdk-stub.mjs', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export async function resolve(specifier, context, next) {
        if (specifier === '@reading-book/book-reader-sdk') {
          return { url: ${JSON.stringify(sdkStub)}, shortCircuit: true }
        }
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          !/\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.startsWith('file:')
        ) {
          const candidate = new URL(specifier + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
