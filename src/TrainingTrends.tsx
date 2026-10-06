import { useEffect, useMemo, useRef, useState } from 'react';
import type { RideRecord } from './storage';
import { durationLabel, powerCurve, rollingLoad, weeklyLoad } from './trends';
import './trends.css';

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function WeeklyLoad({ history }: { history: RideRecord[] }) {
  const weeks = useMemo(() => weeklyLoad(history, 8), [history]);
  const peak = Math.max(60, ...weeks.map(w => w.tss));
  const current = weeks[weeks.length - 1];
  const prior = weeks.slice(0, -1).filter(w => w.rides > 0);
  const typical = prior.length ? Math.round(prior.reduce((a, w) => a + w.tss, 0) / prior.length) : null;
  const unknown = weeks.reduce((a, w) => a + w.unknownLoad, 0);
  const rolling = useMemo(() => rollingLoad(history, 28), [history]);
  const last7days = useMemo(() => history.filter(r => !r.demo && Date.now() - Date.parse(r.date) < 7 * 86400000).reduce((a, r) => a + r.seconds / 60, 0), [history]);
  return <article className="trend-card">
    <header><span className="trend-eyebrow">Belastning</span><h3>Uke for uke</h3></header>
    <p className="trend-lead">
      Denne uken: <b>{current.rides} {current.rides === 1 ? 'økt' : 'økter'}</b> · <b>{current.minutes} min</b> · <b>{current.tss} TSS</b>
      {typical !== null && <span> · snitt i aktive uker {typical} TSS</span>}
    </p>
    <div className="week-chart" role="img" aria-label={`Treningsbelastning siste ${weeks.length} uker`}>
      {weeks.map(week => <div key={week.start.toISOString()} className={`week-col ${week.current ? 'current' : ''} ${week.rides ? '' : 'empty'}`}>
        <span className="week-value">{week.tss || ''}</span>
        <div className="week-bar"><i style={{ height: `${week.tss ? Math.max(4, (week.tss / peak) * 100) : 0}%` }} /></div>
        <span className="week-label">uke {isoWeek(week.start)}</span>
        <span className="week-min">{week.minutes ? `${week.minutes} min` : '–'}</span>
      </div>)}
    </div>
    <div className="curve-keys load-keys">
      <span><em>Siste 7 dager</em><b>{Math.round(last7days)}</b><small>min</small></span>
      <span><em>Siste 28 dager</em><b>{rolling.recent}</b><small>TSS</small></span>
      <span><em>Snitt per uke</em><b>{Math.round(rolling.recent / 4)}</b><small>TSS</small></span>
      <span><em>Mot 28 dager før</em><b>{rolling.change === null ? '—' : `${rolling.change > 0 ? '+' : ''}${rolling.change}`}</b>{rolling.change !== null && <small>%</small>}</span>
    </div>
    <p className="trend-note">TSS beregnes fra målte watt og FTP på økttidspunktet (normalisert effekt). Demoturer teller ikke{unknown ? `; ${unknown} ${unknown === 1 ? 'økt' : 'økter'} uten wattdata har ukjent belastning` : ''}.</p>
  </article>;
}

const W_TICKS = [5, 30, 60, 300, 1200, 3600];

function PowerCurve({ history }: { history: RideRecord[] }) {
  const all = useMemo(() => powerCurve(history), [history]);
  const recent = useMemo(() => powerCurve(history, { sinceDays: 42 }), [history]);
  const [frame, width] = useWidth<HTMLDivElement>(520);
  const [hover, setHover] = useState<number | null>(null);
  const known = all.filter(p => p.watts !== null);
  if (!known.length) return <article className="trend-card">
    <header><span className="trend-eyebrow">Effektkurve</span><h3>Beste watt over tid</h3></header>
    <p className="trend-empty">Kurven tegnes fra økter med målte watt. Fullfør én økt med sykkelen tilkoblet, så får du ditt første punkt for 5 sekunder til 20 minutter.</p>
  </article>;
  const H = 230, L = 40, R = 14, T = 16, B = 30, plotW = width - L - R, plotH = H - T - B;
  const lmin = Math.log(5), lmax = Math.log(3600);
  const x = (s: number) => L + ((Math.log(s) - lmin) / (lmax - lmin)) * plotW;
  const top = Math.ceil(Math.max(...known.map(p => p.watts!)) * 1.1 / 50) * 50;
  const y = (w: number) => T + plotH - (w / top) * plotH;
  const path = (points: typeof all) => points.filter(p => p.watts !== null).map((p, i) => `${i ? 'L' : 'M'}${x(p.seconds).toFixed(1)},${y(p.watts!).toFixed(1)}`).join('');
  const point = hover === null ? null : all[hover];
  const recentPoint = hover === null ? null : recent[hover];
  return <article className="trend-card">
    <header><span className="trend-eyebrow">Effektkurve</span><h3>Beste watt over tid</h3></header>
    <p className="trend-lead"><span className="lg lg-all" />Alle økter <span className="lg lg-recent" />Siste 6 uker</p>
    <div className="curve-frame" ref={frame}>
      <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Effektkurve: beste gjennomsnittlige watt for varigheter fra 5 sekunder til 60 minutter"
        onPointerLeave={() => setHover(null)}
        onPointerMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width * width;
          let best = 0;
          all.forEach((p, i) => { if (Math.abs(x(p.seconds) - px) < Math.abs(x(all[best].seconds) - px)) best = i; });
          setHover(best);
        }}>
        {[0, 0.5, 1].map(f => <g key={f}><line x1={L} x2={width - R} y1={y(top * f)} y2={y(top * f)} className="curve-grid" /><text x={L - 6} y={y(top * f) + 4} textAnchor="end">{Math.round(top * f)}</text></g>)}
        {W_TICKS.filter(s => width >= 420 || s !== 30).map(s => <text key={s} x={x(s)} y={H - 8} textAnchor="middle">{durationLabel(s)}</text>)}
        <path d={path(all)} className="curve-all" />
        <path d={path(recent)} className="curve-recent" />
        {all.map(p => p.watts !== null && <circle key={p.seconds} cx={x(p.seconds)} cy={y(p.watts)} r="3" className="curve-dot" />)}
        {point?.watts != null && <line x1={x(point.seconds)} x2={x(point.seconds)} y1={T} y2={T + plotH} className="curve-cursor" />}
      </svg>
      {point && <div className="curve-tip" style={{ left: `${Math.min(80, Math.max(20, x(point.seconds) / width * 100))}%` }}>
        <b>{durationLabel(point.seconds)}</b>
        <span>Alle: <strong>{point.watts ?? '—'}{point.watts !== null && ' W'}</strong>{point.date && ` · ${new Date(point.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}`}</span>
        <span>6 uker: <strong>{recentPoint?.watts ?? '—'}{recentPoint?.watts != null && ' W'}</strong></span>
      </div>}
    </div>
    <div className="curve-keys">{[5, 60, 300, 1200].map(s => { const p = all.find(q => q.seconds === s)!; return <span key={s}><em>{durationLabel(s)}</em><b>{p.watts ?? '—'}</b>{p.watts !== null && <small>W</small>}</span>; })}</div>
  </article>;
}

/** Longitudinal view: weekly load and the mean-maximal power curve. */
export function TrainingTrends({ history }: { history: RideRecord[] }) {
  return <section className="training-trends" aria-label="Treningsutvikling">
    <WeeklyLoad history={history} />
    <PowerCurve history={history} />
  </section>;
}
