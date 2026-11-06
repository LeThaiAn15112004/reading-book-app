#!/usr/bin/env node
// R6, R7, R8, R11, R12 (spec 009, contracts/dependency-rules.md), checked on the import graph of `source/app`:
//   R6  The driver adapters implement the core's SQL ports: the Desktop adapter imports `SyncSqlDriver`, the Mobile
//       one `AsyncSqlDriver`, both from the core.
//   R7  The two hosts never import each other: `platforms/electron/**` and `*.electron.*` on one side,
//       `platforms/native/**` and `*.native.*` on the other. Type-only imports are erased by the build and allowed.
//   R8  The Mobile side contains no Electron code: no `electron` or `better-sqlite3` package, and (host code) no
//       `react-dom`. Its runtime imports into `platforms/electron/**` are R7; the WebView build graph is
//       check-mobile-ui-graph.
//   R11 Node-only host adapters (`platforms/electron/host-adapters`) are imported only from the Desktop side.
//   R12 UI code imports an adapter without its suffix: no `*.electron` / `*.native` import outside `source/app/platforms`.
import path from 'node:path'
import { existsSync } from 'node:fs'
import {
  appDir, coreDir, desktopDir, hostAdaptersDir, isInside, isMain, isRelative, listCodeFiles, loadExceptions, mobileDir, packageName, rel,
  runCli, scanImports, targetPath, violation,
} from './lib/imports.mjs'

const MOBILE_SKIP = new Set(['node_modules', 'dist', 'web-dist', '.expo', 'android', 'ios', 'ui-assets', 'coverage'])
const SUFFIXED = /\.(electron|native)(\.[cm]?[jt]sx?)?$/
const MOBILE_FORBIDDEN_PACKAGES = ['electron', 'better-sqlite3']
const MOBILE_HOST_FORBIDDEN_PACKAGES = ['react-dom']

/** The two SQL driver adapters and the core port each one implements (R6). */
export const DRIVER_ADAPTERS = [
  { file: 'persistence/sql-driver.ts', host: 'electron', port: 'SyncSqlDriver' },
  { file: 'bridge/host-sql-driver.ts', host: 'native', port: 'AsyncSqlDriver' },
]

/** Where a Mobile file sits: the WebView build, build tooling, or the React Native host. */
export function mobileArea(file, root = mobileDir) {
  const r = path.relative(root, file).replaceAll('\\', '/')
  if (r.startsWith('scripts/')) return 'tooling'
  // The WebView side of the Mobile folder; everything else (host/, routes/, services/, modules/, plugins/) is the React Native host.
  if (/^(bridge|stores|db|feasibility|tests)\//.test(r) || (/^[^/]+\.(ts|html)$/.test(r) && !/^eslint/.test(r) && r !== 'env.d.ts')) return 'web'
  return 'host'
}

/** Which host a file belongs to: its folder under `platforms/`, or the suffix of an adapter in `platforms/`. */
function sideOf(file, electron, native) {
  const f = file.replaceAll('\\', '/')
  if (isInside(file, native) || /\.native(\.[cm]?[jt]sx?)?$/.test(f)) return 'native'
  if (isInside(file, electron) || /\.electron(\.[cm]?[jt]sx?)?$/.test(f)) return 'electron'
  return null
}

export function checkAppImports({
  app = appDir,
  core = coreDir,
  electron = desktopDir,
  native = mobileDir,
  hostAdapters = hostAdaptersDir,
  exceptions = loadExceptions(),
} = {}) {
  const allowedHostAdapterUsers = new Set(exceptions.filter((e) => e.rule === 'R11' && e.kind === 'app-imports').map((e) => e.importedBy))
  const violations = []
  const platforms = path.join(app, 'platforms')
  const resolve = (file, spec) => {
    const target = targetPath(file, spec)
    // Fixture roots differ from the real ones; aliases still map to the real core, so re-map them under `core`.
    if (target && core !== coreDir && isInside(target, coreDir)) return path.join(core, path.relative(coreDir, target))
    if (target && app !== appDir && isInside(target, appDir)) return path.join(app, path.relative(appDir, target))
    return target
  }

  for (const file of listCodeFiles(app, { skip: MOBILE_SKIP })) {
    const side = sideOf(file, electron, native)
    const inPlatforms = isInside(file, platforms)
    const area = isInside(file, native) ? mobileArea(file, native) : null
    for (const { specifier, line, typeOnly } of scanImports(file)) {
      const target = resolve(file, specifier)
      const pkg = isRelative(specifier) || target ? null : packageName(specifier)
      const targetSide = target ? sideOf(target, electron, native) : null

      if (!inPlatforms && SUFFIXED.test(specifier.split('?')[0])) {
        violations.push(violation('R12', file, line, specifier, 'import the adapter without its .electron / .native suffix (UI code outside source/app/platforms)'))
      }
      if (side && targetSide && side !== targetSide && !typeOnly) {
        violations.push(violation('R7', file, line, specifier, `${side} code never imports ${targetSide} code (the two hosts stay apart)`))
      }
      if (side === 'native' && pkg) {
        if (MOBILE_FORBIDDEN_PACKAGES.includes(pkg) || (area === 'host' && MOBILE_HOST_FORBIDDEN_PACKAGES.includes(pkg))) {
          violations.push(violation('R8', file, line, specifier, 'Mobile code imports no electron, no better-sqlite3 and (host) no DOM library'))
        }
      }
      const intoHostAdapters = (target && isInside(target, hostAdapters)) || specifier.startsWith('@core/host-adapters')
      if (intoHostAdapters && side !== 'electron' && !allowedHostAdapterUsers.has(rel(file))) {
        violations.push(violation('R11', file, line, specifier, 'host-adapters are Node-only: only the Desktop side imports them'))
      }
    }
  }

  // R6: each driver adapter exists and imports its port from the core.
  for (const { file, host, port } of DRIVER_ADAPTERS) {
    const adapter = path.join(host === 'electron' ? electron : native, file)
    if (!existsSync(adapter)) {
      violations.push(violation('R6', adapter, 0, port, `the ${host} driver adapter file is missing`))
      continue
    }
    const imported = scanImports(adapter).some(({ specifier }) => {
      const target = resolve(adapter, specifier)
      return target && isInside(target, core) && !isInside(target, path.join(core, 'node_modules'))
    })
    const src = scanImports(adapter)
    if (!imported && !src.some(({ specifier }) => specifier === '@core')) {
      violations.push(violation('R6', adapter, 1, port, `the ${host} driver adapter must implement the core's ${port}: import it from @core`))
    }
  }
  return violations
}

if (isMain(import.meta.url)) runCli('check-app-imports', checkAppImports())
