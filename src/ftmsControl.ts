/**
 * FTMS 1.0 Fitness Machine Control Point (0x2AD9).
 *
 * Pure encoders/decoders plus a small controller that owns the control point:
 * one outstanding command at a time, response indications with timeouts, and a
 * declarative "desired state" so the app only says what it wants (ERG at 245 W,
 * paused, released) and the controller writes the minimum command sequence.
 * Nothing is written unless the desired state actually changes.
 */

export const FTMS = {
  service: 0x1826,
  feature: 0x2acc,
  indoorBikeData: 0x2ad2,
  supportedPowerRange: 0x2ad8,
  controlPoint: 0x2ad9,
  machineStatus: 0x2ada,
} as const

export const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  response: 0x80,
} as const

export const RESULT = { success: 0x01, notSupported: 0x02, invalidParameter: 0x03, failed: 0x04, notPermitted: 0x05 } as const

/** App-level ceiling, independent of what a trainer claims to support. */
export const ERG_MAX_WATTS = 1500
/** Used only when a trainer offers power control without Supported Power Range. */
export const ERG_FALLBACK_MAX_WATTS = 800
export const CONTROL_TIMEOUT_MS = 3000

export interface FtmsFeatures {
  cadence: boolean
  heartRate: boolean
  powerMeasurement: boolean
  resistanceTarget: boolean
  powerTarget: boolean
  simulation: boolean
  machine: number
  target: number
}

/** FTMS §4.3: two little-endian uint32 bit fields (machine features, target setting features). */
export function parseFitnessMachineFeature(view: DataView): FtmsFeatures | undefined {
  if (view.byteLength < 8) return
  const machine = view.getUint32(0, true)
  const target = view.getUint32(4, true)
  return {
    cadence: !!(machine & (1 << 1)),
    heartRate: !!(machine & (1 << 10)),
    powerMeasurement: !!(machine & (1 << 14)),
    resistanceTarget: !!(target & (1 << 2)),
    powerTarget: !!(target & (1 << 3)),
    simulation: !!(target & (1 << 13)),
    machine,
    target,
  }
}

export interface PowerRange { min: number; max: number; increment: number }

/** FTMS §4.14: sint16 minimum, sint16 maximum, uint16 increment (all watts). */
export function parseSupportedPowerRange(view: DataView): PowerRange | undefined {
  if (view.byteLength < 6) return
  const min = view.getInt16(0, true)
  const max = view.getInt16(2, true)
  const increment = view.getUint16(4, true)
  if (max <= 0 || max < min) return
  return { min, max, increment: increment || 1 }
}

const int16 = (value: number) => {
  const v = Math.max(-32768, Math.min(32767, Math.round(value)))
  return [v & 255, (v >> 8) & 255]
}
const uint8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export const encodeRequestControl = () => Uint8Array.of(OP.requestControl)
export const encodeReset = () => Uint8Array.of(OP.reset)
export const encodeStartOrResume = () => Uint8Array.of(OP.startOrResume)
export const encodeStopOrPause = (kind: 'stop' | 'pause') => Uint8Array.of(OP.stopOrPause, kind === 'stop' ? 0x01 : 0x02)
/** Target power is sint16 watts, resolution 1 W. */
export const encodeSetTargetPower = (watts: number) => Uint8Array.of(OP.setTargetPower, ...int16(watts))

export interface SimulationParameters {
  /** m/s, resolution 0.001 */
  windSpeed: number
  /** percent, resolution 0.01 */
  grade: number
  /** rolling resistance coefficient, resolution 0.0001 */
  crr: number
  /** wind resistance coefficient kg/m, resolution 0.01 */
  cw: number
}
export const DEFAULT_SIMULATION: SimulationParameters = { windSpeed: 0, grade: 0, crr: 0.004, cw: 0.51 }
/** Conservative simulation bounds: the encoder can express ±327 %, a rider should never meet that. */
export const SIM_GRADE_LIMITS = { min: -15, max: 20 } as const

export function encodeIndoorBikeSimulation(p: SimulationParameters) {
  return Uint8Array.of(OP.setIndoorBikeSimulation,
    ...int16(p.windSpeed * 1000), ...int16(p.grade * 100), uint8(p.crr * 10000), uint8(p.cw * 100))
}

export interface ControlPointResponse { requestOpCode: number; result: number }
/** Response Code (0x80), Request Op Code, Result Code; optional parameters are ignored. */
export function parseControlPointResponse(view: DataView): ControlPointResponse | undefined {
  if (view.byteLength < 3 || view.getUint8(0) !== OP.response) return
  return { requestOpCode: view.getUint8(1), result: view.getUint8(2) }
}

/** Machine Status 0xFF = control permission lost, 0x01 = reset: both mean we no longer control the trainer. */
export function machineStatusLosesControl(view: DataView): boolean {
  if (view.byteLength < 1) return false
  const code = view.getUint8(0)
  return code === 0xff || code === 0x01
}

export function resultLabel(result: number | 'timeout' | 'error'): string {
  switch (result) {
    case RESULT.success: return 'OK'
    case RESULT.notSupported: return 'ikke støttet'
    case RESULT.invalidParameter: return 'ugyldig verdi'
    case RESULT.failed: return 'mislyktes'
    case RESULT.notPermitted: return 'ikke tillatt'
    case 'timeout': return 'svarte ikke'
    case 'error': return 'skrivefeil'
    default: return `kode ${result}`
  }
}

export function opLabel(bytes: Uint8Array): string {
  switch (bytes[0]) {
    case OP.requestControl: return 'Be om kontroll'
    case OP.reset: return 'Tilbakestill'
    case OP.startOrResume: return 'Start'
    case OP.stopOrPause: return bytes[1] === 0x02 ? 'Pause' : 'Stopp'
    case OP.setTargetPower: return `Wattmål ${new DataView(bytes.buffer, bytes.byteOffset).getInt16(1, true)} W`
    case OP.setIndoorBikeSimulation: return `Simulering ${(new DataView(bytes.buffer, bytes.byteOffset).getInt16(3, true) / 100).toFixed(1)} %`
    default: return `Kommando 0x${bytes[0].toString(16)}`
  }
}

/**
 * Clamp to the trainer's Supported Power Range and the app ceiling, snapped to the
 * trainer's increment. Non-finite input never produces a target.
 */
export function clampTargetPower(watts: number, range?: PowerRange): number | undefined {
  if (!Number.isFinite(watts)) return
  const min = Math.max(0, range?.min ?? 0)
  const max = Math.min(ERG_MAX_WATTS, range?.max ?? ERG_FALLBACK_MAX_WATTS)
  if (max < min) return
  const increment = range && range.increment > 0 ? range.increment : 1
  const bounded = Math.min(max, Math.max(min, watts))
  let snapped = min + Math.round((bounded - min) / increment) * increment
  if (snapped > max) snapped -= increment
  return Math.max(min, Math.round(snapped))
}

export interface FtmsTransport { write(data: Uint8Array): Promise<void> }
export interface FtmsInfo {
  deviceId: string
  deviceName: string
  features?: FtmsFeatures
  powerRange?: PowerRange
}
export type ErgDesired =
  | { mode: 'released'; stop?: boolean }
  | { mode: 'paused' }
  | { mode: 'erg'; watts: number }
  | { mode: 'sim'; params: SimulationParameters }
export type FtmsStatus = 'off' | 'pending' | 'on' | 'error'
export interface FtmsLogEntry { label: string; result: string }
export interface FtmsSnapshot {
  info: FtmsInfo | null
  supportsErg: boolean
  supportsSimulation: boolean
  status: FtmsStatus
  hasControl: boolean
  targetWatts?: number
  error?: string
  log: FtmsLogEntry[]
}

type Outcome = number | 'timeout' | 'error'
interface Step { bytes: Uint8Array; apply(result: Outcome): void }

const desiredKey = (d: ErgDesired) => JSON.stringify(d)

/**
 * Owns one trainer's control point. A transport is attached while a GATT
 * connection with a working control point exists. Detaching (disconnect) clears
 * control and resets the desired state to released, so ERG never resumes on
 * its own after a reconnect: the app must ask again (when the rider resumes).
 */
export class FtmsControl {
  private transport?: FtmsTransport
  private info: FtmsInfo | null = null
  private desired: ErgDesired = { mode: 'released' }
  private hasControl = false
  private started = false
  /** Paused by us: a later ride end still sends Stop so the machine's own session ends cleanly. */
  private paused = false
  private appliedWatts?: number
  private appliedSim?: string
  private pending?: { opCode: number; finish(result: Outcome): void }
  private pumping = false
  private failedKey?: string
  private retriedKey?: string
  /** Desired state a command in flight was sent for; its failure must not block a newer request. */
  private stepKey?: string
  private error?: string
  private log: FtmsLogEntry[] = []
  private listeners = new Set<() => void>()
  private snapshot: FtmsSnapshot

  constructor(private timeoutMs = CONTROL_TIMEOUT_MS) {
    this.snapshot = this.build()
  }

  attach(transport: FtmsTransport, info: FtmsInfo) {
    this.detach()
    this.transport = transport
    this.info = info
    this.emit()
  }

  detach() {
    const pending = this.pending
    this.pending = undefined
    pending?.finish('error')
    this.transport = undefined
    this.info = null
    this.desired = { mode: 'released' }
    this.hasControl = false
    this.started = false
    this.paused = false
    this.appliedWatts = undefined
    this.appliedSim = undefined
    this.failedKey = undefined
    this.retriedKey = undefined
    this.error = undefined
    this.emit()
  }

  setDesired(next: ErgDesired) {
    if (desiredKey(next) === desiredKey(this.desired)) return
    this.desired = next
    this.failedKey = undefined
    this.retriedKey = undefined
    this.error = undefined
    this.emit()
    void this.pump()
  }

  handleIndication(view: DataView) {
    const response = parseControlPointResponse(view)
    if (!response || !this.pending || response.requestOpCode !== this.pending.opCode) return
    this.pending.finish(response.result)
  }

  handleMachineStatus(view: DataView) {
    if (!machineStatusLosesControl(view) || !this.hasControl) return
    this.hasControl = false
    this.started = false
    this.paused = false
    this.appliedWatts = undefined
    this.appliedSim = undefined
    this.emit()
    void this.pump()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  private supportsErg() { return !!this.info?.features?.powerTarget }
  private supportsSimulation() { return !!this.info?.features?.simulation }

  private build(): FtmsSnapshot {
    const d = this.desired
    const wanted = d.mode === 'erg' ? clampTargetPower(d.watts, this.info?.powerRange) : undefined
    const failed = this.failedKey !== undefined && this.failedKey === desiredKey(d)
    const status: FtmsStatus = failed ? 'error'
      : d.mode === 'erg' ? (this.hasControl && this.started && wanted !== undefined && this.appliedWatts === wanted ? 'on' : 'pending')
      : d.mode === 'sim' ? (this.appliedSim === JSON.stringify(d.params) ? 'on' : 'pending')
      : 'off'
    return {
      info: this.info,
      supportsErg: !!this.transport && this.supportsErg(),
      supportsSimulation: !!this.transport && this.supportsSimulation(),
      status,
      hasControl: this.hasControl,
      ...(wanted !== undefined ? { targetWatts: wanted } : {}),
      ...(failed && this.error ? { error: this.error } : {}),
      log: this.log,
    }
  }

  private emit() {
    this.snapshot = this.build()
    for (const listener of this.listeners) listener()
  }

  private fail(message: string) {
    const key = desiredKey(this.desired)
    if (this.stepKey !== undefined && this.stepKey !== key) return
    this.failedKey = key
    this.error = message
  }

  /** "Control not permitted" usually means the trainer reset or another app took over: re-request once. */
  private lostPermission(result: Outcome): boolean {
    if (result !== RESULT.notPermitted) return false
    const key = desiredKey(this.desired)
    if (this.retriedKey === key) return false
    this.retriedKey = key
    this.hasControl = false
    this.started = false
    return true
  }

  private nextStep(): Step | undefined {
    const d = this.desired
    if (!this.transport || this.failedKey === desiredKey(d)) return
    if (d.mode === 'released') {
      if (!this.hasControl) return
      if (d.stop && (this.started || this.paused)) return { bytes: encodeStopOrPause('stop'), apply: () => { this.started = false; this.paused = false } }
      return { bytes: encodeReset(), apply: () => {
        // Whatever the answer, never assume we still hold the trainer after asking to let go.
        this.hasControl = false; this.started = false; this.paused = false; this.appliedWatts = undefined; this.appliedSim = undefined
      } }
    }
    if (d.mode === 'paused') {
      if (!this.hasControl || !this.started) return
      return { bytes: encodeStopOrPause('pause'), apply: () => { this.started = false; this.paused = true; this.appliedWatts = undefined; this.appliedSim = undefined } }
    }
    if (d.mode === 'erg' && !this.supportsErg()) { this.fail('Sykkelen støtter ikke wattstyring (ERG).'); return }
    if (d.mode === 'sim' && !this.supportsSimulation()) { this.fail('Sykkelen støtter ikke simulering av stigning.'); return }
    if (!this.hasControl) return { bytes: encodeRequestControl(), apply: result => {
      if (result === RESULT.success) this.hasControl = true
      else this.fail(result === RESULT.notPermitted
        ? 'Sykkelen ga ikke kontroll. Lukk andre treningsapper som styrer motstanden.'
        : `Sykkelen svarte ikke på forespørsel om kontroll (${resultLabel(result)}).`)
    } }
    if (!this.started) return { bytes: encodeStartOrResume(), apply: result => {
      // Many trainers do not implement Start/Resume and still accept targets.
      if (!this.lostPermission(result)) { this.started = true; this.paused = false }
    } }
    if (d.mode === 'erg') {
      const watts = clampTargetPower(d.watts, this.info?.powerRange)
      if (watts === undefined || watts === this.appliedWatts) return
      return { bytes: encodeSetTargetPower(watts), apply: result => {
        if (result === RESULT.success) { this.appliedWatts = watts; this.appliedSim = undefined }
        else if (!this.lostPermission(result)) this.fail(`Wattmålet ble ikke satt (${resultLabel(result)}).`)
      } }
    }
    const params = {
      ...d.params,
      grade: Math.min(SIM_GRADE_LIMITS.max, Math.max(SIM_GRADE_LIMITS.min, Number.isFinite(d.params.grade) ? d.params.grade : 0)),
    }
    const key = JSON.stringify(d.params)
    if (this.appliedSim === key) return
    return { bytes: encodeIndoorBikeSimulation(params), apply: result => {
      if (result === RESULT.success) { this.appliedSim = key; this.appliedWatts = undefined }
      else if (!this.lostPermission(result)) this.fail(`Stigningen ble ikke satt (${resultLabel(result)}).`)
    } }
  }

  private send(bytes: Uint8Array): Promise<Outcome> {
    const transport = this.transport!
    return new Promise(resolve => {
      let done = false
      const finish = (result: Outcome) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (this.pending?.finish === finish) this.pending = undefined
        this.log = [...this.log.slice(-19), { label: opLabel(bytes), result: resultLabel(result) }]
        resolve(result)
      }
      const timer = setTimeout(() => finish('timeout'), this.timeoutMs)
      // Register before writing: a fast trainer can indicate before write() resolves.
      this.pending = { opCode: bytes[0], finish }
      transport.write(bytes).catch(() => finish('error'))
    })
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      // Every step either advances towards the desired state or marks it failed; the
      // bound only protects against a misbehaving trainer flipping control rapidly.
      for (let guard = 0; guard < 32; guard++) {
        const step = this.nextStep()
        if (!step) break
        const transport = this.transport
        this.stepKey = desiredKey(this.desired)
        this.emit()
        const result = await this.send(step.bytes)
        if (transport !== this.transport) break
        step.apply(result)
        this.stepKey = undefined
        this.emit()
      }
    } finally {
      this.pumping = false
      this.stepKey = undefined
      this.emit()
    }
  }
}
