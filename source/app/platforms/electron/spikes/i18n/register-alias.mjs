/**
 * Node resolve hook for the Main i18n checks (spec 012): `electron` → a small stub, `@core` → the REAL core i18n
 * module (`main-i18n.ts` only needs it), `./x.js` in core sources → the `.ts` next to it, extensionless relative
 * imports → the `.ts` file next to the importer.
 */
import { register } from 'node:module'

const electronStub = new URL('./electron-stub.mjs', import.meta.url).href
const coreI18n = new URL('../../../../../core/src/i18n/index.ts', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export async function resolve(specifier, context, next) {
        if (specifier === 'electron') return { url: ${JSON.stringify(electronStub)}, shortCircuit: true }
        if (specifier === '@core') return { url: ${JSON.stringify(coreI18n)}, shortCircuit: true }
        const relative = (specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')
        if (relative && specifier.endsWith('.js')) {
          const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        if (relative && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
          const candidate = new URL(specifier + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
        }
        return next(specifier, context)
      }
    `),
)
