import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, X } from 'lucide-react';
import { analyzeRide, measuredSamples } from './analytics';
import { normalizedPower, pacing, sampleAverages, trainingLoad, verdict, type Tone } from './reportInsights';
import { SessionAnalysis } from './SessionAnalysis';
import { ReportChart } from './ReportChart';
import { RideAnalysis } from './ProgressPanel';
import { RideSurvey } from './RideSurvey';
import { ShareCardButton } from './ShareCardButton';
import type { RideRecord, RideSample } from './storage';
import { formatTime, zones } from './training';
import { worldById } from './worlds';
import './ride-report.css';

function ScoreRing({ value, tone }: { value: number | null; tone: Tone }) {
  const r = 52, c = 2 * Math.PI * r;
  return <div className={`score-ring tone-${tone}`} role="img" aria-label={value === null ? 'Ingen treffsikkerhet' : `${value} prosent av hoveddelen i målområdet`}>
    <svg viewBox="0 0 128 128" aria-hidden="true">
      <circle cx="64" cy="64" r={r} className="ring-track" />
      {value !== null && <circle cx="64" cy="64" r={r} className="ring-value" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 64 64)" />}
    </svg>
    <span><strong>{value ?? '—'}{value !== null && <small>%</small>}</strong><em>hoveddel i mål</em></span>
  </div>;
}

function MiniGauge({ mean, target }: { mean: number; target: number }) {
  const pos = Math.min(1, Math.max(0, (mean / target - 1 + 0.3) / 0.6));
  return <span className="mini-gauge" aria-hidden="true"><i className="mini-band" /><b style={{ left: `${pos * 100}%` }} /></span>;
}

/**
 * Full-page post-ride report. `ramp` switches to FTP-test mode: the ramp result
 * replaces the target-adherence verdict, interval cards and workout comparison.
 */
export function RideReport({ ride, samples, history, onClose, onHistory, onFit, onCsv, csvLabel, fitDisabled, fitTitle, ramp, achievements, rewards }: {
  ride: RideRecord; samples: RideSample[]; history: RideRecord[];
  onClose: () => void; onHistory: () => void; onFit: () => void; onCsv: () => void; csvLabel: string;
  fitDisabled: boolean; fitTitle?: string; ramp?: ReactNode; achievements?: ReactNode; rewards?: ReactNode;
}) {
  const analysis = useMemo(() => analyzeRide({ ...ride, samples }, history), [ride, samples, history]);
  const execution = analysis.execution;
  const measured = useMemo(() => ride.demo ? [] : measuredSamples(samples, ride.seconds), [ride, samples]);
  const np = useMemo(() => ride.demo ? null : normalizedPower(samples, ride.seconds), [ride, samples]);
  const load = trainingLoad(np, measured.length, ride.ftp);
  const avg = useMemo(() => sampleAverages(ride.demo ? [] : samples, ride.seconds), [ride, samples]);
  const adherence = execution.work.adherence ?? execution.overall.adherence;
  const workCount = execution.intervals.filter(i => i.kind === 'work').length;
  const judged = ramp ? { title: 'FTP-test', detail: 'Resultatet bygger på beste målte 60 sekunder i rampen. Målegrunnlaget står under.', tone: 'neutral' as Tone } : verdict({ demo: ride.demo, adherence, measuredSeconds: execution.measuredSeconds, completedWork: execution.completedWorkIntervals, workCount, skippedSeconds: execution.skippedSeconds });
  const pace = ride.demo || ramp ? null : pacing(execution.intervals);
  const work = ramp ? [] : execution.intervals.filter(i => i.kind === 'work' && i.observedSeconds > 0);
  const world = ride.worldId ? worldById(ride.worldId) : null;
  const zoneTotal = ride.zoneSeconds.reduce((a, b) => a + b, 0);
  const status = ride.demo ? 'Demotur' : ride.completed ? 'Fullført' : 'Avsluttet tidlig';
  const shareInput = { ride, samples, verdict: judged.title, tone: judged.tone, np, tss: load?.tss ?? null, adherence: ride.demo || ramp ? null : adherence, worldName: world?.name };
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [ride.id]);

  const metrics: { label: string; value: ReactNode; unit?: string; sub?: string }[] = [
    { label: 'Tid', value: formatTime(ride.seconds), sub: execution.plannedSeconds ? `plan ${execution.plannedTimeEstimated ? '≈ ' : ''}${formatTime(execution.plannedSeconds)}` : undefined },
    { label: 'Snitteffekt', value: ride.avgPower || '—', unit: ride.avgPower ? 'W' : undefined, sub: avg.maxPower ? `maks ${avg.maxPower} W` : undefined },
    { label: 'Normalisert effekt', value: np ?? '—', unit: np ? 'W' : undefined, sub: load ? `IF ${load.intensity.toFixed(2)}` : 'krever 10 min målt' },
    { label: 'Belastning', value: load?.tss ?? '—', unit: load ? 'TSS' : undefined, sub: load ? 'fra målte watt' : undefined },
    { label: 'Arbeid', value: Math.round(ride.energy), unit: 'kJ' },
    { label: 'Puls', value: avg.heartRate ?? '—', unit: avg.heartRate ? 'bpm' : undefined, sub: avg.maxHeartRate ? `maks ${avg.maxHeartRate}` : 'ingen pulsdata' },
    { label: 'Kadens', value: avg.cadence ?? '—', unit: avg.cadence ? 'rpm' : undefined },
    { label: 'Distanse', value: ride.distance.toFixed(1), unit: 'km', sub: 'virtuell, fra watt' },
  ];

  return <div className="ride-report" role="dialog" aria-modal="true" aria-label="Øktrapport">
    <div className="report-inner">
      <header className="report-bar">
        <span className="report-brand">Øktrapport</span>
        <div>
          <ShareCardButton input={shareInput} variant="chip" />
          <button className="report-chip" onClick={onFit} disabled={fitDisabled} title={fitTitle}><ArrowDownToLine size={15} />FIT</button>
          <button ref={closeRef} className="report-close" onClick={onClose} aria-label="Lukk"><X size={20} /></button>
        </div>
      </header>

      <section className={`report-hero tone-${judged.tone}`} style={{ ['--world' as string]: world?.color ?? '#f48468' }}>
        <div className="hero-copy">
          <span className="hero-eyebrow">{status} · {new Date(ride.date).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}{world ? ` · ${world.name}` : ''}</span>
          <h1>{ride.name}</h1>
          <h2>{judged.title}</h2>
          <p>{judged.detail}</p>
          {pace && <p className={`pace-note tone-${pace.tone}`}>{pace.text}</p>}
        </div>
        {!ramp && <ScoreRing value={ride.demo ? null : adherence} tone={judged.tone} />}
      </section>

      <section className="report-metrics" aria-label="Nøkkeltall">
        {metrics.map(m => <div key={m.label}><span>{m.label}</span><strong>{m.value}{m.unit && <small> {m.unit}</small>}</strong>{m.sub && <em>{m.sub}</em>}</div>)}
      </section>

      <RideSurvey key={ride.id} ride={ride} history={history} />

      {ramp ? <>
        {ramp}
        {!ride.demo && samples.length > 0 && <section className="report-chart-panel"><ReportChart samples={samples} seconds={ride.seconds} ftp={ride.ftp} /></section>}
      </> : <SessionAnalysis ride={ride} samples={samples} history={history} report />}

      {work.length > 0 && <section className="report-intervals" aria-label="Dragene">
        <div className="report-section-head"><h3>Dragene</h3><span>Snitt mot mål · andel sekunder innenfor ±10 %</span></div>
        <div className={`interval-cards ${work.length > 16 ? 'dense' : ''}`}>
          {work.map((interval, n) => {
            const tone = interval.adherence === null ? 'neutral' : interval.adherence >= 90 ? 'great' : interval.adherence >= 75 ? 'good' : interval.adherence >= 50 ? 'mixed' : 'off';
            return <article key={interval.index} className={`interval-card tone-${tone}`}>
              <header><span>{work.length > 1 ? `${n + 1}` : interval.label}</span><b>{interval.adherence ?? '—'}{interval.adherence !== null && '%'}</b></header>
              <strong>{interval.meanPower ?? '—'}<small> W</small></strong>
              <em>mål {interval.targetPower} W · {formatTime(interval.observedSeconds)}{interval.coverage < 0.95 ? ' · delvis målt' : ''}</em>
              {interval.meanPower !== null && <MiniGauge mean={interval.meanPower} target={interval.targetPower} />}
            </article>;
          })}
        </div>
      </section>}

      {zoneTotal > 0 && <section className="report-zones" aria-label="Tid i sonene">
        <div className="report-section-head"><h3>Tid i sonene</h3><span>{ride.demo ? 'Simulerte watt' : 'Målte watt mot FTP ' + ride.ftp + ' W'}</span></div>
        <div className="zone-stack" aria-hidden="true">{zones.map((z, i) => ride.zoneSeconds[i] > 0 && <i key={z.id} style={{ flex: ride.zoneSeconds[i], background: z.color }} title={`Z${z.id} ${z.name}`} />)}</div>
        <ul className="zone-legend">{zones.map((z, i) => <li key={z.id} className={ride.zoneSeconds[i] ? '' : 'empty'}>
          <i style={{ background: z.color }} /><span>Z{z.id} {z.name}</span><b>{formatTime(ride.zoneSeconds[i])}</b><em>{Math.round((ride.zoneSeconds[i] / zoneTotal) * 100)} %</em>
        </li>)}</ul>
      </section>}

      {!ramp && <RideAnalysis ride={ride} history={history} />}
      {achievements}
      {rewards && <details className="summary-game-details"><summary>Spillresultat og ekspedisjon</summary>{rewards}</details>}

      <footer className="report-actions">
        <button className="primary" onClick={onHistory}>Se min utvikling <ArrowRight size={17} /></button>
        <button className="secondary" onClick={onFit} disabled={fitDisabled} title={fitTitle}><ArrowDownToLine size={16} />Last ned FIT-fil</button>
        <ShareCardButton input={shareInput} variant="secondary" />
        <button className="text-button" onClick={onCsv}><ArrowDownToLine size={15} />{csvLabel}</button>
      </footer>
    </div>
  </div>;
}
