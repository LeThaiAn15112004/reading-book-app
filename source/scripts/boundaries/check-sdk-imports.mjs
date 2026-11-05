#!/usr/bin/env node
// R2 + R3 (spec 008): SDK `src` imports only `zustand/vanilla` and relative paths that stay inside `src`.
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
          violations.push(violation('R3', file, line, specifier, 'a relative import leaves SDK src (the SDK never imports an app, config or host-adapters)'))
        }
      } else if (specifier.startsWith('@reading-book/')) {
        violations.push(violation('R3', file, line, specifier, 'the SDK never imports config or an app (config already depends on the SDK)'))
      } else if (!SDK_ALLOWED_PACKAGES.includes(specifier)) {
        violations.push(violation('R2', file, line, specifier, `SDK src may import only ${SDK_ALLOWED_PACKAGES.join(', ')} and relative paths`))
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) runCli('check-sdk-imports', checkSdkImports())
