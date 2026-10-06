import { useMemo } from 'react';
import { Activity, Target } from 'lucide-react';
import { analyzeRide, measuredSamples, type PowerSample } from './analytics';
import type { RideRecord, RideSample } from './storage';
import { formatTime } from './training';
import { ReportChart } from './ReportChart';
import './session-analysis.css';

function PowerPlot({ samples, seconds }: { samples: RideSample[]; seconds: number }) {
  const clean = measuredSamples(samples, seconds);
  if (!clean.length) return null;
  const max = Math.max(100, Math.ceil(clean.reduce((peak, sample) => Math.max(peak, sample.power, Number.isFinite(sample.targetPower) ? sample.targetPower! : 0), 0) / 100) * 100);
  const x = (second: number) => 42 + second / Math.max(seconds, 1) * 626;
  const y = (power: number) => 151 - power / max * 130;
  const chunks: PowerSample[][] = [];
  for (const sample of clean) {
    const chunk = chunks.at(-1), last = chunk?.at(-1);
    if (!last || sample.second !== last.second + 1 || (sample.wallSecond !== undefined && last.wallSecond !== undefined && sample.wallSecond - last.wallSecond > 2.5)) chunks.push([sample]);
    else chunk!.push(sample);
  }
  const stride = Math.max(1, Math.ceil(clean.length / 700));
  const paths = chunks.map(chunk => chunk.filter((_, index) => index % stride === 0 || index === chunk.length - 1));
  return <figure className="session-power-plot">
    <figcaption><b>Watt gjennom økten</b><span><i /> Målt <i className="target" /> Mål</span></figcaption>
    <svg viewBox="0 0 684 181" role="img" aria-label="Målt effekt mot wattmål gjennom aktiv økttid. Datagap og pauser bryter den målte kurven.">
      {[0, max / 2, max].map(value => <g key={value}><line x1="42" x2="668" y1={y(value)} y2={y(value)} className="plot-grid" /><text x="34" y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      {paths.map((chunk, index) => <g key={index}>
        <path className="target-line" d={chunk.reduce((path, sample, point) => {
          if (sample.targetPower === undefined || !Number.isFinite(sample.targetPower)) return path;
          const previousHasTarget = point > 0 && Number.isFinite(chunk[point - 1].targetPower);
          return path + `${previousHasTarget ? 'L' : 'M'}${x(sample.second).toFixed(1)},${y(sample.targetPower).toFixed(1)} `;
        }, '')} />
        <path className="power-line" d={chunk.map((sample, point) => `${point ? 'L' : 'M'}${x(sample.second).toFixed(1)},${y(sample.power).toFixed(1)}`).join(' ')} />
        {chunk.length === 1 && <circle cx={x(chunk[0].second)} cy={y(chunk[0].power)} r="2" fill="#65e1dc" />}
      </g>)}
      <text x="42" y="173">0:00</text><text x="355" y="173" textAnchor="middle">Aktiv tid · pauser utelatt</text><text x="668" y="173" textAnchor="end">{formatTime(seconds)}</text>
    </svg>
  </figure>;
}

/** Measured training execution comes before game rewards in the session summary. */
export function SessionAnalysis({ ride, samples, history, report = false }: { ride: RideRecord; samples: RideSample[]; history: RideRecord[]; report?: boolean }) {
  const analysis = useMemo(() => analyzeRide({ ...ride, samples }, history), [ride, samples, history]);
  const execution = analysis.execution;
  const percent = (value: number | null) => value === null ? '—' : `${value} %`;
  return <section className="session-analysis" aria-labelledby="session-analysis-title">
    <div className="session-analysis-heading"><Activity size={19} /><div><span>MÅLT GJENNOMFØRING</span><h3 id="session-analysis-title">Slik traff du økten</h3></div></div>
    {ride.demo ? <p className="analysis-notice">Dette var en demo. Simulerte watt gir verken formutvikling, FTP-anslag eller prestasjonsopplåsinger.</p> : <>
      <div className="execution-metrics">
        <div><span>{execution.plannedTimeEstimated ? 'Syklet / tidsanslag' : 'Syklet / planlagt'}</span><strong>{formatTime(execution.activeSeconds)} <small>/ {execution.plannedSeconds === null ? 'ukjent' : formatTime(execution.plannedSeconds)}</small></strong></div>
        <div><span>Wattdekning</span><strong>{Math.round(execution.coverage * 100)} %</strong><small>{formatTime(execution.measuredSeconds)} målt</small></div>
        <div><span>Innenfor målet</span><strong>{percent(execution.overall.adherence)}</strong><small>±10 % av wattmålet</small></div>
      </div>
      <p className="execution-accounting">{execution.plannedTimeEstimated ? `Planlagt tid er et anslag ved 30 km/t. Distanseblokker avsluttes etter syklet virtuell distanse. ${execution.skippedBlockCount ? `${execution.skippedBlockCount} deler ble hoppet over. ` : ''}` : ''}{execution.skippedSeconds > 0 ? `${formatTime(execution.skippedSeconds)} av planen ble hoppet over. ` : ''}{(execution.notRiddenSeconds ?? 0) > 0 ? `${formatTime(execution.notRiddenSeconds!)} av planen gjensto ved avslutning. ` : ''}Pauser og hopp teller ikke som syklet tid. Treffsikkerhet gjelder bare målte sekunder med kjent mål.</p>
      {!execution.measuredSeconds ? <p className="analysis-notice">Ingen gyldige wattmålinger. Økten er lagret, men effekten og gjennomføringen kan ikke vurderes.</p> : <>
        {execution.coverage < 1 && <p className="analysis-notice">Datagap: {formatTime(Math.max(0, Math.floor(ride.seconds) - execution.measuredSeconds))} uten gyldige watt. Manglende data fylles ikke med null eller godkjente sekunder.</p>}
        {report ? <ReportChart samples={samples} seconds={ride.seconds} ftp={ride.ftp} /> : <PowerPlot samples={samples} seconds={ride.seconds} />}
        <div className="phase-accuracy"><span><Target size={15} /> Hoveddel: <b>{percent(execution.work.adherence)}</b><small>{formatTime(execution.work.targetSeconds)} med mål</small></span><span>Aktive pauser: <b>{percent(execution.recovery.adherence)}</b><small>{formatTime(execution.recovery.targetSeconds)} med mål</small></span></div>
        {execution.unmappedSeconds > 0 && <p className="analysis-notice">{formatTime(execution.unmappedSeconds)} målinger mangler plassering i planen. Eldre økter med hopp kan derfor ikke fordeles sikkert per drag.</p>}
        {execution.plannedTimeEstimated && <p className="execution-accounting">Watt lagres én gang per sekund. Svært korte distanseblokker kan mangle egne målinger. Målt tid per del begrenses til faktisk syklet tid; sekundmålinger ved et faseskifte kan ikke beskrive begge fasene fullt ut.</p>}
        {!!execution.intervals.length && <details className="interval-analysis" open={!report && execution.intervals.length <= 12}>
          <summary>Se gjennomføring per del av økten ({execution.intervals.length})</summary>
          <div className="interval-table-scroll"><table><thead><tr><th>Del</th><th>{ride.blockSeconds ? 'Målt / syklet · plan' : 'Målt / plan'}</th><th>Snitt / mål</th><th>Treffsikkerhet</th></tr></thead><tbody>
            {execution.intervals.map(interval => <tr key={interval.index} className={`interval-${interval.kind}`}>
              <th scope="row"><span>{interval.index + 1}.</span> {interval.label}</th>
              <td>{formatTime(interval.observedSeconds)} / {formatTime(interval.activeSeconds ?? interval.plannedSeconds)}
                {interval.plannedDistanceMeters !== null
                  ? <small>{Math.round(interval.actualDistanceMeters ?? 0)} / {interval.plannedDistanceMeters} m virtuelt · {formatTime(interval.plannedSeconds)} tidsanslag</small>
                  : interval.activeSeconds !== null && <small>Plan: {formatTime(interval.plannedSeconds)}</small>}
                <small>{Math.round(interval.coverage * 100)} % målt{interval.skipped ? ' · hoppet over' : ''}</small></td>
              <td>{interval.meanPower === null ? '—' : interval.meanPower} / {interval.targetPower} W</td>
              <td>{percent(interval.adherence)}<small>{!interval.observedSeconds ? 'Ingen målinger' : interval.coverage < 0.95 ? 'Delvis målt' : 'God dekning'}</small></td>
            </tr>)}
          </tbody></table></div>
        </details>}
        {!analysis.comparison && <p className="execution-accounting">Sammenligning krever en tidligere målt økt med samme øktplan og FTP, minst 95 % wattdekning, tilsvarende varighet og samme hopp. Spillpoeng måler ikke fysisk fremgang.</p>}
      </>}
    </>}
  </section>;
}
