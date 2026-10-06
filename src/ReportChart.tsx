import { useEffect, useMemo, useRef, useState } from 'react';
import type { PowerSample } from './analytics';
import { smoothedSeries } from './reportInsights';
import { formatTime, zones } from './training';

const L = 44, R = 44, T = 14, B = 32;

/**
 * Measured power against the ±10 % target band, coloured by training zone,
 * with heart rate on its own axis. Hover or touch to read any second.
 * Exactly one <svg> lives in this figure (the sensor smoke test counts it).
 */
export function ReportChart({ samples, seconds, ftp }: { samples: PowerSample[]; seconds: number; ftp: number }) {
  const series = useMemo(() => smoothedSeries(samples, seconds), [samples, seconds]);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // Draw at the real pixel width so labels stay legible on phones.
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = W < 640 ? 240 : 300;
  const plotW = W - L - R, plotH = H - T - B;
  const geometry = useMemo(() => {
    if (!series.length) return null;
    const peak = Math.max(...series.map(p => Math.max(p.power, (p.target ?? 0) * 1.12)));
    const max = Math.max(100, Math.ceil(peak / 50) * 50);
    const span = Math.max(1, seconds);
    const x = (s: number) => L + (s / span) * plotW;
    const y = (w: number) => T + plotH - (Math.max(0, w) / max) * plotH;
    let area = '', line = '', band = '', target = '';
    let runStart = 0;
    const flushBand = (from: number, to: number) => {
      const pts = series.slice(from, to).filter(p => p.target);
      if (pts.length < 2) return;
      band += `M${pts.map(p => `${x(p.second).toFixed(1)},${y(p.target! * 1.1).toFixed(1)}`).join('L')}`;
      band += `L${pts.slice().reverse().map(p => `${x(p.second).toFixed(1)},${y(p.target! * 0.9).toFixed(1)}`).join('L')}Z`;
    };
    series.forEach((p, i) => {
      const px = x(p.second).toFixed(1), py = y(p.power).toFixed(1);
      if (p.gapBefore) {
        if (i > 0) { area += `L${x(series[i - 1].second).toFixed(1)},${y(0)}Z`; flushBand(runStart, i); }
        runStart = i;
        area += `M${px},${y(0)}L${px},${py}`;
        line += `M${px},${py}`;
      } else { area += `L${px},${py}`; line += `L${px},${py}`; }
      const prevTarget = i > 0 && !p.gapBefore ? series[i - 1].target : undefined;
      if (p.target) target += `${prevTarget ? 'L' : 'M'}${px},${y(p.target).toFixed(1)}`;
    });
    area += `L${x(series.at(-1)!.second).toFixed(1)},${y(0)}Z`;
    flushBand(runStart, series.length);
    const hrs = series.map(p => p.heartRate).filter((v): v is number => typeof v === 'number' && v > 0);
    let hr = '', hrMin = 0, hrMax = 0;
    if (hrs.length > 30) {
      hrMin = Math.floor((Math.min(...hrs) - 8) / 10) * 10; hrMax = Math.ceil((Math.max(...hrs) + 5) / 10) * 10;
      const yh = (v: number) => T + plotH - ((v - hrMin) / Math.max(1, hrMax - hrMin)) * plotH;
      series.forEach(p => { if (p.heartRate) hr += `${p.gapBefore || !hr ? 'M' : 'L'}${x(p.second).toFixed(1)},${yh(p.heartRate).toFixed(1)}`; });
    }
    const step = (span > 5400 ? 1200 : span > 2400 ? 600 : span > 900 ? 300 : 60) * (W < 640 ? 2 : 1);
    const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
    const stops = zones.map(z => ({ color: z.color, at: Number.isFinite(z.max) ? z.max * ftp : max * 2 }));
    return { max, x, y, area, line, band, target, hr, hrMin, hrMax, ticks, stops };
  }, [series, seconds, ftp, W, H]);

  if (!geometry) return null;
  const { max, x, y, ticks } = geometry;
  const point = hover === null ? null : series[hover];
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const second = ((clientX - rect.left) / rect.width * W - L) / plotW * Math.max(1, seconds);
    let lo = 0, hi = series.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (series[mid].second < second) lo = mid + 1; else hi = mid; }
    const best = lo > 0 && Math.abs(series[lo - 1].second - second) < Math.abs(series[lo].second - second) ? lo - 1 : lo;
    setHover(best);
  };
  // Zone gradient in user space: each stop sits at its zone's upper watt boundary.
  // Offsets must ascend (top of plot = 0). At a shared boundary the higher zone ends first.
  const gradStops = geometry.stops.flatMap((s, i) => {
    const prev = i ? geometry.stops[i - 1].at : 0;
    const top = Math.min(1, s.at / max), bottom = Math.min(1, prev / max);
    return bottom >= 1 ? [] : [{ offset: 1 - top, color: s.color, zone: i }, { offset: 1 - bottom, color: s.color, zone: i }];
  }).sort((a, b) => a.offset - b.offset || b.zone - a.zone)
    .map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />);
  const tipLeft = point ? Math.min(82, Math.max(18, (x(point.second) / W) * 100)) : 0;

  return <figure className="session-power-plot report-chart">
    <figcaption>
      <b>Watt gjennom økten</b>
      <span className="chart-legend"><i className="lg-zone" />Målt watt, farget etter sone<i className="lg-band" />Målområde ±10 %{geometry.hr && <><i className="lg-hr" />Puls</>}</span>
    </figcaption>
    <div className="report-chart-frame" ref={frame}>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Målt effekt mot målområdet gjennom aktiv økttid. Pauser og datagap bryter kurven."
        onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="report-zone-fill" gradientUnits="userSpaceOnUse" x1="0" y1={T} x2="0" y2={T + plotH}>{gradStops}</linearGradient>
          <linearGradient id="report-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f2eee8" stopOpacity="0.16" /><stop offset="1" stopColor="#f2eee8" stopOpacity="0.02" /></linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f} className="plot-grid-row">
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="plot-grid" />
          <text x={L - 8} y={y(max * f) + 4} textAnchor="end">{Math.round(max * f)}</text>
        </g>)}
        <line x1={L} x2={W - R} y1={y(ftp)} y2={y(ftp)} className="ftp-line" />
        <text x={W - R + 6} y={y(ftp) + 4} className="ftp-label">FTP</text>
        {geometry.band && <path d={geometry.band} className="target-band" />}
        <path d={geometry.area} fill="url(#report-area-fill)" className="power-area" />
        <path d={geometry.target} className="target-line" />
        <path d={geometry.line} stroke="url(#report-zone-fill)" className="power-line" />
        {geometry.hr && <path d={geometry.hr} className="hr-line" />}
        {geometry.hr && [0, 0.5, 1].map(f => <text key={f} x={W - R + 6} y={T + plotH - f * plotH + 4} className="hr-label">{Math.round(geometry.hrMin + (geometry.hrMax - geometry.hrMin) * f)}</text>)}
        {ticks.map(t => <text key={t} x={x(t)} y={H - 12} textAnchor="middle">{Math.round(t / 60)} min</text>)}
        {point && <g className="chart-cursor">
          <line x1={x(point.second)} x2={x(point.second)} y1={T} y2={T + plotH} />
          <circle cx={x(point.second)} cy={y(point.power)} r="5" />
          {point.target && <circle cx={x(point.second)} cy={y(point.target)} r="3.5" className="cursor-target" />}
        </g>}
      </svg>
      {point && <div className="chart-tooltip" style={{ left: `${tipLeft}%` }} role="status">
        <b>{formatTime(point.second)}</b>
        <span><strong>{Math.round(point.power)} W</strong>{point.target ? ` · mål ${Math.round(point.target)} W` : ''}</span>
        {(point.heartRate || point.cadence) && <span>{point.heartRate ? `${point.heartRate} bpm` : ''}{point.heartRate && point.cadence ? ' · ' : ''}{point.cadence ? `${point.cadence} rpm` : ''}</span>}
      </div>}
    </div>
    <p className="chart-footnote">Aktiv tid, pauser utelatt. Kurven er 5 sekunders snitt; analysen bruker rådata hvert sekund.</p>
  </figure>;
}
