import { describe, expect, it } from 'vitest'
import { sectionFromParam } from '../../src/settings/phone-settings-nav'

const PHONE = ['appearance', 'privacy', 'advanced', 'about'] as const

describe('sectionFromParam (spec 014)', () => {
  it('returns a visible section id', () => {
    for (const id of PHONE) expect(sectionFromParam(id, PHONE)).toBe(id)
  })

  it('returns null for a missing or empty param', () => {
    expect(sectionFromParam(undefined, PHONE)).toBeNull()
    expect(sectionFromParam('', PHONE)).toBeNull()
  })

  it('returns null for an unknown id or one hidden on this host', () => {
    expect(sectionFromParam('nope', PHONE)).toBeNull()
    expect(sectionFromParam('storage', PHONE)).toBeNull()
  })

  it('is case-sensitive', () => {
    expect(sectionFromParam('Appearance', PHONE)).toBeNull()
  })
})
