import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTROL_TIMEOUT_MS, ERG_FALLBACK_MAX_WATTS, ERG_MAX_WATTS, FtmsControl, RESULT, clampTargetPower,
  encodeIndoorBikeSimulation, encodeRequestControl, encodeReset, encodeSetTargetPower, encodeStartOrResume,
  encodeStopOrPause, machineStatusLosesControl, opLabel, parseControlPointResponse, parseFitnessMachineFeature,
  parseSupportedPowerRange, type FtmsInfo,
} from './ftmsControl'

const view = (bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer)
const u32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]
const s16 = (value: number) => [value & 255, (value >> 8) & 255]
const hex = (bytes: Uint8Array) => [...bytes]

describe('FTMS feature and range parsing', () => {
  it('reads machine and target-setting bits', () => {
    const machine = (1 << 1) | (1 << 14)
    const target = (1 << 3) | (1 << 13)
    expect(parseFitnessMachineFeature(view([...u32(machine), ...u32(target)]))).toMatchObject({
      cadence: true, powerMeasurement: true, heartRate: false, powerTarget: true, simulation: true, resistanceTarget: false,
    })
    expect(parseFitnessMachineFeature(view([...u32(0), ...u32(1 << 2)]))).toMatchObject({ cadence: false, powerTarget: false, resistanceTarget: true })
    expect(parseFitnessMachineFeature(view([1, 2, 3]))).toBeUndefined()
  })

  it('reads signed power range and rejects nonsense', () => {
    expect(parseSupportedPowerRange(view([...s16(0), ...s16(2000), ...s16(5)]))).toEqual({ min: 0, max: 2000, increment: 5 })
    expect(parseSupportedPowerRange(view([...s16(-50), ...s16(800), 0, 0]))).toEqual({ min: -50, max: 800, increment: 1 })
    expect(parseSupportedPowerRange(view([...s16(300), ...s16(200), 1, 0]))).toBeUndefined()
    expect(parseSupportedPowerRange(view([...s16(0), ...s16(0), 1, 0]))).toBeUndefined()
    expect(parseSupportedPowerRange(view([0, 0, 0]))).toBeUndefined()
  })
})

describe('FTMS control point encoding', () => {
  it('encodes the basic procedures', () => {
    expect(hex(encodeRequestControl())).toEqual([0x00])
    expect(hex(encodeReset())).toEqual([0x01])
    expect(hex(encodeStartOrResume())).toEqual([0x07])
    expect(hex(encodeStopOrPause('stop'))).toEqual([0x08, 0x01])
    expect(hex(encodeStopOrPause('pause'))).toEqual([0x08, 0x02])
  })

  it('encodes target power as little-endian sint16 and saturates', () => {
    expect(hex(encodeSetTargetPower(245))).toEqual([0x05, 0xf5, 0x00])
    expect(hex(encodeSetTargetPower(1000))).toEqual([0x05, 0xe8, 0x03])
    expect(hex(encodeSetTargetPower(-1))).toEqual([0x05, 0xff, 0xff])
    expect(hex(encodeSetTargetPower(99999))).toEqual([0x05, 0xff, 0x7f])
  })

  it('encodes simulation parameters with FTMS resolutions', () => {
    // wind -1.5 m/s → -1500, grade 4.25 % → 425, crr 0.004 → 40, cw 0.51 → 51
    expect(hex(encodeIndoorBikeSimulation({ windSpeed: -1.5, grade: 4.25, crr: 0.004, cw: 0.51 })))
      .toEqual([0x11, ...s16(-1500), ...s16(425), 40, 51])
    expect(hex(encodeIndoorBikeSimulation({ windSpeed: 0, grade: -3, crr: 1, cw: -2 })))
      .toEqual([0x11, 0, 0, ...s16(-300), 255, 0])
  })

  it('parses response indications and machine status', () => {
    expect(parseControlPointResponse(view([0x80, 0x05, 0x01]))).toEqual({ requestOpCode: 0x05, result: 0x01 })
    expect(parseControlPointResponse(view([0x80, 0x00, 0x05, 9]))).toEqual({ requestOpCode: 0x00, result: 0x05 })
    expect(parseControlPointResponse(view([0x05, 0x01, 0x01]))).toBeUndefined()
    expect(parseControlPointResponse(view([0x80, 0x01]))).toBeUndefined()
    expect(machineStatusLosesControl(view([0xff]))).toBe(true)
    expect(machineStatusLosesControl(view([0x01]))).toBe(true)
    expect(machineStatusLosesControl(view([0x08, 0xc8, 0]))).toBe(false)
    expect(opLabel(encodeSetTargetPower(150))).toBe('Wattmål 150 W')
  })
})

describe('clampTargetPower', () => {
  it('clamps to the device range and snaps to its increment', () => {
    const range = { min: 25, max: 1000, increment: 5 }
    expect(clampTargetPower(243, range)).toBe(245)
    expect(clampTargetPower(10, range)).toBe(25)
    expect(clampTargetPower(4000, range)).toBe(1000)
    expect(clampTargetPower(998, { min: 0, max: 999, increment: 10 })).toBe(990)
  })
  it('never produces a target from invalid input or beyond the app ceiling', () => {
    expect(clampTargetPower(NaN)).toBeUndefined()
    expect(clampTargetPower(Infinity)).toBeUndefined()
    expect(clampTargetPower(-40, { min: -100, max: 500, increment: 1 })).toBe(0)
    expect(clampTargetPower(5000, { min: 0, max: 4000, increment: 1 })).toBe(ERG_MAX_WATTS)
    expect(clampTargetPower(5000)).toBe(ERG_FALLBACK_MAX_WATTS)
  })
})

const INFO: FtmsInfo = {
  deviceId: 'trainer', deviceName: 'Trainer',
  features: parseFitnessMachineFeature(view([...u32(2), ...u32((1 << 3) | (1 << 13))]))!,
  powerRange: { min: 0, max: 1000, increment: 1 },
}

/** Mock control point: records writes and answers like a trainer, optionally per opcode. */
function trainer(answer: (bytes: number[]) => number | null = () => RESULT.success) {
  const control = new FtmsControl()
  const writes: number[][] = []
  const transport = {
    write: vi.fn(async (data: Uint8Array) => {
      const bytes = [...data]
      writes.push(bytes)
      const result = answer(bytes)
      if (result !== null) queueMicrotask(() => control.handleIndication(view([0x80, bytes[0], result])))
    }),
  }
  control.attach(transport, INFO)
  return { control, writes, transport }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => { vi.useRealTimers() })

describe('FtmsControl', () => {
  it('requests control, starts and sets the target once; later only real changes are written', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 200 })
    await settle()
    expect(writes).toEqual([[0x00], [0x07], [0x05, 200, 0]])
    expect(control.getSnapshot()).toMatchObject({ status: 'on', targetWatts: 200, hasControl: true })
    control.setDesired({ mode: 'erg', watts: 200 })
    control.setDesired({ mode: 'erg', watts: 200.2 })
    await settle()
    expect(writes).toHaveLength(3)
    control.setDesired({ mode: 'erg', watts: 250 })
    await settle()
    expect(writes.at(-1)).toEqual([0x05, 250, 0])
    expect(writes).toHaveLength(4)
  })

  it('keeps one command outstanding and coalesces rapid changes to the latest target', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 210 })
    control.setDesired({ mode: 'erg', watts: 220 })
    control.setDesired({ mode: 'erg', watts: 230 })
    await settle()
    expect(writes).toEqual([[0x00], [0x07], [0x05, 230, 0]])
  })

  it('pauses, resumes with a fresh target, and releases with stop then reset', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 180 })
    await settle()
    control.setDesired({ mode: 'paused' })
    await settle()
    expect(writes.at(-1)).toEqual([0x08, 0x02])
    control.setDesired({ mode: 'erg', watts: 180 })
    await settle()
    expect(writes.slice(-2)).toEqual([[0x07], [0x05, 180, 0]])
    control.setDesired({ mode: 'released', stop: true })
    await settle()
    expect(writes.slice(-2)).toEqual([[0x08, 0x01], [0x01]])
    expect(control.getSnapshot()).toMatchObject({ status: 'off', hasControl: false })
  })

  it('ends a paused ride with stop then reset', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 180 })
    await settle()
    control.setDesired({ mode: 'paused' })
    await settle()
    control.setDesired({ mode: 'released', stop: true })
    await settle()
    expect(writes.slice(3)).toEqual([[0x08, 0x02], [0x08, 0x01], [0x01]])
  })

  it('switching ERG off mid-ride resets without stopping the machine', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 150 })
    await settle()
    control.setDesired({ mode: 'released' })
    await settle()
    expect(writes.at(-1)).toEqual([0x01])
    expect(writes.some(bytes => bytes[0] === 0x08)).toBe(false)
  })

  it('does not write anything when releasing a trainer it never controlled', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'paused' })
    control.setDesired({ mode: 'released', stop: true })
    await settle()
    expect(writes).toEqual([])
  })

  it('clamps targets to the supported range', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 1800 })
    await settle()
    expect(writes.at(-1)).toEqual([0x05, ...s16(1000)])
    expect(control.getSnapshot().targetWatts).toBe(1000)
  })

  it('times out a silent trainer, reports an error and does not retry until the target changes', async () => {
    vi.useFakeTimers()
    const { control, writes } = trainer(bytes => bytes[0] === 0x05 ? null : RESULT.success)
    control.setDesired({ mode: 'erg', watts: 200 })
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toHaveLength(3)
    expect(control.getSnapshot().status).toBe('pending')
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS)
    expect(control.getSnapshot().status).toBe('error')
    expect(control.getSnapshot().error).toMatch(/svarte ikke/)
    control.setDesired({ mode: 'erg', watts: 200 })
    await vi.advanceTimersByTimeAsync(10000)
    expect(writes).toHaveLength(3)
    control.setDesired({ mode: 'erg', watts: 220 })
    await vi.advanceTimersByTimeAsync(0)
    expect(writes.at(-1)).toEqual([0x05, 220, 0])
  })

  it('a timeout for an outdated target does not block the newer target', async () => {
    vi.useFakeTimers()
    let silent = true
    const { control, writes } = trainer(bytes => bytes[0] === 0x05 && silent ? null : RESULT.success)
    control.setDesired({ mode: 'erg', watts: 200 })
    await vi.advanceTimersByTimeAsync(0)
    silent = false
    control.setDesired({ mode: 'erg', watts: 220 })
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS)
    expect(writes.slice(2)).toEqual([[0x05, 200, 0], [0x05, 220, 0]])
    expect(control.getSnapshot()).toMatchObject({ status: 'on', targetWatts: 220 })
  })

  it('re-requests control once when the trainer says control is not permitted', async () => {
    let refuseTarget = 1
    const { control, writes } = trainer(bytes => bytes[0] === 0x05 && refuseTarget-- > 0 ? RESULT.notPermitted : RESULT.success)
    control.setDesired({ mode: 'erg', watts: 160 })
    await settle()
    expect(writes).toEqual([[0x00], [0x07], [0x05, 160, 0], [0x00], [0x07], [0x05, 160, 0]])
    expect(control.getSnapshot().status).toBe('on')
  })

  it('stops after a refused control request instead of hammering the trainer', async () => {
    const { control, writes } = trainer(bytes => bytes[0] === 0x00 ? RESULT.notPermitted : RESULT.success)
    control.setDesired({ mode: 'erg', watts: 160 })
    await settle()
    expect(writes).toEqual([[0x00]])
    expect(control.getSnapshot()).toMatchObject({ status: 'error', hasControl: false })
    expect(control.getSnapshot().error).toMatch(/andre treningsapper/)
  })

  it('continues when Start/Resume is not supported', async () => {
    const { control, writes } = trainer(bytes => bytes[0] === 0x07 ? RESULT.notSupported : RESULT.success)
    control.setDesired({ mode: 'erg', watts: 140 })
    await settle()
    expect(writes).toEqual([[0x00], [0x07], [0x05, 140, 0]])
    expect(control.getSnapshot().status).toBe('on')
  })

  it('re-requests control after Machine Status reports lost permission', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'erg', watts: 175 })
    await settle()
    control.handleMachineStatus(view([0xff]))
    await settle()
    expect(writes.slice(3)).toEqual([[0x00], [0x07], [0x05, 175, 0]])
  })

  it('detaching (disconnect) clears control and does not re-engage on a new transport by itself', async () => {
    const { control, writes, transport } = trainer()
    control.setDesired({ mode: 'erg', watts: 200 })
    await settle()
    control.detach()
    expect(control.getSnapshot()).toMatchObject({ status: 'off', hasControl: false, supportsErg: false })
    control.attach(transport, INFO)
    await settle()
    expect(writes).toHaveLength(3)
    control.setDesired({ mode: 'erg', watts: 200 })
    await settle()
    expect(writes.slice(3)).toEqual([[0x00], [0x07], [0x05, 200, 0]])
  })

  it('refuses ERG on trainers without power target support', async () => {
    const control = new FtmsControl()
    const write = vi.fn(async () => {})
    control.attach({ write }, { ...INFO, features: { ...INFO.features!, powerTarget: false } })
    expect(control.getSnapshot().supportsErg).toBe(false)
    control.setDesired({ mode: 'erg', watts: 200 })
    await settle()
    expect(write).not.toHaveBeenCalled()
    expect(control.getSnapshot().status).toBe('error')
  })

  it('sends simulation parameters with a safe grade and dedupes them', async () => {
    const { control, writes } = trainer()
    control.setDesired({ mode: 'sim', params: { windSpeed: 0, grade: 45, crr: 0.004, cw: 0.51 } })
    await settle()
    expect(writes.at(-1)).toEqual([0x11, 0, 0, ...s16(2000), 40, 51])
    control.setDesired({ mode: 'sim', params: { windSpeed: 0, grade: 45, crr: 0.004, cw: 0.51 } })
    await settle()
    expect(writes).toHaveLength(3)
  })

  it('records a readable command log', async () => {
    const { control } = trainer()
    control.setDesired({ mode: 'erg', watts: 100 })
    await settle()
    expect(control.getSnapshot().log.map(entry => `${entry.label}: ${entry.result}`))
      .toEqual(['Be om kontroll: OK', 'Start: OK', 'Wattmål 100 W: OK'])
  })
})
