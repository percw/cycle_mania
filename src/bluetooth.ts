import { FTMS, FtmsControl, parseFitnessMachineFeature, parseSupportedPowerRange, type FtmsFeatures, type PowerRange } from './ftmsControl'

/** Standard Bluetooth fitness telemetry. Speed is km/h, cadence rpm. */
export interface BikeTelemetry {
  power?: number
  cadence?: number
  speed?: number
  heartRate?: number
}

const FTMS_SERVICE = 0x1826
const INDOOR_BIKE_DATA = 0x2ad2
const POWER_SERVICE = 0x1818
const POWER_MEASUREMENT = 0x2a63
const HEART_RATE_SERVICE = 0x180d
const HEART_RATE_MEASUREMENT = 0x2a37
const CSC_SERVICE = 0x1816
const CSC_MEASUREMENT = 0x2a5b

/** Bluetooth HRS §3.1.1: uint8/uint16 bpm and optional skin-contact status. */
export function parseHeartRate(view: DataView): number | undefined {
  if (view.byteLength < 2) return
  const flags = view.getUint8(0)
  // Bit 2 means contact detection is supported; bit 1 then means contact found.
  if ((flags & 4) && !(flags & 2)) return
  const is16Bit = !!(flags & 1)
  if (is16Bit && view.byteLength < 3) return
  return is16Bit ? view.getUint16(1, true) : view.getUint8(1)
}

/** FTMS 1.0.1 §4.9: flags determine every optional field's position. */
export function parseIndoorBikeData(view: DataView): BikeTelemetry {
  const data: BikeTelemetry = {}
  if (view.byteLength < 2) return data
  const flags = view.getUint16(0, true)
  let offset = 2
  const fields: Array<{ present: boolean; bytes: number; key?: keyof BikeTelemetry; scale?: number; signed?: boolean }> = [
    { present: !(flags & 1), bytes: 2, key: 'speed', scale: 0.01 },
    { present: !!(flags & 2), bytes: 2 }, // Average speed
    { present: !!(flags & 4), bytes: 2, key: 'cadence', scale: 0.5 },
    { present: !!(flags & 8), bytes: 2 }, // Average cadence
    { present: !!(flags & 16), bytes: 3 }, // Total distance
    { present: !!(flags & 32), bytes: 2 }, // Resistance level
    { present: !!(flags & 64), bytes: 2, key: 'power', signed: true },
    { present: !!(flags & 128), bytes: 2 }, // Average power
    { present: !!(flags & 256), bytes: 5 }, // Total / hourly / minute energy
    { present: !!(flags & 512), bytes: 1, key: 'heartRate' },
    { present: !!(flags & 1024), bytes: 1 }, // MET
    { present: !!(flags & 2048), bytes: 2 }, // Elapsed time
    { present: !!(flags & 4096), bytes: 2 }, // Remaining time
  ]
  for (const field of fields) {
    if (!field.present) continue
    // Keep valid earlier fields, never reinterpret a truncated field as a later one.
    if (offset + field.bytes > view.byteLength) break
    if (field.key) {
      const value = field.bytes === 1 ? view.getUint8(offset)
        : field.signed ? view.getInt16(offset, true) : view.getUint16(offset, true)
      data[field.key] = value * (field.scale ?? 1)
    }
    offset += field.bytes
  }
  return data
}

/** Cycling Power Measurement always carries signed instantaneous watts. */
export function parseCyclingPower(view: DataView): BikeTelemetry {
  return view.byteLength < 4 ? {} : { power: view.getInt16(2, true) }
}

/** Cumulative revolution counter with its last event time (1/1024 s unless noted). */
export interface RevolutionSample { revolutions: number; eventTime: number }

/** Cycling Power §3.2: crank data (flags bit 5) follows the optional balance, torque and wheel fields. */
export function parseCrankSample(view: DataView): RevolutionSample | undefined {
  if (view.byteLength < 4) return
  const flags = view.getUint16(0, true)
  if (!(flags & 0x20)) return
  let offset = 4
  if (flags & 1) offset += 1 // Pedal power balance
  if (flags & 4) offset += 2 // Accumulated torque
  if (flags & 16) offset += 6 // Wheel revolutions and wheel event time
  if (offset + 4 > view.byteLength) return
  return { revolutions: view.getUint16(offset, true), eventTime: view.getUint16(offset + 2, true) }
}

/** CSC Measurement: wheel (uint32 revs, uint16 1/1024 s) and crank (uint16 revs, uint16 1/1024 s). */
export function parseCscMeasurement(view: DataView): { wheel?: RevolutionSample; crank?: RevolutionSample } {
  if (view.byteLength < 1) return {}
  const flags = view.getUint8(0)
  const result: { wheel?: RevolutionSample; crank?: RevolutionSample } = {}
  let offset = 1
  if (flags & 1) {
    if (offset + 6 > view.byteLength) return result
    result.wheel = { revolutions: view.getUint32(offset, true), eventTime: view.getUint16(offset + 4, true) }
    offset += 6
  }
  if (flags & 2) {
    if (offset + 4 > view.byteLength) return result
    result.crank = { revolutions: view.getUint16(offset, true), eventTime: view.getUint16(offset + 2, true) }
  }
  return result
}

/** rpm between two cumulative crank samples; uint16 counters roll over. Undefined without a new event. */
export function crankCadence(previous: RevolutionSample, next: RevolutionSample): number | undefined {
  const revolutions = (next.revolutions - previous.revolutions + 65536) % 65536
  const ticks = (next.eventTime - previous.eventTime + 65536) % 65536
  if (!ticks || !revolutions) return
  return revolutions * 60 * 1024 / ticks
}

/** km/h between two cumulative wheel samples; uint32 revolutions and uint16 event time roll over. */
export function wheelSpeed(previous: RevolutionSample, next: RevolutionSample, circumference = DEFAULT_WHEEL_CIRCUMFERENCE): number | undefined {
  const revolutions = (next.revolutions - previous.revolutions + 2 ** 32) % 2 ** 32
  const ticks = (next.eventTime - previous.eventTime + 65536) % 65536
  if (!ticks || !revolutions) return
  return revolutions * circumference / (ticks / 1024) * 3.6
}
/** 700×25C road wheel, metres. */
export const DEFAULT_WHEEL_CIRCUMFERENCE = 2.105

/**
 * Turns cumulative revolution samples into a rate. Repeated identical samples keep
 * the last rate briefly, then report 0 after 3 s without a new event (rider stopped).
 * Implausible jumps (sensor reset, packet loss over many rollovers) are dropped.
 */
export class RevolutionRate {
  private previous?: RevolutionSample
  private last?: number
  private changedAt = 0
  constructor(private rate: (previous: RevolutionSample, next: RevolutionSample) => number | undefined, private max: number) {}
  update(next: RevolutionSample, now: number): number | undefined {
    let result: number | undefined
    if (this.previous) {
      const rate = this.rate(this.previous, next)
      const unchanged = next.revolutions === this.previous.revolutions && next.eventTime === this.previous.eventTime
      if (rate !== undefined) {
        if (rate <= this.max) { this.last = rate; result = rate }
        this.changedAt = now
      } else if (unchanged) {
        result = now - this.changedAt >= 3000 ? 0 : this.last
      }
    } else this.changedAt = now
    this.previous = next
    return result
  }
  reset() { this.previous = undefined; this.last = undefined }
}
export const cadenceTracker = () => new RevolutionRate(crankCadence, 250)
export const speedTracker = (circumference = DEFAULT_WHEEL_CIRCUMFERENCE) =>
  new RevolutionRate((a, b) => wheelSpeed(a, b, circumference), 120)

// getDevices is optional: browser support for persisted permissions varies.
export type BleUuid = number | string
export interface BleCharacteristic extends EventTarget {
  uuid?: string
  value?: DataView
  properties?: { read?: boolean; write?: boolean; writeWithoutResponse?: boolean; notify?: boolean; indicate?: boolean }
  startNotifications(): Promise<BleCharacteristic>
  readValue?(): Promise<DataView>
  writeValue?(value: BufferSource): Promise<void>
  writeValueWithResponse?(value: BufferSource): Promise<void>
}
export interface BleService {
  uuid?: string
  getCharacteristic(uuid: BleUuid): Promise<BleCharacteristic>
  getCharacteristics?(): Promise<BleCharacteristic[]>
}
export interface BleServer {
  connected: boolean
  connect(): Promise<BleServer>
  disconnect(): void
  getPrimaryService(uuid: BleUuid): Promise<BleService>
  getPrimaryServices?(): Promise<BleService[]>
}
export interface BleDevice extends EventTarget { id?: string; name?: string; gatt?: BleServer }
export interface BleNavigator {
  getDevices?(): Promise<BleDevice[]>
  requestDevice(options: {
    filters?: Array<{ services?: number[]; namePrefix?: string }>
    acceptAllDevices?: boolean
    optionalServices: BleUuid[]
  }): Promise<BleDevice>
}
export function bluetooth(): BleNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined
    : (navigator as Navigator & { bluetooth?: BleNavigator }).bluetooth
}
export function bluetoothAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!bluetooth()
}
const BIKE_KEY = 'summit-ble-bike'
const HEART_KEY = 'summit-ble-heart-rate'
const CSC_KEY = 'summit-ble-cadence'
interface RememberedDevice { id: string; name: string }
function remembered(key: string): RememberedDevice | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof value?.id === 'string' && value.id && typeof value.name === 'string') return value
  } catch { /* Private browsing / disabled storage must not prevent BLE use. */ }
}
function remember(key: string, device: BleDevice, fallback: string) {
  if (!device.id) return
  try { localStorage.setItem(key, JSON.stringify({ id: device.id, name: device.name ?? fallback })) } catch { /* Optional persistence. */ }
}
function forget(key: string) { try { localStorage.removeItem(key) } catch { /* Optional persistence. */ } }
export function hasRememberedBike(): boolean { return !!remembered(BIKE_KEY) }
export function rememberedBikeName(): string { return remembered(BIKE_KEY)?.name ?? '' }
export function forgetRememberedBike(): void { forget(BIKE_KEY) }
export function hasRememberedHeartRate(): boolean { return !!remembered(HEART_KEY) }
export function rememberedHeartRateName(): string { return remembered(HEART_KEY)?.name ?? '' }
export function forgetRememberedHeartRate(): void { forget(HEART_KEY) }
export function hasRememberedCadence(): boolean { return !!remembered(CSC_KEY) }

/** iPhone/iPad (including iPadOS reporting as Mac): no WebKit browser has Web Bluetooth. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent ?? '')
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
}
export function unsupportedBluetoothMessage(): string {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    return 'Bluetooth krever HTTPS eller localhost. Åpne appen på en sikker adresse.'
  return isAppleMobile()
    ? 'Safari og andre nettlesere på iPhone/iPad støtter ikke Web Bluetooth. Åpne SUMMIT i Bluefy-nettleseren (gratis i App Store).'
    : 'Nettleseren støtter ikke Web Bluetooth. Bruk Chrome eller Edge på PC/Mac, eller Chrome på Android.'
}

interface ConnectionCallbacks {
  onStatus: (status: 'connecting' | 'connected' | 'disconnected', name?: string) => void
  onError: (message: string) => void
}
interface BikeCallbacks extends ConnectionCallbacks { onData: (data: BikeTelemetry) => void }
interface HeartRateCallbacks extends ConnectionCallbacks { onData: (heartRate: number) => void }
interface Protocol { service: number; characteristic: number }
const RETRY_DELAYS = [2000, 5000, 10000]

/** Read-only subscriptions, saved authorization and bounded reconnect shared by both sensors. */
abstract class SensorConnection {
  private device?: BleDevice
  private characteristic?: BleCharacteristic
  private generation = 0
  private subscribed = false
  private retryTimer?: ReturnType<typeof setTimeout>
  protected protocol = 0

  constructor(
    protected callbacks: ConnectionCallbacks,
    private key: string,
    private fallbackName: string,
    private protocols: Protocol[],
    private filters: Array<{ services?: number[]; namePrefix?: string }>,
    private extraServices: number[] = [],
  ) {}

  protected abstract receive(view: DataView): void
  protected reset(): void {}
  /** Optional extra GATT work after the main subscription is live. Must never throw. */
  protected async afterSubscribe(_server: BleServer, _device: BleDevice, _current: () => boolean): Promise<void> {}
  protected unavailable(): string {
    return 'Kunne ikke lese puls. Sensoren må støtte Bluetooth Heart Rate. ANT+-sensorer kobles til via ANT-broen.'
  }
  protected get primary(): BleCharacteristic | undefined { return this.characteristic }
  private onNotification = (event: Event) => {
    const value = (event.target as BleCharacteristic | null)?.value
    if (value) this.receive(value)
  }
  private onDisconnected = () => {
    const device = this.device
    const generation = ++this.generation
    this.release()
    this.callbacks.onStatus('disconnected', device?.name)
    if (device) this.scheduleRetry(device, generation, 0)
  }
  private scheduleRetry(device: BleDevice, generation: number, attempt: number) {
    if (generation !== this.generation || attempt >= RETRY_DELAYS.length) return
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = undefined
      if (generation !== this.generation) return
      this.callbacks.onStatus('connecting', device.name)
      try { await this.subscribe(device, generation) }
      catch {
        if (generation !== this.generation) return
        this.release()
        this.callbacks.onStatus('disconnected', device.name)
        this.scheduleRetry(device, generation, attempt + 1)
      }
    }, RETRY_DELAYS[attempt])
  }
  private release() {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.onNotification)
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    if (this.device?.gatt?.connected) this.device.gatt.disconnect()
    this.device = undefined
    this.characteristic = undefined
    this.subscribed = false
    this.reset()
  }
  private begin(): number {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const generation = ++this.generation
    this.release()
    return generation
  }
  private async authorizedDevice(): Promise<BleDevice | undefined> {
    const saved = remembered(this.key)
    const ble = bluetooth()
    if (!saved || !bluetoothAvailable() || !ble?.getDevices) return
    try { return (await ble.getDevices()).find(device => device.id === saved.id) }
    catch { return }
  }
  /** Never opens a chooser or reports errors; false means manual connection is needed. */
  async connectRemembered(): Promise<boolean> {
    if (this.device?.gatt?.connected && this.subscribed) return true
    const generation = this.begin()
    const device = await this.authorizedDevice()
    if (!device || generation !== this.generation) return false
    this.callbacks.onStatus('connecting', device.name)
    try { return await this.subscribe(device, generation) }
    catch {
      if (generation === this.generation) {
        this.release()
        this.callbacks.onStatus('disconnected', device.name)
      }
      return false
    }
  }
  /** Invoke from a click. Existing browser authorization avoids the chooser when possible. */
  async connect(): Promise<void> {
    if (this.device?.gatt?.connected && this.subscribed) return
    const generation = this.begin()
    const ble = bluetooth()
    if (!bluetoothAvailable() || !ble) {
      this.callbacks.onStatus('disconnected')
      this.callbacks.onError(unsupportedBluetoothMessage())
      return
    }
    this.callbacks.onStatus('connecting')
    try {
      // Avoid any await before the first chooser for a new device: it needs a user gesture.
      let device: BleDevice | undefined
      if (remembered(this.key) && ble.getDevices) device = await this.authorizedDevice()
      if (generation !== this.generation) return
      device ??= await ble.requestDevice({ filters: this.filters, optionalServices: [...this.protocols.map(p => p.service), ...this.extraServices] })
      if (generation !== this.generation) return
      await this.subscribe(device, generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.release()
      this.callbacks.onStatus('disconnected')
      const name = error instanceof Error ? error.name : ''
      this.callbacks.onError(name === 'NotFoundError'
        ? 'Ingen enhet ble valgt. Slå på sensoren og prøv igjen.'
        : name === 'NetworkError'
          ? 'Kunne ikke koble til. Slå på Bluetooth, hold sensoren i nærheten og lukk andre treningsapper.'
          : name === 'SecurityError' || name === 'NotAllowedError'
            ? 'Bluetooth-tilgang ble blokkert. Tillat Bluetooth for denne siden i nettleseren og trykk koble til igjen.'
            : error instanceof Error ? error.message : 'Bluetooth-tilkoblingen mislyktes. Prøv igjen.')
    }
  }
  private async subscribe(device: BleDevice, generation: number): Promise<boolean> {
    if (!device.gatt) throw new Error('Enheten tilbyr ingen Bluetooth GATT-forbindelse.')
    this.device = device
    const server = await device.gatt.connect()
    if (generation !== this.generation) {
      // A cancelled connect may finish after cleanup; do not disturb a newer attempt on the same device.
      if (this.device !== device) server.disconnect()
      return false
    }
    for (let index = 0; index < this.protocols.length; index++) {
      let characteristic: BleCharacteristic | undefined
      try {
        const protocol = this.protocols[index]
        const service = await server.getPrimaryService(protocol.service)
        if (generation !== this.generation) return false
        characteristic = await service.getCharacteristic(protocol.characteristic)
        if (generation !== this.generation) return false
        this.protocol = index
        this.characteristic = characteristic
        characteristic.addEventListener('characteristicvaluechanged', this.onNotification)
        await characteristic.startNotifications()
        if (generation !== this.generation) return false
        if (!server.connected) throw new Error('Sensoren koblet fra under tilkobling.')
        this.subscribed = true
        device.addEventListener('gattserverdisconnected', this.onDisconnected)
        remember(this.key, device, this.fallbackName)
        this.callbacks.onStatus('connected', device.name ?? this.fallbackName)
        try { await this.afterSubscribe(server, device, () => generation === this.generation && server.connected) }
        catch { /* Extras (control point, secondary cadence) are optional. */ }
        return true
      } catch {
        characteristic?.removeEventListener('characteristicvaluechanged', this.onNotification)
        if (generation !== this.generation) return false
        this.characteristic = undefined
      }
    }
    throw new Error(this.unavailable())
  }
  /** Cancels in-flight work and reconnect timers; keeps browser permission for the next ride. */
  disconnect(): void {
    const name = this.device?.name
    this.begin()
    this.callbacks.onStatus('disconnected', name)
  }
}

async function readCharacteristic<T>(service: BleService, uuid: BleUuid, parse: (view: DataView) => T | undefined): Promise<T | undefined> {
  try {
    const characteristic = await service.getCharacteristic(uuid)
    if (!characteristic.readValue) return
    return parse(await characteristic.readValue())
  } catch { return }
}

export interface FtmsSetup {
  features?: FtmsFeatures
  powerRange?: PowerRange
  /** True when a control point with indications is attached to the FtmsControl. */
  control: boolean
  cleanup: () => void
}

/**
 * Reads Fitness Machine Feature / Supported Power Range and, when the trainer
 * offers power or simulation targets, attaches its control point (with
 * indications and optional Machine Status) to `control`. Never throws for
 * missing optional characteristics; nothing is written here.
 */
export async function setupFtms(server: BleServer, device: BleDevice, control: FtmsControl, current: () => boolean): Promise<FtmsSetup> {
  const cleanups: Array<() => void> = []
  const result: FtmsSetup = { control: false, cleanup: () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() } }
  const service = await server.getPrimaryService(FTMS.service)
  result.features = await readCharacteristic(service, FTMS.feature, parseFitnessMachineFeature)
  if (!current() || !result.features || (!result.features.powerTarget && !result.features.simulation)) return result
  if (result.features.powerTarget) result.powerRange = await readCharacteristic(service, FTMS.supportedPowerRange, parseSupportedPowerRange)
  if (!current()) return result
  let point: BleCharacteristic
  try { point = await service.getCharacteristic(FTMS.controlPoint) } catch { return result }
  const write = point.writeValueWithResponse ?? point.writeValue
  if (!write || !current()) return result
  const onIndication = (event: Event) => {
    const value = (event.target as BleCharacteristic | null)?.value
    if (value) control.handleIndication(value)
  }
  point.addEventListener('characteristicvaluechanged', onIndication)
  cleanups.push(() => point.removeEventListener('characteristicvaluechanged', onIndication))
  try { await point.startNotifications() } catch { result.cleanup(); return result }
  if (!current()) { result.cleanup(); return result }
  try {
    const status = await service.getCharacteristic(FTMS.machineStatus)
    if (status !== point) {
      const onStatus = (event: Event) => {
        const value = (event.target as BleCharacteristic | null)?.value
        if (value) control.handleMachineStatus(value)
      }
      status.addEventListener('characteristicvaluechanged', onStatus)
      cleanups.push(() => status.removeEventListener('characteristicvaluechanged', onStatus))
      await status.startNotifications()
    }
  } catch { /* Machine Status is optional. */ }
  if (!current()) { result.cleanup(); return result }
  control.attach({ write: data => write.call(point, data as unknown as BufferSource) }, {
    deviceId: device.id ?? '', deviceName: device.name ?? '',
    features: result.features, ...(result.powerRange ? { powerRange: result.powerRange } : {}),
  })
  cleanups.push(() => control.detach())
  result.control = true
  return result
}

/**
 * Bike/trainer telemetry. Writes only through `ftms` (the FTMS control point) and
 * only when the app explicitly asks for automatic resistance; otherwise read-only.
 */
export class BikeConnection extends SensorConnection {
  private cadence = cadenceTracker()
  private primaryCadenceAt = -Infinity
  private cleanups: Array<() => void> = []
  constructor(private bikeCallbacks: BikeCallbacks, readonly ftms: FtmsControl = new FtmsControl()) {
    super(bikeCallbacks, BIKE_KEY, 'Xebex-sykkel', [
      { service: FTMS_SERVICE, characteristic: INDOOR_BIKE_DATA },
      { service: POWER_SERVICE, characteristic: POWER_MEASUREMENT },
    ], [{ services: [FTMS_SERVICE] }, { services: [POWER_SERVICE] },
      { namePrefix: 'XEBEX' }, { namePrefix: 'Xebex' }, { namePrefix: 'xebex' }], [CSC_SERVICE])
  }
  protected reset() {
    this.cadence.reset()
    this.primaryCadenceAt = -Infinity
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
    this.ftms.detach()
  }
  protected unavailable() {
    return 'Fant ingen tilgjengelige sykkeldata. Sykkelen må tilby FTMS eller Cycling Power over BLE. Lukk andre treningsapper og prøv igjen.'
  }
  protected async afterSubscribe(server: BleServer, device: BleDevice, current: () => boolean) {
    if (this.protocol === 0) {
      const setup = await setupFtms(server, device, this.ftms, current).catch(() => undefined)
      if (setup) this.cleanups.push(setup.cleanup)
      // FTMS bikes without cadence often expose crank data through Cycling Power or CSC.
      if (current() && setup?.features && !setup.features.cadence) await this.addCadenceSource(server, current, 'power')
      if (current() && setup?.features && !setup.features.cadence) await this.addCadenceSource(server, current, 'csc')
    } else if (current()) await this.addCadenceSource(server, current, 'csc')
  }
  /** Secondary cadence fills in only while the primary characteristic has no fresh cadence. */
  private async addCadenceSource(server: BleServer, current: () => boolean, source: 'power' | 'csc') {
    try {
      const service = await server.getPrimaryService(source === 'power' ? POWER_SERVICE : CSC_SERVICE)
      const characteristic = await service.getCharacteristic(source === 'power' ? POWER_MEASUREMENT : CSC_MEASUREMENT)
      if (!current() || characteristic === this.primary) return
      const tracker = cadenceTracker()
      const listener = (event: Event) => {
        const value = (event.target as BleCharacteristic | null)?.value
        if (!value) return
        const crank = source === 'power' ? parseCrankSample(value) : parseCscMeasurement(value).crank
        if (!crank) return
        const now = performance.now()
        const cadence = tracker.update(crank, now)
        if (cadence === undefined || now - this.primaryCadenceAt < 3000) return
        this.bikeCallbacks.onData({ cadence })
      }
      characteristic.addEventListener('characteristicvaluechanged', listener)
      this.cleanups.push(() => characteristic.removeEventListener('characteristicvaluechanged', listener))
      await characteristic.startNotifications()
    } catch { /* Optional cadence source. */ }
  }
  protected receive(view: DataView) {
    const data = this.protocol === 0 ? parseIndoorBikeData(view) : parseCyclingPower(view)
    if (this.protocol === 1) {
      const crank = parseCrankSample(view)
      if (crank) {
        const cadence = this.cadence.update(crank, performance.now())
        if (cadence !== undefined) data.cadence = cadence
      }
    }
    if (data.cadence !== undefined) this.primaryCadenceAt = performance.now()
    if (Object.values(data).some(value => value !== undefined)) this.bikeCallbacks.onData(data)
  }
}

interface CadenceSpeedCallbacks extends ConnectionCallbacks { onData: (data: { cadence?: number; speed?: number }) => void }

/** Standalone Cycling Speed and Cadence sensor (0x1816). Never produces power. */
export class CadenceSpeedConnection extends SensorConnection {
  private cadence = cadenceTracker()
  private speed = speedTracker()
  constructor(private cscCallbacks: CadenceSpeedCallbacks) {
    super(cscCallbacks, CSC_KEY, 'Kadenssensor', [
      { service: CSC_SERVICE, characteristic: CSC_MEASUREMENT },
    ], [{ services: [CSC_SERVICE] }])
  }
  protected reset() { this.cadence.reset(); this.speed.reset() }
  protected unavailable() {
    return 'Kunne ikke lese kadens eller fart. Sensoren må støtte Bluetooth Cycling Speed and Cadence.'
  }
  protected receive(view: DataView) {
    const { wheel, crank } = parseCscMeasurement(view)
    const now = performance.now()
    const data: { cadence?: number; speed?: number } = {}
    if (crank) { const cadence = this.cadence.update(crank, now); if (cadence !== undefined) data.cadence = cadence }
    if (wheel) { const speed = this.speed.update(wheel, now); if (speed !== undefined) data.speed = speed }
    if (data.cadence !== undefined || data.speed !== undefined) this.cscCallbacks.onData(data)
  }
}

/** Independent BLE heart-rate sensor connection; supports standard HRS devices. */
export class HeartRateConnection extends SensorConnection {
  private missingContact = false
  constructor(private heartCallbacks: HeartRateCallbacks) {
    super(heartCallbacks, HEART_KEY, 'Pulssensor', [
      { service: HEART_RATE_SERVICE, characteristic: HEART_RATE_MEASUREMENT },
    ], [{ services: [HEART_RATE_SERVICE] }])
  }
  protected reset() { this.missingContact = false }
  protected receive(view: DataView) {
    const heartRate = parseHeartRate(view)
    if (heartRate === undefined) {
      if (view.byteLength >= 2 && (view.getUint8(0) & 6) === 4 && !this.missingContact) {
        this.missingContact = true
        this.heartCallbacks.onError('Pulssensoren mangler hudkontakt. Fukt elektrodene og juster beltet.')
      }
      return
    }
    this.missingContact = false
    this.heartCallbacks.onData(heartRate)
  }
}
