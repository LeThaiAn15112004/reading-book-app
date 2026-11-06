#!/usr/bin/env node
// R7, R8, R11 (spec 008):
//   R7  Desktop and Mobile never import each other. The one allowed direction: Mobile's `web/` imports Desktop's
//       `src/` (the UI is built from Desktop's source, FR-016).
//   R8  Mobile host code (the React Native app: `src/`, `modules/`, `plugins/`, root config files) imports no
//       `electron` and no DOM library (`react-dom`).
//   R11 No Mobile file imports `electron/host-adapters` (until OD-7).
import path from 'node:path'
import {
  appDir, desktopDir, hostAdaptersDir, isInside, isMain, isRelative, listCodeFiles, mobileDir, packageName, runCli, scanImports, sdkDir,
  targetPath, violation,
} from './lib/imports.mjs'

const MOBILE_SKIP = new Set(['node_modules', 'dist', '.expo', 'android', 'ios', 'ui-assets', 'coverage'])
const DOM_LIBRARIES = ['react-dom']

/** Where a Mobile file sits: the web UI build, build tooling, or the React Native host. */
export function mobileArea(file, root = mobileDir) {
  const r = path.relative(root, file).replaceAll('\\', '/')
  if (r.startsWith('web/')) return 'web'
  if (r.startsWith('scripts/')) return 'tooling'
  return 'host'
}

export function checkAppImports({ app = appDir, desktop = desktopDir, mobile = mobileDir, sdk = sdkDir, hostAdaptersRoot = hostAdaptersDir } = {}) {
  const violations = []
  const hostAdapters = hostAdaptersRoot
  const resolve = (file, spec) => {
    const target = targetPath(file, spec)
    // Fixture roots differ from the real ones; aliases still map to the real SDK, so re-map them under `sdk`.
    if (target && sdk !== sdkDir && isInside(target, sdkDir)) return path.join(sdk, path.relative(sdkDir, target))
    return target
  }

  for (const file of [...listCodeFiles(app), ...listCodeFiles(desktop)]) {
    for (const { specifier, line } of scanImports(file)) {
      const target = resolve(file, specifier)
      // A `.native` platform adapter is the WebView side of the shared UI: it may import Mobile's web/ (contracts/platform-adapters.md).
      if (/\/platforms\/[^/]+\.native\.tsx?$/.test(file.replaceAll('\\', '/')) && target && isInside(target, path.join(mobile, 'web'))) continue
      if ((target && isInside(target, mobile)) || (!isRelative(specifier) && packageName(specifier) === 'reading-book-mobile')) {
        violations.push(violation('R7', file, line, specifier, 'Desktop never imports Mobile'))
      }
    }
  }

  for (const file of listCodeFiles(mobile, { skip: MOBILE_SKIP })) {
    const area = mobileArea(file, mobile)
    for (const { specifier, line } of scanImports(file)) {
      const target = resolve(file, specifier)
      const pkg = isRelative(specifier) ? null : packageName(specifier)
      const intoDesktop = (target && isInside(target, desktop)) || pkg === 'reading-book-desktop'
      if (intoDesktop && !(area === 'web' && target && (isInside(target, path.join(desktop, 'src')) || isInside(target, app)))) {
        violations.push(violation('R7', file, line, specifier, "Mobile never imports Desktop; only Mobile's web/ may import the shared UI in source/app"))
      }
      if (area === 'host' && pkg && (pkg === 'electron' || DOM_LIBRARIES.includes(pkg))) {
        violations.push(violation('R8', file, line, specifier, 'Mobile host code imports no electron and no DOM library'))
      }
      const intoHostAdapters =
        (target && isInside(target, hostAdapters)) || specifier.startsWith('@reading-book/book-reader-sdk/host-adapters')
      if (intoHostAdapters) {
        violations.push(violation('R11', file, line, specifier, 'Mobile does not import electron/host-adapters (OD-7)'))
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) runCli('check-app-imports', checkAppImports())
