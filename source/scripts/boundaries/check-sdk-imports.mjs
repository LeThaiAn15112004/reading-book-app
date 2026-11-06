#!/usr/bin/env node
// R2 + R3 (spec 009 contracts/dependency-rules.md): core `src` imports only `zustand/vanilla` and relative paths that stay inside `src`;
// a path out of `src` or an `@app` import is the core importing the app (R3).
// Type-only imports count too: a type from `electron` or an app is still a dependency on it.
// This replaces the "accident of install layout" found in architecture-audit.md §3.
import path from 'node:path'
import { isInside, isMain, isRelative, listCodeFiles, runCli, scanImports, sdkDir, violation } from './lib/imports.mjs'

export const SDK_ALLOWED_PACKAGES = ['zustand/vanilla']

export function checkSdkImports({ srcDir = path.join(sdkDir, 'src') } = {}) {
  const violations = []
  for (const file of listCodeFiles(srcDir)) {
    for (const { specifier, line } of scanImports(file)) {
      if (isRelative(specifier)) {
        const target = path.resolve(path.dirname(file), specifier.split('?')[0])
        if (!isInside(target, srcDir)) {
          violations.push(violation('R3', file, line, specifier, 'a relative import leaves core src (the core never imports the app or a host folder)'))
        }
      } else if (specifier === '@app' || specifier.startsWith('@app/')) {
        violations.push(violation('R3', file, line, specifier, 'the core never imports the app'))
      } else if (!SDK_ALLOWED_PACKAGES.includes(specifier)) {
        violations.push(violation('R2', file, line, specifier, `core src may import only ${SDK_ALLOWED_PACKAGES.join(', ')} and relative paths`))
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) runCli('check-sdk-imports', checkSdkImports())
