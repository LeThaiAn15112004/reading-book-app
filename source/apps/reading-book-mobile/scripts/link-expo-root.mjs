#!/usr/bin/env node
// npm hoists @expo/metro-config to source/node_modules, but `expo` stays under this app because of the React 18/19
// split, and the hoisted copy must resolve `expo` or `npx expo start` stops at load (specs/008, research R10).
// `junction` is ignored outside Windows, where this makes an ordinary symlink.
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(appRoot, 'node_modules', 'expo')
const rootModules = path.resolve(appRoot, '..', '..', 'node_modules')
const link = path.join(rootModules, 'expo')

if (!existsSync(path.join(target, 'package.json'))) process.exit(0)

const existing = lstatSync(link, { throwIfNoEntry: false })
if (existing && !existing.isSymbolicLink()) {
  // A real package here means the install layout changed: never replace what npm placed.
  console.warn(`link-expo-root: ${link} is a real folder, left as it is`)
  process.exit(0)
}
if (existing) rmSync(link, { force: true })

mkdirSync(rootModules, { recursive: true })
symlinkSync(target, link, 'junction')
