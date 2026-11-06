#!/usr/bin/env node
// R8 / FR-015 (spec 008): the Mobile UI bundle graph contains no Desktop `electron/` runtime code and no `electron`
// package. The graph is followed from Mobile's web entry through every runtime import (static, re-export, dynamic);
// type-only imports are erased by the build, so they are allowed and not followed.
// The one allowed file, `electron/pdf-sync/pdf-font-embed.ts`, is listed in exceptions.json (plan.md, Complexity
// Tracking); its own runtime imports are still followed and checked.
import path from 'node:path'
import {
  CODE_EXTENSIONS, desktopDir, isInside, isMain, isRelative, loadExceptions, mobileDir, norm, packageName, rel,
  hostAdaptersDir, resolveFile, runCli, scanImports, targetPath, violation,
} from './lib/imports.mjs'

export function allowedElectronFiles(exceptions = loadExceptions(), root = desktopDir) {
  return new Set(
    exceptions
      .filter((e) => e.rule === 'R8' && e.kind === 'mobile-ui-graph')
      .map((e) => norm(path.join(root, e.target))),
  )
}

export function checkMobileUiGraph({
  entries = [path.join(mobileDir, 'main.ts')],
  desktop = desktopDir,
  allowed = allowedElectronFiles(),
  // Main's folder inside `desktop`: the whole host folder in the real tree, an `electron/` subfolder in the test fixtures.
  electronSubdir = '',
} = {}) {
  const electronDir = path.join(desktop, electronSubdir)
  const violations = []
  const reachedHostAdapters = new Set()
  const unresolved = []
  const seen = new Set()
  const queue = entries.map((e) => path.resolve(e))
  while (queue.length) {
    const file = queue.shift()
    const key = norm(file)
    if (seen.has(key)) continue
    seen.add(key)
    if (!CODE_EXTENSIONS.includes(path.extname(file))) continue
    if (isInside(file, hostAdaptersDir)) reachedHostAdapters.add(rel(file))
    for (const { specifier, typeOnly, line } of scanImports(file)) {
      if (typeOnly) continue
      if (!isRelative(specifier) && targetPath(file, specifier) === null) {
        const pkg = packageName(specifier)
        if (pkg === 'electron') violations.push(violation('R8', file, line, specifier, 'the Mobile UI bundle must not import the electron package'))
        continue
      }
      const target = resolveFile(targetPath(file, specifier))
      if (!target) {
        // Assets (`?url`, fonts, CSS) and files the build generates are not code; anything else is worth a look.
        const bare = specifier.split('?')[0]
        if (!specifier.includes('?') && CODE_EXTENSIONS.concat('').includes(path.extname(bare))) unresolved.push(`${rel(file)}:${line} "${specifier}"`)
        continue
      }
      if (isInside(target, electronDir) && !isInside(target, hostAdaptersDir) && !allowed.has(norm(target))) {
        violations.push(violation('R8', file, line, specifier, `the Mobile UI bundle reaches Desktop electron/ runtime code (${rel(target)}); only exceptions.json entries are allowed`))
        continue
      }
      queue.push(target)
    }
  }
  return { violations, files: seen.size, reachedHostAdapters: [...reachedHostAdapters].sort(), unresolved }
}

if (isMain(import.meta.url)) {
  const result = checkMobileUiGraph()
  const notes = [`${result.files} files reached from the Mobile main.ts`]
  if (result.reachedHostAdapters.length) {
    notes.push(`${result.reachedHostAdapters.length} host-adapters files reached through Desktop's UI source (not a Mobile import, so not an R11 violation), first: ${result.reachedHostAdapters[0]}`)
  }
  if (result.unresolved.length) notes.push(`unresolved code imports: ${result.unresolved.join('; ')}`)
  runCli('check-mobile-ui-graph', result.violations, { notes })
}
