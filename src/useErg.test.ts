import { afterEach, describe, expect, it, vi } from 'vitest'
import { ergDesired, ergPreferenceId, readErgPreference, writeErgPreference } from './useErg'

const ride = { session: true, running: true, eligible: true, target: 245 }

describe('ergDesired', () => {
  it('holds the block target only during an eligible running ride with ERG on', () => {
    expect(ergDesired(true, true, ride)).toEqual({ mode: 'erg', watts: 245 })
    expect(ergDesired(true, true, { ...ride, running: false })).toEqual({ mode: 'paused' })
  })

  it('never controls demo rides, ramp tests, unsupported trainers or when switched off', () => {
    expect(ergDesired(true, true, { ...ride, eligible: false })).toEqual({ mode: 'released', stop: false })
    expect(ergDesired(false, true, ride)).toEqual({ mode: 'released', stop: false })
    expect(ergDesired(true, false, ride)).toEqual({ mode: 'released', stop: false })
  })

  it('stops and releases when the ride ends', () => {
    expect(ergDesired(true, true, { ...ride, session: false, running: false })).toEqual({ mode: 'released', stop: true })
  })
})

describe('ERG preference', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('is stored per trainer and defaults to off', () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) })
    const kickr = ergPreferenceId({ deviceId: 'abc', deviceName: 'KICKR' })
    const spin = ergPreferenceId({ deviceId: '', deviceName: 'XEBEX' })
    expect([kickr, spin, ergPreferenceId(null)]).toEqual(['abc', 'XEBEX', ''])
    expect(readErgPreference(kickr)).toBe(false)
    writeErgPreference(kickr, true)
    expect(readErgPreference(kickr)).toBe(true)
    expect(readErgPreference(spin)).toBe(false)
    writeErgPreference(kickr, false)
    expect(readErgPreference(kickr)).toBe(false)
    writeErgPreference('', true)
    expect(saved.size).toBe(1)
  })
})
