// Build a self-contained SDK into dist/:
//   dist/index.mjs  ESM bundle   (zustand/vanilla inlined — zero runtime imports)
//   dist/index.cjs  CJS bundle
//   dist/types/**   declarations (tsc), re-exported by index.d.ts / .d.mts / .d.cts
// then VERIFY the result: no bare import/require left in the bundles, no package references in
// the declarations. If either check fails the build fails — "copy dist anywhere and it runs" is
// the contract of this package.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`\n✖ build failed: ${message}\n`)
  process.exit(1)
}

// 0. Version constant must match package.json.
const versionSource = readFileSync(join(root, 'src/core/version.ts'), 'utf8')
if (!versionSource.includes(`'${pkg.version}'`)) {
  fail(`src/core/version.ts SDK_VERSION does not match package.json version ${pkg.version}`)
}

rmSync(dist, { recursive: true, force: true })

// 1. JS bundles.
const bundle = await rolldown({
  input: join(root, 'src/index.ts'),
  platform: 'neutral',
  resolve: { conditionNames: ['import', 'default'], mainFields: ['module', 'main'] },
  treeshake: true,
})
const banner = `/*! ${pkg.name} v${pkg.version} — self-contained build, includes zustand/vanilla (MIT) */`
await bundle.write({ file: join(dist, 'index.mjs'), format: 'esm', sourcemap: true, banner })
await bundle.write({ file: join(dist, 'index.cjs'), format: 'cjs', sourcemap: true, banner, exports: 'named' })
await bundle.close()

// 2. Declarations.
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' })
const typesEntry = `export * from './types/index.js'\n`
for (const name of ['index.d.ts', 'index.d.mts', 'index.d.cts']) writeFileSync(join(dist, name), typesEntry)

// 3. Verify self-containment.
const BARE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'./][^"']*)["']/g

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const problems = []
for (const file of walk(dist)) {
  if (!/\.(mjs|cjs|d\.ts|d\.mts|d\.cts)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(BARE_SPECIFIER)) {
    problems.push(`${relative(root, file)} → "${match[1]}"`)
  }
}
if (problems.length > 0) fail(`dist is not self-contained:\n  ${problems.join('\n  ')}`)
if (!existsSync(join(dist, 'types', 'index.d.ts'))) fail('dist/types/index.d.ts missing')

const size = (f) => `${(statSync(join(dist, f)).size / 1024).toFixed(1)} kB`
console.log(`✔ ${pkg.name}@${pkg.version}`)
console.log(`  dist/index.mjs ${size('index.mjs')}   dist/index.cjs ${size('index.cjs')}`)
console.log('  no bare imports in bundles or declarations — dist/ can be copied anywhere')
