import { describe, expect, it } from 'vitest'
import { characteristicName, deviceVerdict, formatDeviceReport, identifyService, normalizeUuid, PROBE_SERVICES, type ProbeReport } from './deviceProbe'
import { parseFitnessMachineFeature } from './ftmsControl'

const sig = (n: number) => normalizeUuid(n)
const features = (powerTarget: boolean) => parseFitnessMachineFeature(new DataView(Uint8Array.from([2, 0x40, 0, 0, powerTarget ? 8 : 0, 0x20, 0, 0]).buffer))!
const base = (patch: Partial<ProbeReport> = {}): ProbeReport => ({
  deviceName: 'KICKR CORE 1234', services: [], characteristicsListed: true, controlPoint: false,
  measured: {}, powerSeen: true, ...patch,
})
const ftms = (extra: number[] = []) => ({ uuid: sig(0x1826), characteristics: [0x2ad2, 0x2acc, ...extra].map(sig) })

describe('service identification', () => {
  it('normalizes SIG numbers and recognizes proprietary trainer services', () => {
    expect(normalizeUuid(0x1826)).toBe('00001826-0000-1000-8000-00805f9b34fb')
    expect(normalizeUuid('2AD9')).toBe('00002ad9-0000-1000-8000-00805f9b34fb')
    expect(identifyService('6E40FEC1-B5A3-F393-E0A9-E50E24DCCA9E')?.support).toBe('proprietary')
    expect(identifyService('a026ee0d-0a7d-4ab3-97fa-f1500f9feb8b')?.key).toBe('wahoo')
    expect(identifyService(sig(0x1818))?.name).toBe('Cycling Power')
    expect(identifyService(sig(0xfff0))).toBeUndefined()
    expect(characteristicName(sig(0x2ad9))).toBe('Control Point')
    expect(characteristicName('a026e005-0a7d-4ab3-97fa-f1500f9feb8b')).toMatch(/Wahoo/)
    expect(characteristicName(sig(0xfff1))).toBe('0xfff1')
    expect(PROBE_SERVICES).toEqual(expect.arrayContaining([0x1826, 0x1818, 0x1816, 0x180d, '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e']))
  })
})

describe('deviceVerdict', () => {
  it('is fully supported only with FTMS target power and a control point', () => {
    const report = base({ services: [ftms([0x2ad9])], features: features(true), controlPoint: true })
    expect(deviceVerdict(report)).toMatchObject({ level: 'full', title: 'Fungerer fullt' })
    expect(deviceVerdict(report).text).toMatch(/Kjør ERG-testen/)
    expect(deviceVerdict({ ...report, ergTest: { state: 'passed', steps: [] } }).text).toMatch(/godtok/)
    expect(deviceVerdict({ ...report, ergTest: { state: 'failed', steps: [], error: 'svarte ikke' } }))
      .toMatchObject({ level: 'data', title: 'Fungerer uten automatisk motstand' })
  })

  it('reads data without control for plain FTMS and Cycling Power devices', () => {
    expect(deviceVerdict(base({ services: [ftms()], features: features(false) })).level).toBe('data')
    expect(deviceVerdict(base({ services: [{ uuid: sig(0x1818), characteristics: [sig(0x2a63)] }] }))).toMatchObject({ level: 'data', title: 'Fungerer uten automatisk motstand' })
    expect(deviceVerdict(base({ services: [ftms()], powerSeen: false })).note).toMatch(/Tråkk/)
  })

  it('names known proprietary protocols and refuses devices without power', () => {
    const tacx = base({ services: [{ uuid: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', characteristics: [] }, { uuid: sig(0x1816), characteristics: [sig(0x2a5b)] }] })
    expect(deviceVerdict(tacx)).toMatchObject({ level: 'none', title: 'Ikke støttet' })
    expect(deviceVerdict(tacx).text).toMatch(/Tacx FE-C.*ikke støttet ennå/)
    expect(deviceVerdict(base({ services: [{ uuid: sig(0x180d), characteristics: [sig(0x2a37)] }] })).title).toBe('Ikke støttet som sykkel')
    expect(deviceVerdict(base({ services: [{ uuid: sig(0x1826), characteristics: [sig(0x2acd)] }] })).text).toMatch(/Indoor Bike Data/)
    expect(deviceVerdict(base()).level).toBe('none')
  })

  it('trusts service presence when the browser cannot list characteristics', () => {
    expect(deviceVerdict(base({ characteristicsListed: false, services: [{ uuid: sig(0x1826), characteristics: [] }] })).level).toBe('data')
  })
})

describe('formatDeviceReport', () => {
  it('summarizes services, capabilities, measurements and the ERG test without identifiers', () => {
    const text = formatDeviceReport(base({
      manufacturer: 'Wahoo', model: 'KICKR', firmware: '4.2',
      services: [ftms([0x2ad8, 0x2ad9]), { uuid: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', characteristics: [] }],
      features: features(true), powerRange: { min: 0, max: 2000, increment: 1 }, controlPoint: true,
      measured: { power: 149.6, cadence: 88, heartRate: 140 },
      ergTest: { state: 'passed', steps: [{ target: 100, accepted: true, measured: 98.4 }, { target: 150, accepted: true, measured: 149 }] },
      log: [{ label: 'Be om kontroll', result: 'OK' }],
    }), new Date('2026-10-06T12:00:00Z'))
    expect(text).toContain('Dato: 2026-10-06')
    expect(text).toContain('Enhet: KICKR CORE 1234')
    expect(text).toContain('Produsent: Wahoo · Modell: KICKR · Fastvare: 4.2')
    expect(text).toContain('Konklusjon: Fungerer fullt.')
    expect(text).toContain('- Fitness Machine (FTMS) [støttet]: Indoor Bike Data, Feature, Supported Power Range, Control Point')
    expect(text).toContain('- Tacx FE-C over Bluetooth [kjent, ikke støttet ennå]')
    expect(text).toContain('Effektområde: 0–2000 W (steg 1 W)')
    expect(text).toContain('Målt: 150 W · 88 rpm · — km/t · 140 bpm')
    expect(text).toContain('ERG-test: bestått · 100 W godtatt (målt 98 W) · 150 W godtatt (målt 149 W)')
    expect(text).toContain('Kommandoer: Be om kontroll: OK')
    expect(text).not.toMatch(/id:/i)
  })
})
