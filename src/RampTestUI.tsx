import { useMemo, useState } from 'react';
import { ArrowRight, Check, FlaskConical, Gauge, Repeat2, TrendingUp } from 'lucide-react';
import type { RideRecord } from './storage';
import type { RampProtocol } from './rampTypes';
import { STANDARD_RAMP_PROTOCOL, GENTLE_RAMP_PROTOCOL, analyzeRampTest, comparableRampHistory, rampProtocolKey } from './rampTest';
import './ramp-test.css';

const dateLabel = (date: string) => new Date(date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const changeLabel = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)} W`;
const protocolLabel = (protocol: RampProtocol) => `${protocol.startWatts} W start · +${protocol.stepWatts} W/min`;
const reasonLabel = (reason: string) => reason === 'exhaustion' ? 'Rampen avsluttet ved utmattelse.' : reason === 'ceiling' ? 'Alle rampetrinn ble fullført.' : 'Testen ble avbrutt.';
const sortResults = (history: RideRecord[]) => history.map(analyzeRampTest).filter(result => result !== null).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

function RampPreview({ protocol }: { protocol: RampProtocol }) {
  const start = protocol.startWatts, step = protocol.stepWatts;
  return <figure className="ramp-preview">
    <svg viewBox="0 0 640 156" role="img" aria-label={`Testprofil: fem minutter oppvarming, deretter ett minutt per trinn fra ${start} watt med ${step} watt økning. Tre minutter rolig etter at du avslutter rampen. Illustrasjonen viser de første tolv trinnene.`}>
      {[40, 80, 120].map(y => <line key={y} x1="12" x2="628" y1={y} y2={y} className="ramp-chart-grid" />)}
      <rect x="12" y="114" width="111" height="20" rx="4" className="ramp-profile-easy" />
      {Array.from({ length: 12 }, (_, index) => <rect key={index} x={131 + index * 32} y={112 - index * 8} width="28" height={22 + index * 8} rx="3" className="ramp-profile-step" style={{ opacity: 0.45 + index * 0.05 }} />)}
      <path d="M519 29v105" stroke="currentColor" strokeDasharray="3 4" opacity=".45" />
      <rect x="530" y="116" width="98" height="18" rx="4" className="ramp-profile-easy" />
      <text x="16" y="103">5 min rolig</text><text x="131" y="101">{start} W</text><text x="340" y="21">+{step} W hvert minutt</text><text x="530" y="105">3 min rolig</text>
      <text x="320" y="153" textAnchor="middle">Rampens lengde bestemmes av deg</text>
    </svg>
  </figure>;
}

export interface RampTestSetupProps {
  ftp: number;
  history: RideRecord[];
  onStart: (protocol: RampProtocol, demo: boolean) => void;
  disabled?: boolean;
  initialProtocol?: RampProtocol;
}

export function RampTestSetup({ ftp, history, onStart, disabled = false, initialProtocol }: RampTestSetupProps) {
  const [protocol, setProtocol] = useState(initialProtocol ?? (ftp < 180 ? GENTLE_RAMP_PROTOCOL : STANDARD_RAMP_PROTOCOL));
  const gentle = rampProtocolKey(protocol) === rampProtocolKey(GENTLE_RAMP_PROTOCOL);
  const previous = useMemo(() => sortResults(history).filter(result => !result.demo).at(-1), [history]);
  return <section id="ftp-test" className="ramp-panel ramp-setup" aria-labelledby="ramp-setup-title">
    <div className="ramp-heading"><span className="ramp-icon"><Gauge size={23} /></span><div><span className="ramp-eyebrow">DITT UTGANGSPUNKT. DIN UTVIKLING.</span><h2 id="ramp-setup-title">Finn din FTP</h2></div><span className="ramp-pill">RAMPTEST</span></div>
    <p className="ramp-intro">Ett minutt om gangen. Wattmålet øker gradvis til du ikke lenger klarer å holde det. Få et FTP-anslag fra målte watt og følg utviklingen når du tester igjen.</p>
    <div className="ramp-protocols" role="group" aria-label="Velg rampprotokoll">
      <button type="button" className={!gentle ? 'selected' : ''} aria-pressed={!gentle} onClick={() => setProtocol(STANDARD_RAMP_PROTOCOL)}><span>Standard { !gentle && <Check size={17} />}</span><strong>100 W <small>+20 W/min</small></strong><span>Jevne, tydelige trinn</span></button>
      <button type="button" className={gentle ? 'selected' : ''} aria-pressed={gentle} onClick={() => setProtocol(GENTLE_RAMP_PROTOCOL)}><span>Rolig start {gentle && <Check size={17} />}</span><strong>50 W <small>+10 W/min</small></strong><span>Lavere start og mindre økning</span></button>
    </div>
    <RampPreview protocol={protocol} />
    <div className="ramp-preparation"><div><b>01 · Gjør deg klar</b><p>Koble til wattmåleren. Bruk samme sykkel og protokoll når du sammenligner tester.</p></div><div><b>02 · Følg wattmålet</b><p>Sitt på setet med jevn kadens. Juster selv tråkk og motstand på Xebex. Unngå spurter.</p></div><div><b>03 · Avslutt rampen</b><p>Trykk «Jeg klarer ikke mer» når du ikke klarer målet. Tråkk deretter rolig ned.</p></div></div>
    <p className="ramp-test-rules">Etter to minutter i rampen avsluttes den også automatisk hvis målt effekt holder seg under 80 % av målet i ti sekunder. Pauser i rampen gjør FTP-anslaget ugyldig. Ingen trinn kan hoppes over.</p>
    <div className="ramp-actions"><button type="button" className="ramp-primary" disabled={disabled} onClick={() => onStart(protocol, false)}>Start FTP-test <ArrowRight size={18} /></button><button type="button" className="ramp-secondary" disabled={disabled} onClick={() => onStart(protocol, true)}><FlaskConical size={16} /> Prøv ramptest i demo</button></div>
    {previous && <button type="button" className="ramp-repeat-link" disabled={disabled} onClick={() => onStart(previous.protocol, false)}><Repeat2 size={16} /> Gjenta protokollen fra {dateLabel(previous.date)} · {protocolLabel(previous.protocol)}</button>}
    <p className="ramp-footnote">FTP anslås til 75 % av dine beste sammenhengende 60 målte sekunder i rampen. Testen er et anslag; du velger selv om den skal oppdatere dagens FTP på {ftp} W. Stopp hvis du føler deg uvel.</p>
  </section>;
}

export interface RampTestResultProps {
  ride: RideRecord;
  history: RideRecord[];
  onApply: (ftp: number) => void;
  onRepeat: (protocol: RampProtocol) => void;
  canApply: boolean;
  currentFtp: number;
}

export function RampTestResult({ ride, history, onApply, onRepeat, canApply, currentFtp }: RampTestResultProps) {
  const result = useMemo(() => analyzeRampTest(ride), [ride]);
  const previous = useMemo(() => !result ? undefined : sortResults(history).filter(other => other.valid && !other.demo && other.rideId !== result.rideId && other.protocolKey === result.protocolKey && Date.parse(other.date) < Date.parse(result.date)).at(-1), [history, result]);
  if (!result) return null;
  const usable = result.valid && !result.demo && result.estimatedFtp !== null;
  const delta = usable && previous?.estimatedFtp != null ? result.estimatedFtp! - previous.estimatedFtp : null;
  return <section className={`ramp-panel ramp-result ${usable ? 'ramp-result-valid' : ''}`} aria-labelledby="ramp-result-title">
    <div className="ramp-heading"><span className="ramp-icon"><Gauge size={23} /></span><div><span className="ramp-eyebrow">{protocolLabel(result.protocol)}</span><h2 id="ramp-result-title">{result.demo ? 'Ramptest · demo' : 'Din ramptest'}</h2></div><span className="ramp-pill">{dateLabel(result.date)}</span></div>
    <div className="ramp-result-hero"><div><span>{usable ? 'FTP-anslag' : result.demo ? 'Simulert forhåndsvisning' : 'Ingen gyldig FTP'}</span><strong>{usable ? result.estimatedFtp : result.demo && result.previewFtp !== null ? result.previewFtp : '—'}<small>{usable || (result.demo && result.previewFtp !== null) ? ' W' : ''}</small></strong></div><div className="ramp-result-comparison">{delta !== null ? <><TrendingUp size={22} /><b>{changeLabel(delta)}</b><span>fra {dateLabel(previous!.date)}<br />Samme rampprotokoll</span></> : <><b>{usable ? 'Ditt nye målepunkt' : result.demo ? 'Øving uten formdata' : 'Økten er fortsatt lagret'}</b><span>{usable ? 'Gjenta samme protokoll for å se utviklingen.' : reasonLabel(result.reason)}</span></>}</div></div>
    <div className="ramp-metrics"><div><span>Beste målte 60 s</span><strong>{result.best60Watts === null ? '—' : `${Math.round(result.best60Watts)} W`}</strong></div><div><span>Fullførte trinn</span><strong>{result.completedStages}</strong></div><div><span>Wattdekning i rampen</span><strong>{Math.round(result.coverage)} %</strong></div><div><span>Tid i rampen</span><strong>{Math.floor(result.rampSeconds / 60)}:{String(Math.floor(result.rampSeconds % 60)).padStart(2, '0')}</strong></div></div>
    {(result.demo || !result.valid) && <p className="ramp-notice">{result.demo ? 'Demo bruker simulerte watt og teller ikke i FTP-utviklingen. Resultatet kan ikke brukes som personlig FTP.' : reasonLabel(result.reason)}</p>}
    {result.issues.length > 0 && <ul className="ramp-issues">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <div className="ramp-actions">{usable && <button type="button" className="ramp-primary" disabled={!canApply || currentFtp === result.estimatedFtp || result.estimatedFtp! < 50 || result.estimatedFtp! > 600} onClick={() => onApply(result.estimatedFtp!)}>{currentFtp === result.estimatedFtp ? <><Check size={17} /> Din FTP er {currentFtp} W</> : `Bruk ${result.estimatedFtp} W som FTP`}</button>}<button type="button" className="ramp-secondary" onClick={() => onRepeat(result.protocol)}><Repeat2 size={17} /> Gjenta denne testen</button></div>
    {usable && (result.estimatedFtp! < 50 || result.estimatedFtp! > 600) && <p className="ramp-notice">Profilen støtter FTP fra 50 til 600 W. Dette anslaget kan derfor ikke tas i bruk i profilen.</p>}
    {usable && <p className="ramp-footnote">75 % av beste målte 60 sekunder. Et FTP-anslag, ikke en garanti for hva du kan holde i en time. {currentFtp !== result.estimatedFtp ? `Dagens FTP er ${currentFtp} W og endres først når du velger det.` : 'Fremtidige økter bruker din valgte FTP.'}</p>}
  </section>;
}

export function RampTestProgress({ history, onRepeat }: { history: RideRecord[]; onRepeat: (protocol: RampProtocol) => void }) {
  const results = useMemo(() => sortResults(history), [history]);
  const [filter, setFilter] = useState('latest');
  const latest = results.filter(result => result.valid && !result.demo).at(-1);
  const selectedFilter = filter === 'latest' ? (latest?.protocolKey === rampProtocolKey(GENTLE_RAMP_PROTOCOL) ? 'gentle' : 'standard') : filter;
  const protocol = selectedFilter === 'gentle' ? GENTLE_RAMP_PROTOCOL : STANDARD_RAMP_PROTOCOL;
  const key = rampProtocolKey(protocol);
  const points = comparableRampHistory(history, key);
  const excluded = results.filter(result => result.demo || !result.valid);
  const first = points[0], last = points.at(-1);
  const values = points.map(point => point.estimatedFtp!);
  const min = Math.floor((Math.min(...(values.length ? values : [200])) - 20) / 20) * 20;
  const max = Math.ceil((Math.max(...(values.length ? values : [200])) + 20) / 20) * 20;
  const startDate = first ? Date.parse(first.date) : 0, endDate = last ? Date.parse(last.date) : 1;
  const x = (date: string) => points.length === 1 ? 332 : 52 + (Date.parse(date) - startDate) / Math.max(1, endDate - startDate) * 560;
  const y = (value: number) => 156 - (value - min) / (max - min) * 126;
  return <section className="ramp-panel ramp-progress" aria-labelledby="ramp-progress-title">
    <div className="ramp-heading"><span className="ramp-icon"><TrendingUp size={23} /></span><div><span className="ramp-eyebrow">SAMMENLIGN LIKE TESTER</span><h2 id="ramp-progress-title">FTP over tid</h2></div></div>
    <div className="ramp-progress-controls"><label>Rampprotokoll<select aria-label="Rampprotokoll" value={selectedFilter} onChange={event => setFilter(event.target.value)}><option value="standard">Standard · 100 W / +20 W</option><option value="gentle">Rolig · 50 W / +10 W</option></select></label>{last && <button type="button" className="ramp-secondary" onClick={() => onRepeat(last.protocol)}><Repeat2 size={16} /> Test igjen</button>}</div>
    {!points.length ? <div className="ramp-empty"><Gauge size={30} /><h3>Din første test blir startstreken</h3><p>Fullfør en ramptest med målte watt. Neste gyldige test med samme protokoll viser endringen her.</p><button type="button" className="ramp-secondary" onClick={() => onRepeat(protocol)}>Klargjør ramptest <ArrowRight size={16} /></button></div> : <>
      <div className="ramp-trend-summary"><strong>{last!.estimatedFtp}<small> W sist</small></strong><span>{points.length > 1 ? `${changeLabel(last!.estimatedFtp! - first.estimatedFtp!)} siden ${dateLabel(first.date)}` : 'Første gyldige målepunkt'}<small>{points.length} {points.length === 1 ? 'test' : 'tester'} · {protocolLabel(protocol)}</small></span></div>
      <figure className="ramp-trend-chart"><svg viewBox="0 0 640 190" role="img" aria-label={`FTP-utvikling for ${protocolLabel(protocol)}. ${points.length} gyldige tester. Detaljer i tabellen under.`}>{[min, (max + min) / 2, max].map(value => <g key={value}><line x1="52" x2="612" y1={y(value)} y2={y(value)} className="ramp-chart-grid" /><text x="40" y={y(value) + 4} textAnchor="end">{value}</text></g>)}<path className="ramp-trend-line" d={points.map((point, index) => `${index ? 'L' : 'M'}${x(point.date)},${y(point.estimatedFtp!)}`).join(' ')} />{points.map(point => <circle key={point.rideId} cx={x(point.date)} cy={y(point.estimatedFtp!)} r="5" className="ramp-trend-dot"><title>{dateLabel(point.date)}: {point.estimatedFtp} W</title></circle>)}<text x="52" y="181">{dateLabel(first.date)}</text>{points.length > 1 && <text x="612" y="181" textAnchor="end">{dateLabel(last!.date)}</text>}</svg></figure>
      <div className="ramp-table-wrap"><table><caption>Gyldige målte tester · endring fra forrige test med samme protokoll</caption><thead><tr><th scope="col">Dato</th><th scope="col">FTP</th><th scope="col">Endring</th><th scope="col">Beste 60 s</th></tr></thead><tbody>{points.map((point, index) => <tr key={point.rideId}><th scope="row">{dateLabel(point.date)}</th><td>{point.estimatedFtp} W</td><td>{index ? changeLabel(point.deltaWatts!) : 'Første test'}</td><td>{Math.round(point.best60Watts!)} W</td></tr>).reverse()}</tbody></table></div>
      <p className="ramp-footnote">Bare gyldige tester med samme protokoll sammenlignes. Bruk samme sykkel, kalibrering og omtrent like forhold; små endringer kan være vanlig variasjon.</p>
    </>}
    {excluded.length > 0 && <details className="ramp-excluded"><summary>Øvrige tester · {excluded.length} utenfor utviklingskurven</summary><ul>{excluded.slice().reverse().map(result => <li key={result.rideId}><strong>{dateLabel(result.date)} · {result.demo ? 'Demo' : 'Ikke gyldig FTP'}</strong><span>{protocolLabel(result.protocol)} · {result.demo ? 'Simulerte data teller ikke som formutvikling.' : result.issues.join(' ')}</span></li>)}</ul></details>}
  </section>;
}
