import { describe, expect, it } from 'vitest';
import { normalizedPower, pacing, sampleAverages, smoothedSeries, trainingLoad, verdict } from './reportInsights';
import type { IntervalExecution } from './analytics';

const steady = (seconds: number, power: number, from = 1) =>
  Array.from({ length: seconds }, (_, i) => ({ second: from + i, power, measured: true, heartRate: 140, cadence: 90 }));

describe('normalized power and load', () => {
  it('equals average power for a perfectly steady ride', () => {
    expect(normalizedPower(steady(1200, 200))).toBe(200);
  });
  it('is higher than average power for a variable ride', () => {
    const variable = Array.from({ length: 1200 }, (_, i) => ({ second: i + 1, power: Math.floor(i / 60) % 2 ? 300 : 100, measured: true }));
    expect(normalizedPower(variable)!).toBeGreaterThan(200);
  });
  it('refuses short or gap-only data instead of guessing', () => {
    expect(normalizedPower(steady(300, 200))).toBeNull();
    expect(normalizedPower(steady(1200, 200).map(s => ({ ...s, measured: false })))).toBeNull();
  });
  it('computes one hour at FTP as IF 1.0 and 100 TSS', () => {
    expect(trainingLoad(250, 3600, 250)).toEqual({ intensity: 1, tss: 100 });
    expect(trainingLoad(null, 3600, 250)).toBeNull();
  });
  it('averages heart rate and cadence over measured samples only', () => {
    const samples = [...steady(10, 200), { second: 11, power: 900, measured: false, heartRate: 200, cadence: 200 }];
    expect(sampleAverages(samples)).toMatchObject({ heartRate: 140, cadence: 90, maxPower: 200 });
  });
});

describe('verdict and pacing', () => {
  it('keeps demo and missing data neutral', () => {
    expect(verdict({ demo: true, adherence: 99, measuredSeconds: 100, completedWork: 4, workCount: 4, skippedSeconds: 0 }).tone).toBe('neutral');
    expect(verdict({ demo: false, adherence: null, measuredSeconds: 0, completedWork: 0, workCount: 4, skippedSeconds: 0 }).tone).toBe('neutral');
  });
  it('grades adherence and mentions skips', () => {
    const v = verdict({ demo: false, adherence: 93, measuredSeconds: 3000, completedWork: 3, workCount: 4, skippedSeconds: 120 });
    expect(v).toMatchObject({ title: 'Presis gjennomføring', tone: 'great' });
    expect(v.detail).toContain('3 av 4 drag');
    expect(v.detail).toContain('hoppet over');
  });
  const interval = (index: number, meanPower: number | null, extra: Partial<IntervalExecution> = {}): IntervalExecution => ({
    index, label: `Drag ${index}`, kind: 'work', plannedSeconds: 600, activeSeconds: null, plannedDistanceMeters: null, actualDistanceMeters: null,
    skipped: false, targetPower: 250, meanPower, coverage: 1, observedSeconds: 600, targetSeconds: 600, inTargetSeconds: 600, adherence: 100, ...extra,
  });
  it('reports a fade from the first to the last fully observed work interval', () => {
    const p = pacing([interval(1, 250), interval(3, 245), interval(5, 230)]);
    expect(p).toMatchObject({ change: -8, tone: 'mixed' });
    expect(p!.text).toContain('falt 8');
  });
  it('ignores skipped and partly observed intervals and needs two', () => {
    expect(pacing([interval(1, 250), interval(3, 200, { skipped: true }), interval(5, 200, { coverage: 0.5 })])).toBeNull();
  });
  it('smooths without bridging a gap', () => {
    const series = smoothedSeries([...steady(5, 100), ...steady(5, 300, 20)]);
    expect(series.filter(p => p.gapBefore).length).toBe(2);
    expect(series[4].power).toBe(100);
    expect(series[5].power).toBe(300);
  });
});
