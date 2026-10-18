/**
 * Node resolve hook for the TXT store ↔ Main integration check (`node --experimental-transform-types`,
 * no Vite). Same job as spikes/pdf-annotations/register-alias.mjs, plus:
 *   - a bare directory import (`'../../../../bridge'`) → its `index.ts`, because the renderer store
 *     imports the IPC bridge that way.
 * `@reading-book/book-reader-sdk` → the SDK's built bundle; `electron` → the recording stub;
 * `electron/persistence/db.ts` → the node:sqlite stand-in on the real migrations.
 */
import { register } from 'node:module'

const sdk = new URL('../../../book-reader-sdk/dist/index.mjs', import.meta.url).href
const electronStub = new URL('../pdf-annotations/electron-stub.mjs', import.meta.url).href
const dbStub = new URL('../pdf-annotations/db-stub.mjs', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export async function resolve(specifier, context, next) {
        if (specifier === '@reading-book/book-reader-sdk') return { url: ${JSON.stringify(sdk)}, shortCircuit: true }
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
