/**
 * Node resolve hook for the Reset App Settings checks: lets plain `node --experimental-strip-types`
 * load the renderer stores without Vite —
 *   - `@core` → a small stub (only the reading-prefs helpers are needed);
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
        if (specifier === '@core') {
          return { url: ${JSON.stringify(sdkStub)}, shortCircuit: true }
        }
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          !/\\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.startsWith('file:')
        ) {
          // Platform adapters (spec 009): the spikes run the Desktop renderer, so the .electron.ts file of a concern wins.

          const adapter = new URL(specifier + '.electron.ts', context.parentURL)

          if (existsSync(fileURLToPath(adapter))) return { url: adapter.href, shortCircuit: true }

          const candidate = new URL(specifier + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        // SDK sources import siblings as ./x.js: use the .ts file next to the importer.
        if (
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          specifier.endsWith('.js') &&
          context.parentURL?.startsWith('file:')
        ) {
          const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
