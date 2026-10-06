import { afterEach, describe, expect, it, vi } from 'vitest'
import { BikeConnection, HeartRateConnection, bluetoothAvailable, hasRememberedBike, rememberedBikeName, forgetRememberedBike, hasRememberedHeartRate, parseCyclingPower, parseHeartRate, parseIndoorBikeData } from './bluetooth'

function packet(bytes: number[]) {
  return new DataView(Uint8Array.from(bytes).buffer)
}
function u16(value: number) { return [value & 255, (value >> 8) & 255] }

describe('FTMS indoor bike data', () => {
  it('reads speed, half-rpm cadence, signed power and heart rate', () => {
    const flags = 4 | 64 | 512
    expect(parseIndoorBikeData(packet([...u16(flags), ...u16(3275), ...u16(171), ...u16(258), 153])))
      .toEqual({ speed: 32.75, cadence: 85.5, power: 258, heartRate: 153 })
  })

  it('skips every optional field without shifting the power or heart rate', () => {
    const flags = 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096
    const view = packet([...u16(flags), ...u16(3000), ...u16(2900), ...u16(180), ...u16(176),
      0x11, 0x22, 0x33, ...u16(100), ...u16(-42), ...u16(240),
      ...u16(123), ...u16(450), 8, 161, 12, ...u16(220), ...u16(500)])
    expect(parseIndoorBikeData(view)).toEqual({ speed: 30, cadence: 90, power: -42, heartRate: 161 })
  })

  it('handles a continuation record without mandatory speed', () => {
    expect(parseIndoorBikeData(packet([...u16(1 | 64 | 512), ...u16(310), 170])))
      .toEqual({ power: 310, heartRate: 170 })
  })

  it('never invents power when the flag is absent', () => {
    expect(parseIndoorBikeData(packet([...u16(4), ...u16(2000), ...u16(140)])))
      .toEqual({ speed: 20, cadence: 70 })
    expect(parseIndoorBikeData(packet(u16(1)))).toEqual({})
  })

  it('retains complete fields but rejects truncated fields at every byte boundary', () => {
    const bytes = [...u16(4 | 16 | 64 | 512), ...u16(3000), ...u16(180), 1, 2, 3, ...u16(245), 160]
    for (let length = 0; length <= bytes.length; length++) {
      const result = parseIndoorBikeData(packet(bytes.slice(0, length)))
      expect(result.power).toBe(length >= 11 ? 245 : undefined)
      expect(result.heartRate).toBe(length >= 12 ? 160 : undefined)
    }
  })

  it('honors a DataView byte offset', () => {
    const bytes = Uint8Array.from([99, 99, ...u16(1 | 64), ...u16(280), 99])
    expect(parseIndoorBikeData(new DataView(bytes.buffer, 2, 4))).toEqual({ power: 280 })
  })
})

describe('Cycling Power Measurement', () => {
  it('reads signed watts independently of optional fields', () => {
    expect(parseCyclingPower(packet([...u16(0xffff), ...u16(-25), 1, 2, 3]))).toEqual({ power: -25 })
    expect(parseCyclingPower(packet([...u16(0), ...u16(0)]))).toEqual({ power: 0 })
  })
  it('ignores truncated mandatory data', () => {
    for (let length = 0; length < 4; length++) {
      expect(parseCyclingPower(packet([0, 0, 250, 0].slice(0, length)))).toEqual({})
    }
  })
})

describe('Heart Rate Measurement', () => {
  it('reads 8-bit and little-endian 16-bit values', () => {
    expect(parseHeartRate(packet([0, 157]))).toBe(157)
    expect(parseHeartRate(packet([1, ...u16(310)]))).toBe(310)
    expect(parseHeartRate(packet([0, 0]))).toBe(0)
  })

  it('rejects missing or truncated mandatory fields', () => {
    for (const bytes of [[], [0], [1], [1, 150]]) {
      expect(parseHeartRate(packet(bytes))).toBeUndefined()
    }
  })

  it('respects contact support and contact status independently', () => {
    expect(parseHeartRate(packet([4, 150]))).toBeUndefined()
    expect(parseHeartRate(packet([5, ...u16(150)]))).toBeUndefined()
    expect(parseHeartRate(packet([6, 150]))).toBe(150)
    expect(parseHeartRate(packet([7, ...u16(150)]))).toBe(150)
    // Contact status cannot invalidate a sensor that does not support detection.
    expect(parseHeartRate(packet([0, 150]))).toBe(150)
    expect(parseHeartRate(packet([2, 150]))).toBe(150)
  })

  it('does not confuse optional energy or RR intervals with bpm', () => {
    expect(parseHeartRate(packet([8 | 16, 165, ...u16(2000), ...u16(372), ...u16(375)]))).toBe(165)
    const bytes = Uint8Array.from([99, 7, ...u16(175), 99])
    expect(parseHeartRate(new DataView(bytes.buffer, 1, 3))).toBe(175)
  })
})

class MockCharacteristic extends EventTarget {
  value?: DataView
  startNotifications = vi.fn(async () => this)
  emit(bytes: number[]) {
    this.value = packet(bytes)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

function setupDevice({ fallback = false } = {}) {
  const characteristic = new MockCharacteristic()
  const device = Object.assign(new EventTarget(), {
    id: 'test-device-id',
    name: 'XEBEX test',
    gatt: {
      connected: false,
      connect: vi.fn(async () => { device.gatt.connected = true; return device.gatt }),
      disconnect: vi.fn(() => { device.gatt.connected = false }),
      getPrimaryService: vi.fn(async (id: number) => {
        if (fallback && id === 0x1826) throw new Error('No FTMS')
        return { getCharacteristic: vi.fn(async () => characteristic) }
      }),
    },
  })
  const requestDevice = vi.fn(async () => device)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  })
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } })
  const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
  return { characteristic, device, requestDevice, callbacks, connection: new BikeConnection(callbacks) }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('BikeConnection', () => {
  it('subscribes to FTMS and removes listeners on disconnect', async () => {
    const { connection, callbacks, device, characteristic, requestDevice } = setupDevice()
    expect(bluetoothAvailable()).toBe(true)
    await connection.connect()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('connected', 'XEBEX test')
    expect(requestDevice.mock.calls[0]).toBeDefined()
    characteristic.emit([...u16(1 | 64), ...u16(250)])
    expect(callbacks.onData).toHaveBeenLastCalledWith({ power: 250 })
    connection.disconnect()
    expect(device.gatt.disconnect).toHaveBeenCalledOnce()
    characteristic.emit([...u16(1 | 64), ...u16(300)])
    expect(callbacks.onData).toHaveBeenCalledOnce()
  })

  it('falls back to power, derives cadence across rollover and skips optional fields', async () => {
    const { connection, callbacks, characteristic } = setupDevice({ fallback: true })
    await connection.connect()
    const flags = 1 | 4 | 16 | 32
    const emit = (revolutions: number, ticks: number) => characteristic.emit([
      ...u16(flags), ...u16(270), 50, ...u16(100), 1, 0, 0, 0, ...u16(250),
      ...u16(revolutions), ...u16(ticks),
    ])
    emit(65535, 65000)
    expect(callbacks.onData).toHaveBeenLastCalledWith({ power: 270 })
    emit(0, 488)
    expect(callbacks.onData).toHaveBeenLastCalledWith({ power: 270, cadence: 60 })
    emit(0, 488)
    expect(callbacks.onData).toHaveBeenLastCalledWith({ power: 270, cadence: 60 })
  })

  it('handles remote disconnect and allows a clean new connection', async () => {
    const { connection, callbacks, device, characteristic } = setupDevice()
    await connection.connect()
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('disconnected', 'XEBEX test')
    characteristic.emit([...u16(1 | 64), ...u16(300)])
    expect(callbacks.onData).not.toHaveBeenCalled()
    await connection.connect()
    characteristic.emit([...u16(1 | 64), ...u16(300)])
    expect(callbacks.onData).toHaveBeenCalledOnce()
  })

  it('reports unsupported browsers without throwing', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', {})
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    expect(bluetoothAvailable()).toBe(false)
    await new BikeConnection(callbacks).connect()
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Web Bluetooth'))
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('disconnected')
  })

  it('does not resume a cancelled in-flight connection', async () => {
    const { connection, callbacks, device } = setupDevice()
    let resolveDevice!: (selected: typeof device) => void
    vi.stubGlobal('navigator', { bluetooth: {
      requestDevice: () => new Promise<typeof device>(resolve => { resolveDevice = resolve }),
    } })
    const pending = connection.connect()
    connection.disconnect()
    resolveDevice(device)
    await pending
    expect(device.gatt.connect).not.toHaveBeenCalled()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('disconnected', undefined)
  })
})

describe('HeartRateConnection', () => {
  it('discovers standard heart-rate sensors and subscribes to the correct characteristic', async () => {
    const { requestDevice, device, characteristic } = setupDevice()
    const getCharacteristic = vi.fn(async () => characteristic)
    device.gatt.getPrimaryService.mockResolvedValue({ getCharacteristic })
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    const connection = new HeartRateConnection(callbacks)
    await connection.connect()
    expect(requestDevice).toHaveBeenCalledWith({ filters: [{ services: [0x180d] }], optionalServices: [0x180d] })
    expect(device.gatt.getPrimaryService).toHaveBeenCalledWith(0x180d)
    expect(getCharacteristic).toHaveBeenCalledWith(0x2a37)
    characteristic.emit([6, 155])
    expect(callbacks.onData).toHaveBeenLastCalledWith(155)
    connection.disconnect()
    characteristic.emit([6, 170])
    expect(callbacks.onData).toHaveBeenCalledOnce()
    expect(device.gatt.disconnect).toHaveBeenCalledOnce()
  })

  it('ignores lost skin contact and recovers when contact returns', async () => {
    const { characteristic } = setupDevice()
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    await new HeartRateConnection(callbacks).connect()
    characteristic.emit([4, 140])
    characteristic.emit([4, 140])
    expect(callbacks.onData).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('hudkontakt'))
    characteristic.emit([6, 146])
    expect(callbacks.onData).toHaveBeenCalledWith(146)
  })

  it('keeps the bike connection alive when the separate pulse sensor disconnects', async () => {
    const bike = setupDevice()
    await bike.connection.connect()
    const pulse = setupDevice()
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    const connection = new HeartRateConnection(callbacks)
    await connection.connect()
    connection.disconnect()
    expect(bike.device.gatt.connected).toBe(true)
    bike.characteristic.emit([...u16(1 | 64), ...u16(220)])
    expect(bike.callbacks.onData).toHaveBeenCalledWith({ power: 220 })
  })

  it('removes notifications after remote disconnection and supports reconnect', async () => {
    const { characteristic, device } = setupDevice()
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    const connection = new HeartRateConnection(callbacks)
    await connection.connect()
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('disconnected', device.name)
    characteristic.emit([0, 160])
    expect(callbacks.onData).not.toHaveBeenCalled()
    await connection.connect()
    characteristic.emit([0, 160])
    expect(callbacks.onData).toHaveBeenCalledOnce()
  })

  it('cancels a connection while the browser chooser is pending', async () => {
    const { device } = setupDevice()
    let resolveDevice!: (selected: typeof device) => void
    vi.stubGlobal('navigator', { bluetooth: {
      requestDevice: () => new Promise<typeof device>(resolve => { resolveDevice = resolve }),
    } })
    const callbacks = { onData: vi.fn(), onStatus: vi.fn(), onError: vi.fn() }
    const connection = new HeartRateConnection(callbacks)
    const pending = connection.connect()
    connection.disconnect()
    resolveDevice(device)
    await pending
    expect(device.gatt.connect).not.toHaveBeenCalled()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('disconnected', undefined)
  })
})


describe('remembered sensors and bounded reconnection', () => {
  it('saves only a working subscription and silently reconnects an authorized bike', async () => {
    const { connection, device, requestDevice, callbacks } = setupDevice()
    expect(hasRememberedBike()).toBe(false)
    await connection.connect()
    expect(hasRememberedBike()).toBe(true)
    expect(rememberedBikeName()).toBe(device.name)
    connection.disconnect()
    const getDevices = vi.fn(async () => [device])
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices } })
    expect(await connection.connectRemembered()).toBe(true)
    expect(requestDevice).toHaveBeenCalledOnce()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('connected', device.name)
    connection.disconnect()
    await connection.connect()
    expect(requestDevice).toHaveBeenCalledOnce()
    connection.disconnect()
    forgetRememberedBike()
    expect(hasRememberedBike()).toBe(false)
    expect(rememberedBikeName()).toBe('')
  })

  it('uses a chooser only for manual connect when getDevices is unavailable', async () => {
    const { connection, requestDevice, callbacks } = setupDevice()
    await connection.connect()
    connection.disconnect()
    expect(await connection.connectRemembered()).toBe(false)
    expect(requestDevice).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
    await connection.connect()
    expect(requestDevice).toHaveBeenCalledTimes(2)
    connection.disconnect()
  })

  it('does not reconnect the wrong sensor or open a picker after revoked permission', async () => {
    const { connection, device, requestDevice, callbacks } = setupDevice()
    await connection.connect()
    connection.disconnect()
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices: async () => [{ ...device, id: 'another-device' }] } })
    expect(await connection.connectRemembered()).toBe(false)
    expect(requestDevice).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
    await connection.connect()
    expect(requestDevice).toHaveBeenCalledTimes(2)
    connection.disconnect()
  })

  it('does not remember or report success when notification subscriptions fail', async () => {
    const { connection, characteristic, callbacks } = setupDevice()
    characteristic.startNotifications.mockRejectedValue(new Error('No notifications'))
    await connection.connect()
    expect(hasRememberedBike()).toBe(false)
    expect(callbacks.onStatus).not.toHaveBeenCalledWith('connected', expect.anything())
  })

  it('silently handles failed remembered subscriptions and permissions errors', async () => {
    const { connection, device, characteristic, requestDevice, callbacks } = setupDevice()
    await connection.connect()
    connection.disconnect()
    callbacks.onStatus.mockClear()
    characteristic.startNotifications.mockRejectedValue(new Error('Disconnected'))
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices: async () => [device] } })
    expect(await connection.connectRemembered()).toBe(false)
    expect(callbacks.onStatus).not.toHaveBeenCalledWith('connected', expect.anything())
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(device.gatt.connected).toBe(false)
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices: async () => { throw new Error('Denied') } } })
    expect(await connection.connectRemembered()).toBe(false)
    expect(requestDevice).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('recovers notifications after an unexpected disconnect without a chooser', async () => {
    vi.useFakeTimers()
    const { connection, device, characteristic, callbacks, requestDevice } = setupDevice()
    await connection.connect()
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    await vi.advanceTimersByTimeAsync(1999)
    expect(device.gatt.connect).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(device.gatt.connect).toHaveBeenCalledTimes(2)
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('connected', device.name)
    expect(requestDevice).toHaveBeenCalledOnce()
    characteristic.emit([...u16(1 | 64), ...u16(250)])
    expect(callbacks.onData).toHaveBeenCalledOnce()
    connection.disconnect()
    await vi.runAllTimersAsync()
    expect(device.gatt.connect).toHaveBeenCalledTimes(2)
  })

  it('limits retry to three attempts and cancels pending retries on explicit disconnect', async () => {
    vi.useFakeTimers()
    const { connection, device, callbacks } = setupDevice()
    await connection.connect()
    device.gatt.connect.mockRejectedValue(new Error('Powered off'))
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    await vi.runAllTimersAsync()
    expect(device.gatt.connect).toHaveBeenCalledTimes(4)
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    device.gatt.connect.mockImplementation(async () => { device.gatt.connected = true; return device.gatt })
    await connection.connect()
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    connection.disconnect()
    const attempts = device.gatt.connect.mock.calls.length
    await vi.runAllTimersAsync()
    expect(device.gatt.connect).toHaveBeenCalledTimes(attempts)
    expect(hasRememberedBike()).toBe(true)
  })

  it('closes a GATT connection that resolves after cancellation', async () => {
    const { connection, device, callbacks } = setupDevice()
    let finish!: () => void
    device.gatt.connect.mockImplementation(() => new Promise(resolve => {
      finish = () => { device.gatt.connected = true; resolve(device.gatt) }
    }))
    const pending = connection.connect()
    await Promise.resolve()
    connection.disconnect()
    finish()
    await pending
    expect(device.gatt.connected).toBe(false)
    expect(callbacks.onStatus).not.toHaveBeenCalledWith('connected', expect.anything())
  })

  it('remembers heart-rate authorization separately and recovers without a chooser', async () => {
    vi.useFakeTimers()
    const { device, requestDevice, characteristic, callbacks } = setupDevice()
    const connection = new HeartRateConnection(callbacks)
    await connection.connect()
    expect(hasRememberedHeartRate()).toBe(true)
    expect(hasRememberedBike()).toBe(false)
    connection.disconnect()
    vi.stubGlobal('navigator', { bluetooth: { requestDevice, getDevices: async () => [device] } })
    expect(await connection.connectRemembered()).toBe(true)
    device.gatt.connected = false
    device.dispatchEvent(new Event('gattserverdisconnected'))
    await vi.advanceTimersByTimeAsync(2000)
    characteristic.emit([0, 150])
    expect(callbacks.onData).toHaveBeenCalledOnce()
    expect(callbacks.onData).toHaveBeenCalledWith(150)
    expect(requestDevice).toHaveBeenCalledOnce()
    connection.disconnect()
    expect(vi.getTimerCount()).toBe(0)
  })
})
