/**
 * Node resolve hook for the Reset App Settings checks: lets plain `node --experimental-strip-types`
 * load the renderer stores without Vite —
 *   - `@reading-book/book-reader-sdk` → a small stub (only the reading-prefs helpers are needed);
 *   - extensionless relative imports (`./appAppearance`) → the `.ts` file next to the importer.
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
          !/\\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.startsWith('file:')
        ) {
          const candidate = new URL(specifier + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
