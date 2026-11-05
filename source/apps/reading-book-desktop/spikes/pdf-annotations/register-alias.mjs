/**
 * Node resolve hook for the PDF text annotation checks (`node --experimental-transform-types`, no
 * Vite — `SqliteOverlayStore` uses a TS parameter property, which strip-only mode rejects):
 *   - `@reading-book/book-reader-sdk` → the SDK source (`source/core/src/index.ts`, run by `--experimental-transform-types`;
 *     no build step);
 *   - `electron` → `electron-stub.mjs` (records `ipcMain.handle` handlers);
 *   - `electron/persistence/db.ts` → `db-stub.mjs` (node:sqlite on the real migrations);
 *   - extensionless relative imports → the `.ts` file next to the importer;
 *   - relative `./x.js` imports with only an `x.ts` on disk → that `.ts` file.
 */
import { register } from 'node:module'

const sdk = new URL('../../../../core/src/index.ts', import.meta.url).href
const config = new URL('../../../../core/src/config/index.ts', import.meta.url).href
const electronStub = new URL('./electron-stub.mjs', import.meta.url).href
const dbStub = new URL('./db-stub.mjs', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export async function resolve(specifier, context, next) {
        if (specifier === '@reading-book/book-reader-sdk') return { url: ${JSON.stringify(sdk)}, shortCircuit: true }
        if (specifier === '@reading-book/config') return { url: ${JSON.stringify(config)}, shortCircuit: true }
        if (specifier === 'electron') return { url: ${JSON.stringify(electronStub)}, shortCircuit: true }
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          !/\\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.startsWith('file:')
        ) {
          const candidate = new URL(specifier + '.ts', context.parentURL)
          if (candidate.pathname.endsWith('/electron/persistence/db.ts')) {
            return { url: ${JSON.stringify(dbStub)}, shortCircuit: true }
          }
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
          const index = new URL(specifier + '/index.ts', context.parentURL)
          if (existsSync(fileURLToPath(index))) return { url: index.href, shortCircuit: true }
        }
        // TS sources importing siblings as \`./x.js\` (e.g. @reading-book/config) → the \`.ts\` file.
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          specifier.endsWith('.js') &&
          context.parentURL?.startsWith('file:')
        ) {
          const js = new URL(specifier, context.parentURL)
          const ts = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
          if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
