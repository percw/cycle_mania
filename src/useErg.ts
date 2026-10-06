import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { FtmsControl, type ErgDesired, type FtmsInfo } from './ftmsControl'

const PREFIX = 'summit-erg:'

/** ERG is opt-in per trainer: the same browser may meet a smart trainer and a spin bike. */
export function ergPreferenceId(info: FtmsInfo | null): string {
  return info ? info.deviceId || info.deviceName : ''
}
export function readErgPreference(id: string): boolean {
  if (!id) return false
  try { return localStorage.getItem(PREFIX + id) === 'on' } catch { return false }
}
export function writeErgPreference(id: string, on: boolean) {
  if (!id) return
  try { localStorage.setItem(PREFIX + id, on ? 'on' : 'off') } catch { /* Optional persistence. */ }
}

export interface ErgDemand {
  /** A ride exists (running or paused). */
  session: boolean
  running: boolean
  /** A real Bluetooth ride that may use ERG: never demo, never a ramp test, bike connected over BLE. */
  eligible: boolean
  /** Current block target in watts. Changes only on block or FTP changes. */
  target: number
}

/**
 * What the trainer should do right now. Pausing keeps control (resume re-sends the
 * target); ending the ride stops and releases; switching ERG off mid-ride only
 * releases, so the machine itself keeps running in free resistance.
 */
export function ergDesired(supported: boolean, enabled: boolean, demand: ErgDemand): ErgDesired {
  if (supported && enabled && demand.eligible && demand.session)
    return demand.running ? { mode: 'erg', watts: demand.target } : { mode: 'paused' }
  return { mode: 'released', stop: !demand.session }
}

export function useErg(demand: ErgDemand) {
  const [control] = useState(() => new FtmsControl())
  const snapshot = useSyncExternalStore(control.subscribe, control.getSnapshot)
  const id = ergPreferenceId(snapshot.info)
  const [version, setVersion] = useState(0)
  const enabled = useMemo(() => readErgPreference(id), [id, version])
  const desired = ergDesired(snapshot.supportsErg, enabled, demand)
  const key = JSON.stringify(desired)
  // Re-applied when a (re)attached trainer appears; the controller itself skips unchanged state.
  useEffect(() => { control.setDesired(JSON.parse(key) as ErgDesired) }, [control, key, snapshot.info])
  return {
    control,
    supported: snapshot.supportsErg,
    enabled,
    setEnabled(on: boolean) { writeErgPreference(id, on); setVersion(v => v + 1) },
    /** ERG is meant to hold the trainer right now. */
    active: desired.mode === 'erg',
    status: snapshot.status,
    targetWatts: snapshot.targetWatts,
    error: snapshot.error,
    info: snapshot.info,
  }
}
export type ErgState = ReturnType<typeof useErg>
