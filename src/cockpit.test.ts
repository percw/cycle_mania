import { describe, expect, it } from 'vitest';
import { blockStats, gaugePosition, placeSamples, smoothedPower, targetFeedback, tracePath } from './cockpit';
import type { Workout } from './training';

const plan: Workout = {
  id: 't', name: 'Test', subtitle: '', category: 'Terskel', description: '', difficulty: 1,
  blocks: [
    { label: 'Oppvarming', seconds: 10, intensity: 0.5, kind: 'warmup' },
    { label: 'Drag 1 av 1', seconds: 20, intensity: 1, kind: 'work' },
    { label: 'Nedkjøring', seconds: 10, intensity: 0.45, kind: 'cooldown' },
  ],
};

describe('target feedback', () => {
  it('uses the same ±10 % band as the game rules', () => {
    expect(targetFeedback(221, 245).state).toBe('on');
    expect(targetFeedback(220, 245).state).toBe('under');
    expect(targetFeedback(269, 245).state).toBe('on');
    expect(targetFeedback(219, 245)).toMatchObject({ state: 'under', delta: -26 });
    expect(targetFeedback(271, 245)).toMatchObject({ state: 'over', delta: 26 });
    expect(targetFeedback(undefined, 245).state).toBe('none');
    expect(targetFeedback(100, 0).state).toBe('none');
  });
  it('pins the gauge marker inside ±30 %', () => {
    expect(gaugePosition(245, 245)).toBe(0.5);
    expect(gaugePosition(0, 245)).toBe(0);
    expect(gaugePosition(1000, 245)).toBe(1);
    expect(gaugePosition(undefined, 245)).toBe(0.5);
  });
});

describe('smoothed power', () => {
  it('is time weighted, so a sensor that only reports changes still averages correctly', () => {
    // 100 W for 2 s, then 400 W for the last 1 s of the window.
    expect(smoothedPower([{ at: 0, power: 100 }, { at: 2000, power: 400 }], 3000)).toBe(200);
  });
  it('ignores readings older than the window except the one still in force', () => {
    expect(smoothedPower([{ at: 0, power: 500 }, { at: 1000, power: 200 }], 10000)).toBe(200);
  });
  it('returns undefined without readings', () => {
    expect(smoothedPower([], 0)).toBeUndefined();
  });
});

describe('block placement and stats', () => {
  it('maps built-in samples by plan second, so skipped warmup does not shift blocks', () => {
    const samples = [11, 12, 13].map(s => ({ second: s - 10, workoutSecond: s, power: 250, targetPower: 250 }));
    expect(placeSamples(plan, samples).map(p => p.index)).toEqual([1, 1, 1]);
    const stats = blockStats(plan, samples, 1);
    expect(stats).toMatchObject({ seconds: 3, avgPower: 250, inBand: 1 });
    expect(stats.coverage).toBeCloseTo(3 / 20);
  });
  it('maps custom-plan samples by block index', () => {
    const samples = [
      { second: 1, blockIndex: 1, power: 200, targetPower: 250 },
      { second: 2, blockIndex: 1, power: 250, targetPower: 250 },
    ];
    const placed = placeSamples(plan, samples);
    expect(placed.map(p => p.x)).toEqual([11, 12]);
    expect(blockStats(plan, samples, 1)).toMatchObject({ avgPower: 225, inBand: 0.5 });
  });
  it('breaks the trace across skipped plan time', () => {
    const samples = [1, 2, 3, 31, 32].map(s => ({ second: s, workoutSecond: s, power: 200 }));
    const d = tracePath(plan, samples, 250, 1.2);
    expect(d.match(/M/g)?.length).toBe(2);
  });
});
