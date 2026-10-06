import { describe, expect, it } from 'vitest';
import { formatClock, formatShareDate, pickStats, powerLine, shareCardModel, shareFileName, wrapLines, type ShareCardInput } from './shareCard';
import { zones } from './training';
import type { RideSample } from './storage';

const ride: ShareCardInput['ride'] = { name: '4 × 10 min', date: '2026-10-06T17:30:00Z', demo: false, seconds: 3840, avgPower: 212, energy: 814, distance: 31.46, ftp: 250 };
const base = { ride, samples: [] as RideSample[], verdict: 'Presis gjennomføring', tone: 'great' as const, np: 231, tss: 72, adherence: 93, site: 'summit-sykkel.vercel.app' };
const sample = (second: number, power: number, measured = true): RideSample => ({ second, power, cadence: 90, heartRate: 140, measured });

describe('share card formatting', () => {
  it('formats ride time compactly', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(45 * 60 + 7)).toBe('45:07');
    expect(formatClock(3600 + 5 * 60)).toBe('1:05:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });
  it('writes a Norwegian date and a safe file name', () => {
    expect(formatShareDate('2026-10-06T17:30:00Z')).toMatch(/6\. oktober 2026/);
    expect(formatShareDate('not a date')).toBe('');
    expect(shareFileName(ride)).toBe('summit-2026-10-06-4-x-10-min.png');
    expect(shareFileName({ name: 'Bølger på Vestlandet!', date: 'x' })).toBe('summit-okt-b-lger-pa-vestlandet.png');
  });
  it('picks time, average power, TSS and on-target share for a real ride', () => {
    expect(pickStats(base)).toEqual([
      { label: 'Tid', value: '1:04:00' },
      { label: 'Snitteffekt', value: '212', unit: 'W' },
      { label: 'TSS', value: '72' },
      { label: 'I målet', value: '93', unit: '%' },
    ]);
  });
  it('falls back to normalized power and work when TSS or adherence are missing', () => {
    expect(pickStats({ ...base, tss: null, adherence: null }).map(s => s.label)).toEqual(['Tid', 'Snitteffekt', 'Normalisert', 'Arbeid']);
  });
  it('never shows derived training metrics for a demo ride, and labels it', () => {
    const demo = { ...base, ride: { ...ride, demo: true } };
    expect(pickStats(demo).map(s => s.label)).toEqual(['Tid', 'Snitteffekt', 'Arbeid', 'Distanse']);
    expect(pickStats(demo)[3]).toEqual({ label: 'Distanse', value: '31,5', unit: 'km' });
    expect(shareCardModel(demo).demo).toBe(true);
  });
  it('wraps long names to the allowed number of lines with an ellipsis', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLines('3 × 10 × 30/15', 200, measure, 2)).toEqual(['3 × 10 × 30/15']);
    expect(wrapLines('Tre trinn til terskel', 120, measure, 2)).toEqual(['Tre trinn', 'til terskel']);
    const cut = wrapLines('En veldig lang egen økt med mange ord i navnet', 120, measure, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith('…')).toBe(true);
    expect(measure(cut[1])).toBeLessThanOrEqual(120);
  });
});

describe('power line', () => {
  it('buckets measured watts, colours by zone and fits the box', () => {
    const samples = Array.from({ length: 600 }, (_, i) => sample(i + 1, i < 300 ? 120 : 280));
    const [run, ...rest] = powerLine(samples, 600, 250, { width: 900, height: 120, buckets: 60 });
    expect(rest).toHaveLength(0);
    expect(run).toHaveLength(60);
    expect(run[0].color).toBe(zones[0].color);
    expect(run[59].color).toBe(zones[4].color);
    for (const p of run) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(900); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(120); }
    expect(run[59].y).toBeLessThan(run[0].y);
  });
  it('keeps data gaps as gaps and ignores unmeasured seconds on real rides', () => {
    const samples = [...Array.from({ length: 100 }, (_, i) => sample(i + 1, 200)), ...Array.from({ length: 100 }, (_, i) => sample(i + 301, 200))];
    expect(powerLine(samples, 400, 250, { width: 400, height: 100, buckets: 40 })).toHaveLength(2);
    expect(powerLine([sample(1, 300, false)], 10, 250, { width: 100, height: 50 })).toEqual([]);
  });
  it('draws simulated watts for demo rides', () => {
    const samples = Array.from({ length: 120 }, (_, i) => sample(i + 1, 180, false));
    expect(powerLine(samples, 120, 250, { width: 100, height: 50, simulated: true })[0].length).toBe(120);
  });
});
