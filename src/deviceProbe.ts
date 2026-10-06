/**
 * "Test sykkelen din": which GATT services a device exposes, what SUMMIT can do
 * with them, and a plain-language verdict. Pure functions only; the page does BLE.
 */
import type { FtmsFeatures, FtmsLogEntry, PowerRange } from './ftmsControl'

export type ServiceSupport = 'supported' | 'info' | 'proprietary'
export interface KnownService { uuid: string; key: string; name: string; role: string; support: ServiceSupport }

const BASE = '-0000-1000-8000-00805f9b34fb'
/** Full lowercase 128-bit UUID for a 16-bit SIG number or any UUID string. */
export function normalizeUuid(uuid: number | string): string {
  if (typeof uuid === 'number') return `0000${uuid.toString(16).padStart(4, '0')}${BASE}`
  const lower = uuid.toLowerCase()
  return /^[0-9a-f]{4}$/.test(lower) ? `0000${lower}${BASE}` : lower
}
const WAHOO = /^a026[0-9a-f]{4}-0a7d-4ab3-97fa-f1500f9feb8b$/
const wahoo = (id: string) => normalizeUuid(`a026${id}-0a7d-4ab3-97fa-f1500f9feb8b`)
const WAHOO_SERVICE = { key: 'wahoo', name: 'Wahoo (proprietær)', role: 'Wahoos egen trener-/tilbehørsprotokoll', support: 'proprietary' as const }

export const KNOWN_SERVICES: KnownService[] = [
  { uuid: normalizeUuid(0x1826), key: 'ftms', name: 'Fitness Machine (FTMS)', role: 'Watt, kadens, fart og motstandsstyring', support: 'supported' },
  { uuid: normalizeUuid(0x1818), key: 'cp', name: 'Cycling Power', role: 'Watt og kadens', support: 'supported' },
  { uuid: normalizeUuid(0x1816), key: 'csc', name: 'Cycling Speed and Cadence', role: 'Kadens og fart', support: 'supported' },
  { uuid: normalizeUuid(0x180d), key: 'hr', name: 'Heart Rate', role: 'Puls', support: 'supported' },
  { uuid: normalizeUuid(0x180a), key: 'dis', name: 'Device Information', role: 'Produsent, modell og fastvare', support: 'info' },
  { uuid: normalizeUuid(0x180f), key: 'battery', name: 'Battery', role: 'Batterinivå', support: 'info' },
  { uuid: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', key: 'tacx', name: 'Tacx FE-C over Bluetooth', role: 'Tacx/Garmins egen styringsprotokoll', support: 'proprietary' },
  ...['ee01', 'ee03', 'ee06', 'ee07', 'ee0b'].map(id => ({ uuid: wahoo(id), ...WAHOO_SERVICE })),
]
/** Everything the page may open: with acceptAllDevices only these services are visible. */
export const PROBE_SERVICES: Array<number | string> = [0x1826, 0x1818, 0x1816, 0x180d, 0x180a, 0x180f,
  ...KNOWN_SERVICES.filter(s => s.support === 'proprietary').map(s => s.uuid)]

export function identifyService(uuid: string): KnownService | undefined {
  const id = normalizeUuid(uuid)
  return KNOWN_SERVICES.find(service => service.uuid === id) ?? (WAHOO.test(id) ? { uuid: id, ...WAHOO_SERVICE } : undefined)
}

/** What matters for riding first: supported data, then known-but-unsupported protocols, then info, then unknown. */
export function serviceRank(uuid: string): number {
  const support = identifyService(uuid)?.support
  return support === 'supported' ? 0 : support === 'proprietary' ? 1 : support === 'info' ? 2 : 3
}

const CHARACTERISTICS: Record<string, string> = {
  [normalizeUuid(0x2ad2)]: 'Indoor Bike Data',
  [normalizeUuid(0x2acc)]: 'Feature',
  [normalizeUuid(0x2ad8)]: 'Supported Power Range',
  [normalizeUuid(0x2ad6)]: 'Supported Resistance Range',
  [normalizeUuid(0x2ad9)]: 'Control Point',
  [normalizeUuid(0x2ada)]: 'Machine Status',
  [normalizeUuid(0x2ad3)]: 'Training Status',
  [normalizeUuid(0x2a63)]: 'Cycling Power Measurement',
  [normalizeUuid(0x2a65)]: 'Cycling Power Feature',
  [normalizeUuid(0x2a66)]: 'Cycling Power Control Point',
  [normalizeUuid(0x2a5d)]: 'Sensor Location',
  [normalizeUuid(0x2a5b)]: 'CSC Measurement',
  [normalizeUuid(0x2a5c)]: 'CSC Feature',
  [normalizeUuid(0x2a37)]: 'Heart Rate Measurement',
  [normalizeUuid(0x2a38)]: 'Body Sensor Location',
  [normalizeUuid(0x2a29)]: 'Manufacturer Name',
  [normalizeUuid(0x2a24)]: 'Model Number',
  [normalizeUuid(0x2a26)]: 'Firmware Revision',
  [normalizeUuid(0x2a28)]: 'Software Revision',
  [normalizeUuid(0x2a27)]: 'Hardware Revision',
  [normalizeUuid(0x2a19)]: 'Battery Level',
  '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e': 'FE-C data',
  '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e': 'FE-C skriv',
}
export function characteristicName(uuid: string): string {
  const id = normalizeUuid(uuid)
  if (CHARACTERISTICS[id]) return CHARACTERISTICS[id]
  if (id === wahoo('e005')) return 'Wahoo trenerkontroll (proprietær)'
  if (WAHOO.test(id)) return 'Wahoo (proprietær)'
  return id.endsWith(BASE) ? `0x${id.slice(4, 8)}` : id
}

export interface ProbeService { uuid: string; characteristics: string[] }
export interface ErgTestStep { target: number; accepted: boolean; measured?: number }
export interface ErgTestResult { state: 'passed' | 'failed' | 'stopped'; steps: ErgTestStep[]; error?: string }
export interface ProbeReport {
  deviceName: string
  manufacturer?: string
  model?: string
  firmware?: string
  services: ProbeService[]
  /** False when the browser would not list characteristics; then presence of a service is all we know. */
  characteristicsListed: boolean
  features?: FtmsFeatures
  powerRange?: PowerRange
  controlPoint: boolean
  measured: { power?: number; cadence?: number; speed?: number; heartRate?: number }
  powerSeen: boolean
  ergTest?: ErgTestResult
  log?: FtmsLogEntry[]
}

const has = (r: ProbeReport, key: string) => r.services.some(s => identifyService(s.uuid)?.key === key)
const hasCharacteristic = (r: ProbeReport, service: number, characteristic: number) => {
  const found = r.services.find(s => normalizeUuid(s.uuid) === normalizeUuid(service))
  return !!found && (!r.characteristicsListed || found.characteristics.some(c => normalizeUuid(c) === normalizeUuid(characteristic)))
}
export const powerSourceOf = (r: ProbeReport): 'ftms' | 'cp' | null =>
  hasCharacteristic(r, 0x1826, 0x2ad2) ? 'ftms' : hasCharacteristic(r, 0x1818, 0x2a63) ? 'cp' : null
export const controlSupported = (r: ProbeReport) => !!r.features?.powerTarget && r.controlPoint
function proprietaryNames(r: ProbeReport): string[] {
  return [...new Set(r.services.map(s => identifyService(s.uuid)).filter(s => s?.support === 'proprietary').map(s => s!.name))]
}

export type VerdictLevel = 'full' | 'data' | 'none'
export interface Verdict { level: VerdictLevel; title: string; text: string; note?: string }

export function deviceVerdict(r: ProbeReport): Verdict {
  const proprietary = proprietaryNames(r)
  const known = proprietary.length ? `${proprietary.join(' og ')} ble funnet – kjent, men ikke støttet ennå.` : ''
  const source = powerSourceOf(r)
  if (!source) {
    if (proprietary.length) return { level: 'none', title: 'Ikke støttet', text: `${known} SUMMIT trenger standard FTMS eller Cycling Power for å lese watt.` }
    if (has(r, 'ftms')) return { level: 'none', title: 'Ikke støttet', text: 'Enheten er en FTMS-maskin, men sender ikke sykkeldata (Indoor Bike Data).' }
    if (has(r, 'csc') || has(r, 'hr')) return { level: 'none', title: 'Ikke støttet som sykkel', text: 'Enheten sender bare kadens, fart eller puls. Den kan kobles til som ekstra sensor under «Flere sensorer», men SUMMIT trenger watt fra sykkelen.' }
    return { level: 'none', title: 'Ikke støttet', text: 'Fant ingen standard sykkeldata (FTMS eller Cycling Power). Sjekk at sykkelen er på, og at ingen annen app er koblet til den.' }
  }
  const note = r.powerSeen ? undefined : 'Ingen watt mottatt ennå. Tråkk noen omdreininger.'
  const withNote = (v: Verdict): Verdict => note ? { ...v, note } : v
  if (controlSupported(r) && r.ergTest?.state === 'failed')
    return withNote({ level: 'data', title: 'Fungerer uten automatisk motstand', text: `Watt leses, men sykkelen avviste automatisk motstand${r.ergTest.error ? ` (${r.ergTest.error})` : ''}. Juster motstanden selv.` })
  if (controlSupported(r))
    return withNote({ level: 'full', title: 'Fungerer fullt', text: r.ergTest?.state === 'passed'
      ? 'Watt leses, og sykkelen godtok automatisk motstand (ERG).'
      : 'Watt leses, og sykkelen oppgir støtte for automatisk motstand (ERG). Kjør ERG-testen for å bekrefte.' })
  return withNote({ level: 'data', title: 'Fungerer uten automatisk motstand', text: `Watt${source === 'ftms' || r.measured.cadence !== undefined ? ' og kadens' : ''} leses. Sykkelen tilbyr ikke standard motstandsstyring, så du justerer motstanden selv.${known ? ` ${known}` : ''}` })
}

const yes = (value: boolean | undefined) => value ? 'ja' : 'nei'
const value = (n: number | undefined, unit: string, digits = 0) => n === undefined ? `— ${unit}` : `${n.toFixed(digits)} ${unit}`

/** Plain text for support threads. Device name and capabilities only: no ids, no personal data. */
export function formatDeviceReport(r: ProbeReport, date = new Date()): string {
  const verdict = deviceVerdict(r)
  const lines = [
    'SUMMIT – sykkeltest',
    `Dato: ${date.toISOString().slice(0, 10)}`,
    `Enhet: ${r.deviceName || 'uten navn'}`,
  ]
  const identity = [r.manufacturer && `Produsent: ${r.manufacturer}`, r.model && `Modell: ${r.model}`, r.firmware && `Fastvare: ${r.firmware}`].filter(Boolean)
  if (identity.length) lines.push(identity.join(' · '))
  lines.push(`Konklusjon: ${verdict.title}. ${verdict.text}`, '', 'Tjenester:')
  if (!r.services.length) lines.push('- ingen kjente tjenester funnet')
  for (const service of [...r.services].sort((a, b) => serviceRank(a.uuid) - serviceRank(b.uuid))) {
    const known = identifyService(service.uuid)
    const label = known ? known.name : characteristicName(service.uuid)
    const status = !known ? 'ukjent' : known.support === 'proprietary' ? 'kjent, ikke støttet ennå' : known.support === 'info' ? 'info' : 'støttet'
    const characteristics = service.characteristics.map(characteristicName)
    lines.push(`- ${label} [${status}]${characteristics.length ? `: ${characteristics.join(', ')}` : ''}`)
  }
  if (r.features) {
    lines.push('', `FTMS: kadens ${yes(r.features.cadence)} · wattmåling ${yes(r.features.powerMeasurement)} · wattmål (ERG) ${yes(r.features.powerTarget)} · simulering ${yes(r.features.simulation)} · kontrollpunkt ${yes(r.controlPoint)}`)
    if (r.powerRange) lines.push(`Effektområde: ${r.powerRange.min}–${r.powerRange.max} W (steg ${r.powerRange.increment} W)`)
  }
  lines.push('', `Målt: ${value(r.measured.power, 'W')} · ${value(r.measured.cadence, 'rpm')} · ${value(r.measured.speed, 'km/t', 1)} · ${value(r.measured.heartRate, 'bpm')}`)
  if (r.ergTest) {
    const state = r.ergTest.state === 'passed' ? 'bestått' : r.ergTest.state === 'failed' ? 'feilet' : 'avbrutt'
    const steps = r.ergTest.steps.map(step => `${step.target} W ${step.accepted ? 'godtatt' : 'ikke godtatt'}${step.measured !== undefined ? ` (målt ${Math.round(step.measured)} W)` : ''}`)
    lines.push(`ERG-test: ${state}${steps.length ? ` · ${steps.join(' · ')}` : ''}${r.ergTest.error ? ` · ${r.ergTest.error}` : ''}`)
  } else if (controlSupported(r)) lines.push('ERG-test: ikke kjørt')
  if (r.log?.length) lines.push(`Kommandoer: ${r.log.map(entry => `${entry.label}: ${entry.result}`).join('; ')}`)
  return lines.join('\n')
}
