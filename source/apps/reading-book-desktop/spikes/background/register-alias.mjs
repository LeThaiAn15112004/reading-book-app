/**
 * Node resolve hook for the Background & System Tray checks: `electron` → a recording stub
 * (electron-stub.mjs), and extensionless relative imports → the `.ts` file next to the importer, so
 * the real Main-process modules run under plain `node --experimental-strip-types`.
 */
import { register } from 'node:module'

const electronStub = new URL('./electron-stub.mjs', import.meta.url).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export async function resolve(specifier, context, next) {
        if (specifier === 'electron') return { url: ${JSON.stringify(electronStub)}, shortCircuit: true }
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
