#!/usr/bin/env node
// R5 / FR-006 (spec 008): the workspace dependency graph is acyclic (apps → config → SDK). Edges come from two
// sources, because either alone can hide a cycle: manifest dependencies on another workspace package, and imports
// (relative or alias, type-only included) from one package's files into another package's folder.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  isInside, isMain, listCodeFiles, rel, runCli, scanImports, sourceRoot, targetPath, violation,
} from './lib/imports.mjs'

/**
 * The code areas of the single project (spec 009): npm workspaces are gone, so the areas are listed here. An area
 * without a manifest is named after its folder. T050 re-points this list when the areas move to `source/core` and
 * `source/app`.
 */
export const AREA_DIRS = ['core', 'app', 'apps/reading-book-mobile']

export function workspacePackages(root = sourceRoot) {
  return AREA_DIRS.map((d) => path.join(root, d))
    .filter((dir) => existsSync(dir))
    .map((dir) => {
      const file = path.join(dir, 'package.json')
      const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { name: path.basename(dir) }
      return { name: manifest.name ?? path.basename(dir), dir, manifest }
    })
}

export function workspaceEdges(packages) {
  const names = new Set(packages.map((p) => p.name))
  const edges = new Map() // "a -> b" → first evidence
  const add = (from, to, evidence) => {
    if (from === to) return
    const key = `${from} -> ${to}`
    if (!edges.has(key)) edges.set(key, { from, to, evidence })
  }
  for (const p of packages) {
    const m = p.manifest
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(m[field] ?? {})) if (names.has(dep)) add(p.name, dep, `package.json ${field}`)
    }
    // A nested package's own folder belongs to it, not to its parent.
    const nested = packages.filter((q) => q !== p && isInside(q.dir, p.dir)).map((q) => q.dir)
    for (const file of listCodeFiles(p.dir)) {
      // A `.native` platform adapter is the WebView half of the shared UI and belongs to the Mobile area (T043/T044).
      if (/\/platforms\/[^/]+\.native\.tsx?$/.test(file.replaceAll('\\', '/'))) continue
      if (nested.some((d) => isInside(file, d))) continue
      for (const { specifier, line } of scanImports(file)) {
        const target = targetPath(file, specifier)
        const owner = target && packages.find((q) => q !== p && isInside(target, q.dir))
        if (owner) add(p.name, owner.name, `${rel(file)}:${line} "${specifier}"`)
      }
    }
  }
  return [...edges.values()]
}

/** Every elementary cycle reachable, each reported once, as a list of package names. */
export function findCycles(edges) {
  const next = new Map()
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  const cycles = []
  const seenCycle = new Set()
  const walk = (start, node, trail) => {
    for (const to of next.get(node) ?? []) {
      if (to === start) {
        const cycle = [...trail, start]
        const key = [...cycle.slice(0, -1)].sort().join(',')
        if (!seenCycle.has(key)) {
          seenCycle.add(key)
          cycles.push(cycle)
        }
      } else if (!trail.includes(to)) {
        walk(start, to, [...trail, to])
      }
    }
  }
  for (const start of next.keys()) walk(start, start, [start])
  return cycles
}

export function checkWorkspaceGraph({ packages = workspacePackages() } = {}) {
  const edges = workspaceEdges(packages)
  const violations = findCycles(edges).map((cycle) => {
    const first = edges.find((e) => e.from === cycle[0] && e.to === cycle[1])
    return violation('R5', path.join(sourceRoot, '..', 'package.json'), 0, cycle.join(' -> '), `workspace cycle; first edge from ${first?.evidence ?? '?'}`)
  })
  return { violations, edges }
}

if (isMain(import.meta.url)) {
  const { violations, edges } = checkWorkspaceGraph()
  runCli('check-workspace-graph', violations, { notes: [`edges: ${edges.map((e) => `${e.from} -> ${e.to}`).join(', ')}`] })
}
