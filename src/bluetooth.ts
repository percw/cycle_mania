/** Read-only standard Bluetooth fitness telemetry. Speed is km/h, cadence rpm. */
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

interface CrankSample { revolutions: number; eventTime: number }
function parseCrankSample(view: DataView): CrankSample | undefined {
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

// getDevices is optional: browser support for persisted permissions varies.
interface BleCharacteristic extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BleCharacteristic>
}
interface BleService { getCharacteristic(uuid: number): Promise<BleCharacteristic> }
interface BleServer {
  connected: boolean
  connect(): Promise<BleServer>
  disconnect(): void
  getPrimaryService(uuid: number): Promise<BleService>
}
interface BleDevice extends EventTarget { id?: string; name?: string; gatt?: BleServer }
interface BleNavigator {
  getDevices?(): Promise<BleDevice[]>
  requestDevice(options: {
    filters: Array<{ services?: number[]; namePrefix?: string }>
    optionalServices: number[]
  }): Promise<BleDevice>
}
function bluetooth(): BleNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined
    : (navigator as Navigator & { bluetooth?: BleNavigator }).bluetooth
}
export function bluetoothAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!bluetooth()
}
const BIKE_KEY = 'summit-ble-bike'
const HEART_KEY = 'summit-ble-heart-rate'
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
  ) {}

  protected abstract receive(view: DataView): void
  protected reset(): void {}
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
      this.callbacks.onError(typeof window !== 'undefined' && !window.isSecureContext
        ? 'Bluetooth krever HTTPS eller localhost. Åpne appen på en sikker adresse.'
        : 'Nettleseren støtter ikke Web Bluetooth. Bruk Chrome eller Edge på PC/Mac, eller Chrome på Android.')
      return
    }
    this.callbacks.onStatus('connecting')
    try {
      // Avoid any await before the first chooser for a new device: it needs a user gesture.
      let device: BleDevice | undefined
      if (remembered(this.key) && ble.getDevices) device = await this.authorizedDevice()
      if (generation !== this.generation) return
      device ??= await ble.requestDevice({ filters: this.filters, optionalServices: this.protocols.map(p => p.service) })
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
        return true
      } catch {
        characteristic?.removeEventListener('characteristicvaluechanged', this.onNotification)
        if (generation !== this.generation) return false
        this.characteristic = undefined
      }
    }
    throw new Error(this.key === BIKE_KEY
      ? 'Fant ingen tilgjengelige sykkeldata. Sykkelen må tilby FTMS eller Cycling Power over BLE. Lukk andre treningsapper og prøv igjen.'
      : 'Kunne ikke lese puls. Sensoren må støtte Bluetooth Heart Rate. ANT+-sensorer kobles til via ANT-broen.')
  }
  /** Cancels in-flight work and reconnect timers; keeps browser permission for the next ride. */
  disconnect(): void {
    const name = this.device?.name
    this.begin()
    this.callbacks.onStatus('disconnected', name)
  }
}

/** No control point, resistance or other characteristic is ever written. */
export class BikeConnection extends SensorConnection {
  private crank?: CrankSample
  private crankChangedAt = 0
  private previousCadence?: number
  constructor(private bikeCallbacks: BikeCallbacks) {
    super(bikeCallbacks, BIKE_KEY, 'Xebex-sykkel', [
      { service: FTMS_SERVICE, characteristic: INDOOR_BIKE_DATA },
      { service: POWER_SERVICE, characteristic: POWER_MEASUREMENT },
    ], [{ services: [FTMS_SERVICE] }, { services: [POWER_SERVICE] },
      { namePrefix: 'XEBEX' }, { namePrefix: 'Xebex' }, { namePrefix: 'xebex' }])
  }
  protected reset() { this.crank = undefined; this.previousCadence = undefined }
  protected receive(view: DataView) {
    const data = this.protocol === 0 ? parseIndoorBikeData(view) : parseCyclingPower(view)
    if (this.protocol === 1) {
      const next = parseCrankSample(view)
      if (next) {
        const now = performance.now()
        if (this.crank) {
          const revolutions = (next.revolutions - this.crank.revolutions + 65536) % 65536
          const ticks = (next.eventTime - this.crank.eventTime + 65536) % 65536
          if (ticks && revolutions) {
            const cadence = revolutions * 60 * 1024 / ticks
            if (cadence <= 250) { this.previousCadence = cadence; data.cadence = cadence }
            this.crankChangedAt = now
          } else if (!revolutions && !ticks) {
            data.cadence = now - this.crankChangedAt >= 3000 ? 0 : this.previousCadence
          }
        } else this.crankChangedAt = now
        this.crank = next
      }
    }
    if (Object.values(data).some(value => value !== undefined)) this.bikeCallbacks.onData(data)
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
