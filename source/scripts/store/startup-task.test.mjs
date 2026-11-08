// Spec 010 T031 — the pure Start at Login mapping of the Store build (startup-task-core.mjs).
// Run: node --test source/scripts/store/startup-task.test.mjs  (part of `npm run check:store-config -- --self-test`)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MANAGED_BY_WINDOWS,
  canChangeStartAtLogin,
  startAtLoginFromOutput,
  startupTaskOperation,
} from '../../app/platforms/electron/background/startup-task-core.mjs'

const out = (state) => `${JSON.stringify({ state })}\r\n`

describe('startAtLoginFromOutput', () => {
  it('maps every StartupTaskState', () => {
    assert.deepEqual(startAtLoginFromOutput(out('Enabled'), 0), { supported: true, enabled: true, state: 'enabled' })
    assert.deepEqual(startAtLoginFromOutput(out('Disabled'), 0), { supported: true, enabled: false, state: 'disabled' })
    assert.deepEqual(startAtLoginFromOutput(out('DisabledByUser'), 0), { supported: true, enabled: false, state: 'disabledByUser' })
    assert.deepEqual(startAtLoginFromOutput(out('DisabledByPolicy'), 0), { supported: true, enabled: false, state: 'disabledByPolicy' })
    assert.deepEqual(startAtLoginFromOutput(out('EnabledByPolicy'), 0), { supported: true, enabled: true, state: 'enabledByPolicy' })
  })
  it('reads the last line (PowerShell noise before it is ignored)', () => {
    assert.deepEqual(startAtLoginFromOutput(`WARNING: something\n${out('Enabled')}`, 0).state, 'enabled')
  })
  it('error line, non-zero exit, timeout, garbage, unknown state → managedByWindows', () => {
    for (const [stdout, code] of [
      ['{"error":"Element not found."}\n', 1],
      [out('Enabled'), 1],
      [out('Enabled'), null],
      ['not json', 0],
      ['', 0],
      [out('SomethingNew'), 0],
      ['{"error":"x"}', 0],
    ]) {
      assert.deepEqual(startAtLoginFromOutput(stdout, code), { ...MANAGED_BY_WINDOWS }, JSON.stringify([stdout, code]))
    }
  })
})

describe('canChangeStartAtLogin', () => {
  it('only enabled / disabled (and the direct build, which has no state) are the app’s to change', () => {
    assert.equal(canChangeStartAtLogin(undefined), true)
    assert.equal(canChangeStartAtLogin('enabled'), true)
    assert.equal(canChangeStartAtLogin('disabled'), true)
    for (const s of ['disabledByUser', 'disabledByPolicy', 'enabledByPolicy', 'managedByWindows']) {
      assert.equal(canChangeStartAtLogin(s), false, s)
    }
  })
})

describe('startupTaskOperation (FR-007: never overrides the user or a policy)', () => {
  const st = (state, enabled) => ({ supported: true, enabled, state })
  it('disabled → enable, enabled → disable', () => {
    assert.equal(startupTaskOperation(st('disabled', false), true), 'enable')
    assert.equal(startupTaskOperation(st('enabled', true), false), 'disable')
  })
  it('already in the requested state → nothing', () => {
    assert.equal(startupTaskOperation(st('enabled', true), true), null)
    assert.equal(startupTaskOperation(st('disabled', false), false), null)
  })
  it('turned off by the user in Windows Settings → the app does not re-enable it', () => {
    assert.equal(startupTaskOperation(st('disabledByUser', false), true), null)
  })
  it('set by policy or unknown → nothing either way', () => {
    assert.equal(startupTaskOperation(st('disabledByPolicy', false), true), null)
    assert.equal(startupTaskOperation(st('enabledByPolicy', true), false), null)
    assert.equal(startupTaskOperation({ ...MANAGED_BY_WINDOWS }, true), null)
  })
})
