/** Loads the versioned contract fixtures (spec 008, T036). Node only: used by vitest and by Desktop's spike. */
import { readFileSync, readdirSync } from 'node:fs'
import type { ContractFixture } from './contract-runner.js'

export const CONTRACT_VERSION = 1

const dir = new URL(`./fixtures/v${CONTRACT_VERSION}/`, import.meta.url)

export function loadContractFixtures(): ContractFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as ContractFixture)
}
