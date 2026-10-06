import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Bluetooth, Check, CircleAlert, Copy, Square, X, Zap } from 'lucide-react'
import {
  bluetooth, bluetoothAvailable, cadenceTracker, isAppleMobile, parseCrankSample, parseCscMeasurement, parseCyclingPower,
  parseHeartRate, parseIndoorBikeData, setupFtms, speedTracker, type BleCharacteristic, type BleDevice, type BleServer, type BleService,
} from './bluetooth'
import { FtmsControl } from './ftmsControl'
import {
  PROBE_SERVICES, characteristicName, controlSupported, deviceVerdict, formatDeviceReport, identifyService, normalizeUuid,
  powerSourceOf, serviceRank, type ErgTestResult, type ErgTestStep, type ProbeReport, type ProbeService,
} from './deviceProbe'
import './device-check.css'

const ERG_STEPS = [100, 150]
const STEP_SECONDS = 10
type Phase = 'idle' | 'connecting' | 'connected' | 'lost'
interface Live { power?: number; cadence?: number; speed?: number; heartRate?: number }
interface Sources { ftms: Live; cp: Live; csc: Live; hr: Live }
interface Probe { device: BleDevice; cleanups: Array<() => void>; active: boolean }
type Static = Omit<ProbeReport, 'measured' | 'powerSeen' | 'ergTest' | 'log'>

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const decode = (view: DataView) => new TextDecoder().decode(view).replace(/\0+$/, '').trim() || undefined

async function listServices(server: BleServer): Promise<{ services: ProbeService[]; listed: boolean }> {
  let found: Array<{ service: BleService; uuid: string }> = []
  try {
    if (server.getPrimaryServices) found = (await server.getPrimaryServices()).map(service => ({ service, uuid: normalizeUuid(service.uuid ?? '') }))
  } catch { /* Fall back to asking for each known service. */ }
  if (!found.length) {
    for (const uuid of PROBE_SERVICES) {
      try { const service = await server.getPrimaryService(uuid); found.push({ service, uuid: normalizeUuid(service.uuid ?? uuid) }) }
      catch { /* Not present. */ }
    }
  }
  let listed = true
  const services: ProbeService[] = []
  for (const { service, uuid } of found) {
    let characteristics: string[] = []
    try {
      if (!service.getCharacteristics) listed = false
      else characteristics = (await service.getCharacteristics()).map(c => normalizeUuid(c.uuid ?? '')).filter(id => id.length > 4)
    } catch { listed = false }
    services.push({ uuid, characteristics })
  }
  return { services, listed }
}

async function readString(server: BleServer, characteristic: number): Promise<string | undefined> {
  try {
    const value = await (await (await server.getPrimaryService(0x180a)).getCharacteristic(characteristic)).readValue?.()
    return value ? decode(value) : undefined
  } catch { return }
}

function unsupportedText(): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'Web Bluetooth krever en sikker adresse. Åpne SUMMIT via HTTPS eller localhost.'
  if (isAppleMobile()) return 'Safari og Chrome på iPhone og iPad har ikke Web Bluetooth. Installer Bluefy – Web BLE Browser (gratis i App Store) og åpne denne siden der.'
  return 'Denne nettleseren har ikke Web Bluetooth. Bruk Chrome eller Edge på PC, Mac eller Android.'
}

const fmt = (value: number | undefined, digits = 0) => value === undefined ? '—' : value.toFixed(digits)

/** "Test sykkelen din": what a device exposes, live readings, an optional short ERG test and a verdict. */
export default function DeviceCheck({ onBack, onClose }: { onBack: () => void; onClose?: () => void }) {
  const supported = bluetoothAvailable()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<Static | null>(null)
  const [sources, setSources] = useState<Sources>({ ftms: {}, cp: {}, csc: {}, hr: {} })
  const [powerSeen, setPowerSeen] = useState(false)
  const [test, setTest] = useState<{ running: boolean; step: number; remaining: number; result?: ErgTestResult }>({ running: false, step: 0, remaining: 0 })
  const [copied, setCopied] = useState<'' | 'ok' | 'failed'>('')
  const [control] = useState(() => new FtmsControl())
  const ftms = useSyncExternalStore(control.subscribe, control.getSnapshot)
  const probe = useRef<Probe | null>(null)
  const powerLog = useRef<Array<{ at: number; power: number }>>([])
  const testToken = useRef(0)
  const testSteps = useRef<ErgTestStep[]>([])
  const mounted = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  function teardown() {
    const current = probe.current
    probe.current = null
    if (!current) return
    current.active = false
    for (const cleanup of current.cleanups.splice(0).reverse()) cleanup()
    if (current.device.gatt?.connected) current.device.gatt.disconnect()
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode re-runs effects immediately; only a real unmount survives to the timeout.
      setTimeout(() => {
        if (mounted.current) return
        testToken.current++
        const releasing = control.getSnapshot().hasControl
        control.setDesired({ mode: 'released', stop: true })
        setTimeout(() => { teardown(); closeRef.current?.() }, releasing ? 600 : 0)
      }, 0)
    }
  }, [])

  function update(source: keyof Sources, data: Live) {
    if (data.power !== undefined) {
      powerLog.current = [...powerLog.current.filter(p => performance.now() - p.at < 30000), { at: performance.now(), power: data.power }]
      setPowerSeen(true)
    }
    setSources(previous => ({ ...previous, [source]: { ...previous[source], ...data } }))
  }

  async function subscribe(server: BleServer, current: () => boolean, cleanups: Array<() => void>, service: number, characteristic: number, handle: (view: DataView) => void) {
    try {
      const target: BleCharacteristic = await (await server.getPrimaryService(service)).getCharacteristic(characteristic)
      if (!current()) return
      const listener = (event: Event) => {
        const value = (event.target as BleCharacteristic | null)?.value
        if (value && current()) handle(value)
      }
      target.addEventListener('characteristicvaluechanged', listener)
      cleanups.push(() => target.removeEventListener('characteristicvaluechanged', listener))
      await target.startNotifications()
    } catch { /* Optional source. */ }
  }

  async function connect() {
    const ble = bluetooth()
    if (!ble || !supported) return
    setError('')
    // The chooser needs the click's user activation: no await before requestDevice.
    let device: BleDevice
    try {
      device = await ble.requestDevice({ acceptAllDevices: true, optionalServices: PROBE_SERVICES })
    } catch (caught) {
      const name = caught instanceof Error ? caught.name : ''
      if (name !== 'NotFoundError') setError(name === 'SecurityError' || name === 'NotAllowedError'
        ? 'Bluetooth-tilgang ble blokkert. Tillat Bluetooth for denne siden og prøv igjen.'
        : 'Kunne ikke åpne Bluetooth-søket. Prøv igjen.')
      return
    }
    teardown()
    testToken.current++
    control.detach()
    powerLog.current = []
    testSteps.current = []
    setSources({ ftms: {}, cp: {}, csc: {}, hr: {} })
    setPowerSeen(false)
    setTest({ running: false, step: 0, remaining: 0 })
    setInfo(null)
    setCopied('')
    const session: Probe = { device, cleanups: [], active: true }
    probe.current = session
    const current = () => session.active && probe.current === session && !!device.gatt?.connected
    setPhase('connecting')
    try {
      if (!device.gatt) throw new Error('no gatt')
      const server = await device.gatt.connect()
      const onLost = () => {
        if (!session.active || probe.current !== session) return
        testToken.current++
        control.detach()
        setTest(t => t.running ? { ...t, running: false, result: { state: 'stopped', steps: testSteps.current, error: 'forbindelsen ble brutt' } } : t)
        setPhase('lost')
      }
      device.addEventListener('gattserverdisconnected', onLost)
      session.cleanups.push(() => device.removeEventListener('gattserverdisconnected', onLost))
      const { services, listed } = await listServices(server)
      if (!current()) return
      const present = (uuid: number) => services.some(s => s.uuid === normalizeUuid(uuid))
      const [manufacturer, model, firmware] = present(0x180a)
        ? [await readString(server, 0x2a29), await readString(server, 0x2a24), await readString(server, 0x2a26)]
        : []
      const setup = present(0x1826) ? await setupFtms(server, device, control, current).catch(() => undefined) : undefined
      if (setup) session.cleanups.push(setup.cleanup)
      if (!current()) return
      setInfo({
        deviceName: device.name ?? '', manufacturer, model, firmware, services, characteristicsListed: listed,
        ...(setup?.features ? { features: setup.features } : {}), ...(setup?.powerRange ? { powerRange: setup.powerRange } : {}),
        controlPoint: !!setup?.control,
      })
      setPhase('connected')
      const crankCp = cadenceTracker(), crankCsc = cadenceTracker(), wheel = speedTracker()
      if (present(0x1826)) await subscribe(server, current, session.cleanups, 0x1826, 0x2ad2, view => update('ftms', parseIndoorBikeData(view)))
      if (present(0x1818)) await subscribe(server, current, session.cleanups, 0x1818, 0x2a63, view => {
        const crank = parseCrankSample(view)
        const cadence = crank ? crankCp.update(crank, performance.now()) : undefined
        update('cp', { ...parseCyclingPower(view), ...(cadence !== undefined ? { cadence } : {}) })
      })
      if (present(0x1816)) await subscribe(server, current, session.cleanups, 0x1816, 0x2a5b, view => {
        const { crank, wheel: wheelSample } = parseCscMeasurement(view)
        const cadence = crank ? crankCsc.update(crank, performance.now()) : undefined
        const speed = wheelSample ? wheel.update(wheelSample, performance.now()) : undefined
        update('csc', { ...(cadence !== undefined ? { cadence } : {}), ...(speed !== undefined ? { speed } : {}) })
      })
      if (present(0x180d)) await subscribe(server, current, session.cleanups, 0x180d, 0x2a37, view => {
        const heartRate = parseHeartRate(view)
        if (heartRate !== undefined) update('hr', { heartRate })
      })
    } catch {
      if (probe.current !== session) return
      teardown()
      control.detach()
      setPhase('idle')
      setError('Kunne ikke koble til. Slå på sykkelen, hold den i nærheten og lukk andre treningsapper (Zwift, Garmin, Wahoo).')
    }
  }

  function disconnect() {
    testToken.current++
    const releasing = control.getSnapshot().hasControl
    control.setDesired({ mode: 'released', stop: true })
    const finish = () => { teardown(); control.detach(); setPhase('idle'); setTest(t => ({ ...t, running: false })) }
    if (releasing) setTimeout(finish, 600)
    else finish()
  }

  async function runErgTest() {
    const token = ++testToken.current
    testSteps.current = []
    setCopied('')
    for (let index = 0; index < ERG_STEPS.length; index++) {
      control.setDesired({ mode: 'erg', watts: ERG_STEPS[index] })
      const started = performance.now()
      for (let left = STEP_SECONDS; left > 0; left--) {
        setTest({ running: true, step: index, remaining: left })
        await sleep(1000)
        if (token !== testToken.current) return
        if (control.getSnapshot().status === 'error') break
      }
      const snapshot = control.getSnapshot()
      const recent = powerLog.current.filter(p => p.at >= Math.max(started, performance.now() - 5000))
      const measured = recent.length ? recent.reduce((sum, p) => sum + p.power, 0) / recent.length : undefined
      const accepted = snapshot.status === 'on'
      testSteps.current = [...testSteps.current, { target: snapshot.targetWatts ?? ERG_STEPS[index], accepted, ...(measured !== undefined ? { measured } : {}) }]
      if (!accepted) {
        control.setDesired({ mode: 'released', stop: true })
        setTest({ running: false, step: index, remaining: 0, result: { state: 'failed', steps: testSteps.current, ...(snapshot.error ? { error: snapshot.error } : {}) } })
        return
      }
    }
    control.setDesired({ mode: 'released', stop: true })
    setTest({ running: false, step: ERG_STEPS.length - 1, remaining: 0, result: { state: 'passed', steps: testSteps.current } })
  }

  function stopErgTest() {
    testToken.current++
    control.setDesired({ mode: 'released', stop: true })
    setTest(t => ({ running: false, step: t.step, remaining: 0, result: { state: 'stopped', steps: testSteps.current } }))
  }

  const live: Live = {
    power: sources.ftms.power ?? sources.cp.power,
    cadence: sources.ftms.cadence ?? sources.cp.cadence ?? sources.csc.cadence,
    speed: sources.ftms.speed ?? sources.csc.speed,
    heartRate: sources.hr.heartRate ?? sources.ftms.heartRate,
  }
  const report: ProbeReport | null = info && { ...info, measured: live, powerSeen, ...(test.result ? { ergTest: test.result } : {}), log: ftms.log }
  const verdict = report && deviceVerdict(report)
  const canTest = !!report && controlSupported(report) && phase === 'connected' && ftms.supportsErg
  const reportText = report ? formatDeviceReport(report) : ''

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText)
      setCopied('ok')
    } catch {
      const area = document.createElement('textarea')
      area.value = reportText
      document.body.append(area)
      area.select()
      const ok = document.execCommand?.('copy') ?? false
      area.remove()
      setCopied(ok ? 'ok' : 'failed')
    }
  }

  return <section className="device-check" aria-label="Test sykkelen din">
    <div className="page-heading">
      <div>
        <div className="eyebrow">TEST SYKKELEN DIN</div>
        <h1>Fungerer sykkelen <span>med SUMMIT?</span></h1>
        <p>Koble til sykkelen, treneren eller sensoren. Vi viser hva den sender, og om automatisk motstand virker. Ingenting lagres.</p>
      </div>
      <button className="secondary" onClick={onBack}><ArrowLeft size={16} /> Tilbake</button>
    </div>

    {!supported ? <div className="dc-card dc-unsupported" role="status">
      <CircleAlert size={22} />
      <div><h2>Bluetooth er ikke tilgjengelig her</h2><p>{unsupportedText()}</p></div>
    </div> : <div className="dc-grid">
      <div className="dc-card dc-connect">
        <span className={`dc-dot ${phase}`} aria-hidden="true" />
        <div className="dc-device">
          <strong>{phase === 'idle' ? 'Ingen enhet valgt' : report?.deviceName || 'Enhet uten navn'}</strong>
          <small>{phase === 'connecting' ? 'Kobler til og leser tjenester …'
            : phase === 'lost' ? 'Forbindelsen ble brutt. Koble til igjen for å fortsette.'
            : phase === 'connected' ? [report?.manufacturer, report?.model, report?.firmware && `fastvare ${report.firmware}`].filter(Boolean).join(' · ') || 'Tilkoblet'
            : 'Slå på sykkelen og tråkk noen omdreininger. Appens egen sykkeltilkobling er koblet fra mens du tester.'}</small>
        </div>
        {phase === 'connected' || phase === 'connecting'
          ? <button className="secondary" onClick={disconnect} disabled={phase === 'connecting'}><X size={15} /> Koble fra</button>
          : <button className="primary" onClick={() => void connect()}><Bluetooth size={16} /> {phase === 'lost' ? 'Koble til igjen' : 'Velg enhet'}</button>}
      </div>
      {error && <div className="dc-error" role="alert">{error}</div>}

      {report && <>
        <div className="dc-card dc-live" aria-label="Live målinger">
          <div><b>{fmt(live.power)}</b><small>watt</small></div>
          <div><b>{fmt(live.cadence)}</b><small>rpm</small></div>
          <div><b>{fmt(live.speed, 1)}</b><small>km/t</small></div>
          <div><b>{fmt(live.heartRate)}</b><small>puls</small></div>
        </div>

        <div className="dc-card dc-services">
          <h2>Dette sender enheten</h2>
          <ul>
            {report.services.length === 0 && <li className="none"><span>Ingen kjente tjenester funnet.</span></li>}
            {[...report.services].sort((a, b) => serviceRank(a.uuid) - serviceRank(b.uuid)).map(service => {
              const known = identifyService(service.uuid)
              const status = !known ? 'ukjent' : known.support === 'proprietary' ? 'kjent, ikke støttet ennå' : known.support === 'info' ? 'info' : 'støttes'
              return <li key={service.uuid} className={known?.support ?? 'unknown'}>
                <span><strong>{known?.name ?? characteristicName(service.uuid)}</strong><small>{known?.role}{service.characteristics.length ? ` · ${service.characteristics.map(characteristicName).join(', ')}` : ''}</small></span>
                <em>{status}</em>
              </li>
            })}
          </ul>
          {report.features && <p className="dc-features">
            FTMS: kadens {report.features.cadence ? 'ja' : 'nei'} · wattmål (ERG) {report.features.powerTarget ? 'ja' : 'nei'} · simulering {report.features.simulation ? 'ja' : 'nei'}
            {report.powerRange ? ` · ${Math.max(0, report.powerRange.min)}–${report.powerRange.max} W` : ''}
          </p>}
        </div>

        <div className="dc-card dc-erg">
          <h2>Automatisk motstand</h2>
          {!controlSupported(report) ? <p>{powerSourceOf(report) ? 'Enheten tilbyr ikke standard wattstyring (FTMS). Du justerer motstanden selv.' : 'Ikke tilgjengelig uten standard sykkeldata.'}</p>
            : test.running ? <div className="dc-erg-running" role="status">
              <p><strong>Steg {test.step + 1} av {ERG_STEPS.length} · {ERG_STEPS[test.step]} W</strong> · {test.remaining} s igjen</p>
              <p className="dc-erg-live">Målt nå <b>{fmt(live.power)} W</b> · {ftms.status === 'on' ? 'motstand satt' : ftms.status === 'error' ? ftms.error : 'sender wattmål …'}</p>
              <button className="dc-stop" onClick={stopErgTest}><Square size={15} fill="currentColor" /> Stopp testen</button>
            </div>
            : <>
              <p>Testen setter motstanden til {ERG_STEPS.join(' W og deretter ')} W i {STEP_SECONDS} sekunder hver. Tråkk rolig og jevnt (80–90 rpm). Du kan stoppe når som helst.</p>
              {test.result && <ul className="dc-erg-result">
                {test.result.steps.map(step => <li key={step.target} className={step.accepted ? 'ok' : 'failed'}>
                  {step.accepted ? <Check size={15} /> : <X size={15} />}{step.target} W {step.accepted ? 'godtatt' : 'ikke godtatt'}{step.measured !== undefined ? ` · målt ${Math.round(step.measured)} W` : ''}
                </li>)}
                {test.result.state === 'stopped' && <li className="stopped">Testen ble stoppet{test.result.error ? ` (${test.result.error})` : ''}.</li>}
                {test.result.state === 'failed' && test.result.error && <li className="failed">{test.result.error}</li>}
              </ul>}
              <button className="primary" disabled={!canTest} onClick={() => void runErgTest()}><Zap size={16} /> {test.result ? 'Kjør ERG-testen igjen' : 'Start ERG-test (20 s)'}</button>
            </>}
        </div>

        {verdict && <div className={`dc-card dc-verdict ${verdict.level}`} role="status">
          <span className="dc-verdict-mark" aria-hidden="true">{verdict.level === 'none' ? <X size={20} /> : <Check size={20} />}</span>
          <div>
            <h2>{verdict.title}</h2>
            <p>{verdict.text}</p>
            {verdict.note && <p className="dc-note">{verdict.note}</p>}
          </div>
          <div className="dc-report-actions">
            <button className="secondary" onClick={() => void copyReport()}><Copy size={15} /> Kopier rapport</button>
            {copied && <small role="status">{copied === 'ok' ? 'Rapporten er kopiert.' : 'Kunne ikke kopiere. Marker teksten under.'}</small>}
          </div>
          <details className="dc-report"><summary>Vis rapporten</summary><pre>{reportText}</pre></details>
        </div>}
      </>}
    </div>}
  </section>
}
