/**
 * Node resolve hook for the TXT store ↔ Main integration check (`node --experimental-transform-types`,
 * no Vite). Same job as spikes/pdf-annotations/register-alias.mjs, plus:
 *   - a bare directory import (`'../../../../bridge'`) → its `index.ts`, because the renderer store
 *     imports the IPC bridge that way.
 * `@reading-book/book-reader-sdk` → the SDK source; `electron` → the recording stub;
 * `electron/persistence/db.ts` → the node:sqlite stand-in on the real migrations.
 */
import { register } from 'node:module'

const sdk = new URL('../../../../../core/src/index.ts', import.meta.url).href
const config = new URL('../../../../../core/src/config/index.ts', import.meta.url).href
const electronStub = new URL('../pdf-annotations/electron-stub.mjs', import.meta.url).href
const dbStub = new URL('../pdf-annotations/db-stub.mjs', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      // Main imports JSON without an import attribute (Vite allows it, Node does not): serve it as an ES module.
      export async function load(url, context, next) {
        if (url.startsWith('file:') && url.endsWith('.json')) {
          const { readFileSync } = await import('node:fs')
          return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true }
        }
        return next(url, context)
      }
      export async function resolve(specifier, context, next) {
        if (specifier === '@reading-book/book-reader-sdk') return { url: ${JSON.stringify(sdk)}, shortCircuit: true }
        if (specifier === '@reading-book/config') return { url: ${JSON.stringify(config)}, shortCircuit: true }
        if (specifier === 'electron') return { url: ${JSON.stringify(electronStub)}, shortCircuit: true }
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          !/\\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.startsWith('file:')
        ) {
          // Platform adapters (spec 009): the spikes run the Desktop renderer, so the .electron.ts file of a concern wins.
          const adapter = new URL(specifier + '.electron.ts', context.parentURL)
          if (existsSync(fileURLToPath(adapter))) return { url: adapter.href, shortCircuit: true }
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
