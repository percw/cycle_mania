import { describe, expect, it } from 'vitest';
import { analyzeRide, analyzeExecution, bestRollingPower, type AnalysisRide, type PowerSample } from './analytics';

const samples = (seconds: number, power: number): PowerSample[] => Array.from({ length: seconds }, (_, index) => ({ second: index + 1, power, targetPower: 250 }));
const ride = (overrides: Partial<AnalysisRide> = {}): AnalysisRide => ({
  id: 'now', name: 'Test', date: '2026-09-30T12:00:00Z', seconds: 1200, distance: 10, avgPower: 250,
  energy: 300, zoneSeconds: [0, 0, 0, 1200, 0, 0, 0], completed: true, demo: false, ftp: 230,
  samples: samples(1200, 250), ...overrides,
});

describe('measured power windows', () => {
  it('finds rolling averages instead of one-second peaks', () => {
    const input = samples(600, 200);
    input[300].power = 1000;
    expect(bestRollingPower(input, 300)).toBe(203);
    expect(bestRollingPower(input, 5)).toBe(360);
  });
  it('does not bridge data gaps or count duplicate timestamps twice', () => {
    const input = samples(1200, 250).filter(sample => sample.second !== 600);
    expect(bestRollingPower(input, 1200)).toBeNull();
    expect(bestRollingPower([...input, input[0]], 1200)).toBeNull();
    expect(bestRollingPower(samples(1199, 250), 1200)).toBeNull();
  });
  it('rejects fabricated, invalid, and negative values while keeping zero watts', () => {
    expect(bestRollingPower(samples(1200, 250).map(sample => ({ ...sample, measured: false })), 1200)).toBeNull();
    expect(bestRollingPower([{ second: 1, power: NaN }, { second: 2, power: -1 }], 1)).toBeNull();
    expect(bestRollingPower(samples(1200, 0), 1200)).toBe(0);
  });
});

describe('ride analysis', () => {
  it('only estimates FTP from 20 continuous measured minutes', () => {
    expect(analyzeRide(ride()).ftpEstimate).toMatchObject({ watts: 238, best20MinutePower: 250, suggestedIncrease: true, delta: 8 });
    expect(analyzeRide(ride({ samples: samples(1199, 250) })).ftpEstimate).toBeNull();
    expect(analyzeRide(ride({ demo: true })).ftpEstimate).toBeNull();
    expect(analyzeRide(ride({ samples: undefined })).eligible).toBe(false);
  });
  it('does not suggest lowering existing FTP after an easy ride', () => {
    const input = ride({ ftp: 300 });
    expect(analyzeRide(input).ftpEstimate?.suggestedIncrease).toBe(false);
    expect(input.ftp).toBe(300);
  });
  it('compares against historical real data and excludes demos, self and future rides', () => {
    const before = ride({ id: 'before', date: '2026-09-29T12:00:00Z', samples: samples(1200, 200), avgPower: 200 });
    const demo = ride({ id: 'demo', demo: true, date: '2026-09-29T13:00:00Z', samples: samples(1200, 900) });
    const future = ride({ id: 'future', date: '2026-10-01T12:00:00Z', samples: samples(1200, 900) });
    const result = analyzeRide(ride(), [before, demo, future, ride()]);
    expect(result.bestEfforts.find(item => item.seconds === 1200)).toMatchObject({ watts: 250, previousWatts: 200, delta: 50 });
    expect(result.comparison).toMatchObject({ previousRideId: 'before', adherenceDelta: 100, powerDelta: 50 });
  });
  it('reports baseline honestly and keeps unlike workouts out of comparison', () => {
    const result = analyzeRide(ride(), [ride({ id: 'different', name: 'Different', date: '2026-09-29T12:00:00Z' })]);
    expect(result.comparison).toBeNull();
    expect(analyzeRide(ride()).bestEfforts.every(item => item.delta === null)).toBe(true);
  });
  it('disables average-power comparison when duration or FTP differs', () => {
    const previous = ride({ id: 'before', ftp: 200, date: '2026-09-29T12:00:00Z' });
    expect(analyzeRide(ride(), [previous]).comparison).toBeNull();
    expect(analyzeRide(ride({ seconds: 600 }), [{ ...previous, ftp: 230 }]).comparison).toBeNull();
  });
});


describe('measured workout execution', () => {
  const threshold = (overrides: Partial<AnalysisRide> = {}) => ride({
    workoutId: 'threshold-4x10', ftp: 250, seconds: 600, skippedSeconds: 600,
    samples: samples(600, 245).map(sample => ({ ...sample, targetPower: 245, workoutSecond: sample.second + 600 })),
    ...overrides,
  });
  it('maps explicitly positioned samples to the right interval after skipping warmup', () => {
    const result = analyzeExecution(threshold());
    expect(result.intervals[0].observedSeconds).toBe(0);
    expect(result.intervals[1].observedSeconds).toBe(0);
    expect(result.intervals[2]).toMatchObject({ observedSeconds: 600, plannedSeconds: 600, coverage: 1, adherence: 100, meanPower: 245 });
    expect(result.work).toMatchObject({ observedSeconds: 600, targetSeconds: 600, inTargetSeconds: 600, adherence: 100 });
    expect(result.completedWorkIntervals).toBe(1);
    expect(result).toMatchObject({ activeSeconds: 600, skippedSeconds: 600, executionKnown: true, coverage: 1 });
  });
  it('keeps historical skipped interval positions unknown while retaining explicit targets', () => {
    const result = analyzeExecution(threshold({ samples: samples(600, 245).map(sample => ({ ...sample, targetPower: 245 })) }));
    expect(result.overall.adherence).toBe(100);
    expect(result.executionKnown).toBe(false);
    expect(result.unmappedSeconds).toBe(600);
    expect(result.work.adherence).toBeNull();
    expect(result.completedWorkIntervals).toBe(0);
    expect(result.intervals.every(interval => interval.observedSeconds === 0)).toBe(true);
  });
  it('does not invent targets after historical skips or when an explicit target is invalid', () => {
    expect(analyzeExecution(threshold({ samples: samples(600, 245).map(({ targetPower, ...sample }) => sample) })).overall.adherence).toBeNull();
    expect(analyzeExecution(threshold({ samples: [{ second: 1, power: 125, targetPower: NaN, workoutSecond: 1 }] })).overall.targetSeconds).toBe(0);
  });
  it('distinguishes target accuracy from missing data and short observed fragments', () => {
    const input = threshold();
    const result = analyzeExecution({ ...input, samples: input.samples!.slice(0, 10) });
    expect(result.work.adherence).toBe(100);
    expect(result.coverage).toBeCloseTo(10 / 600);
    expect(result.intervals[2].coverage).toBeCloseTo(10 / 600);
    expect(result.completedWorkIntervals).toBe(0);
    expect(result.intervals[3].meanPower).toBeNull();
  });
  it('separates easy recovery from the main work and counts zero power as observed', () => {
    const result = analyzeExecution(threshold({ seconds: 780, samples: [
      ...samples(600, 245).map(sample => ({ ...sample, targetPower: 245, workoutSecond: sample.second + 600 })),
      ...samples(180, 0).map(sample => ({ ...sample, second: sample.second + 600, targetPower: 125, workoutSecond: sample.second + 1200 })),
    ] }));
    expect(result.coverage).toBe(1);
    expect(result.work.adherence).toBe(100);
    expect(result.recovery).toMatchObject({ observedSeconds: 180, targetSeconds: 180, inTargetSeconds: 0, adherence: 0 });
    expect(result.intervals[3].meanPower).toBe(0);
  });
  it('never assigns demo data measured progress or completion', () => {
    const result = analyzeExecution(threshold({ demo: true }));
    expect(result.measuredSeconds).toBe(0);
    expect(result.work.adherence).toBeNull();
    expect(result.completedWorkIntervals).toBe(0);
  });
  it('retains legacy interval analysis when no segments were skipped', () => {
    const result = analyzeExecution(threshold({ seconds: 300, skippedSeconds: 0, samples: samples(300, 125).map(({ targetPower, ...sample }) => sample) }));
    expect(result.intervals[0]).toMatchObject({ observedSeconds: 300, adherence: 100, coverage: 1 });
    expect(result.executionKnown).toBe(true);
  });
  it('rejects low-coverage comparisons instead of claiming improvement from selected samples', () => {
    const earlier = ride({ id: 'before', date: '2026-09-29T12:00:00Z', samples: samples(600, 200) });
    expect(analyzeRide(ride(), [earlier]).comparison).toBeNull();
  });
  it('does not compare different executed intervals with the same total skipped time', () => {
    const earlier = threshold({ id: 'earlier', date: '2026-09-29T12:00:00Z', samples: samples(600, 245).map(sample => ({ ...sample, targetPower: 245, workoutSecond: sample.second + 1380 })) });
    expect(analyzeRide(threshold(), [earlier]).comparison).toBeNull();
  });
  it('does not join efforts across wall-clock pauses even when active seconds are contiguous', () => {
    const paused = samples(1200, 250).map(sample => ({ ...sample, wallSecond: sample.second + (sample.second > 600 ? 60 : 0) }));
    expect(bestRollingPower(paused, 1200)).toBeNull();
    expect(bestRollingPower(paused, 300)).toBe(250);
    expect(analyzeRide(ride({ samples: paused })).ftpEstimate).toBeNull();
  });
});

describe('immutable custom workout execution', () => {
  const custom = (overrides: Partial<AnalysisRide> = {}): AnalysisRide => ride({
    seconds: 30, workoutId: 'custom-revision-a', skippedSeconds: 0,
    workoutSnapshot: { id: 'custom-revision-a', name: 'My ride', subtitle: '', category: 'Egen', description: '', difficulty: 2, custom: true, blocks: [
      { label: 'Distance work', seconds: 60, distanceMeters: 500, intensity: 1, kind: 'work' },
      { label: 'Recovery', seconds: 30, intensity: 0.5, kind: 'recovery' },
    ] },
    ftp: 250, samples: samples(30, 250).map(sample => ({ ...sample, blockIndex: 0 })),
    blockSeconds: [30, 0], blockMeters: [500, 0], skippedBlocks: [], ...overrides,
  });
  it('uses saved plan and actual duration for a distance block ridden faster than its preview', () => {
    const result = analyzeExecution(custom());
    expect(result).toMatchObject({ plannedTimeEstimated: true, plannedSeconds: 90, notRiddenSeconds: null, skippedSeconds: 0, completedWorkIntervals: 1, executionKnown: true });
    expect(result.intervals[0]).toMatchObject({ plannedSeconds: 60, activeSeconds: 30, plannedDistanceMeters: 500, actualDistanceMeters: 500, observedSeconds: 30, coverage: 1 });
  });
  it('never guesses distance block position from planned or active seconds', () => {
    const result = analyzeExecution(custom({ samples: samples(30, 250).map(sample => ({ ...sample, workoutSecond: sample.second })) }));
    expect(result.executionKnown).toBe(false);
    expect(result.unmappedSeconds).toBe(30);
    expect(result.work.adherence).toBeNull();
    expect(result.overall.adherence).toBe(100);
    expect(result.completedWorkIntervals).toBe(0);
  });
  it('does not credit unfinished or skipped distance even with perfect measured coverage', () => {
    expect(analyzeExecution(custom({ blockMeters: [200, 0] })).completedWorkIntervals).toBe(0);
    expect(analyzeExecution(custom({ skippedBlocks: [0], skippedSeconds: 30 })).completedWorkIntervals).toBe(0);
    expect(analyzeExecution(custom({ skippedBlocks: [0], skippedSeconds: 30 })).skippedSeconds).toBe(0);
    expect(analyzeExecution(custom({ samples: samples(10, 250).map(sample => ({ ...sample, blockIndex: 0 })) })).intervals[0].coverage).toBeCloseTo(1 / 3);
  });
  it('resolves explicit block indices after skips and uses the saved target without explicit sample target', () => {
    const result = analyzeExecution(custom({ skippedBlocks: [0], blockMeters: [0, 200], blockSeconds: [0, 30], samples: samples(30, 125).map(({ targetPower, ...sample }) => ({ ...sample, blockIndex: 1 })) }));
    expect(result.intervals[1]).toMatchObject({ adherence: 100, meanPower: 125, observedSeconds: 30 });
    expect(result.work.observedSeconds).toBe(0);
    expect(result.recovery.observedSeconds).toBe(30);
  });
  it('compares identical immutable plans but excludes same ID with changed targets or structure', () => {
    const current = custom(), previous = custom({ id: 'before', date: '2026-09-29T12:00:00Z' });
    expect(analyzeRide(current, [previous]).comparison?.previousRideId).toBe('before');
    const edited = structuredClone(previous);
    edited.workoutSnapshot!.blocks[0].intensity = 0.9;
    expect(analyzeRide(current, [edited]).comparison).toBeNull();
    edited.workoutSnapshot = undefined;
    expect(analyzeRide(current, [edited]).comparison).toBeNull();
    expect(analyzeRide(current, [{ ...previous, skippedBlocks: [0] }]).comparison).toBeNull();
  });
  it('caps one-second block observations at actual fractional distance time without filling unsampled blocks', () => {
    const input = custom({ seconds: 1, blockSeconds: [0.12, 0.88], blockMeters: [1, 7], samples: [{ second: 1, power: 250, targetPower: 250, blockIndex: 0 }] });
    input.workoutSnapshot!.blocks[0].distanceMeters = 1;
    const result = analyzeExecution(input);
    expect(result.intervals[0]).toMatchObject({ observedSeconds: 0.12, targetSeconds: 0.12, inTargetSeconds: 0.12, meanPower: 250, coverage: 1 });
    expect(result.work.observedSeconds).toBe(0.12);
    expect(result.intervals[1]).toMatchObject({ observedSeconds: 0, meanPower: null, coverage: 0 });
    expect(result.recovery.observedSeconds).toBe(0);
  });
  it('does not compare custom distance rides with unknown sample placement', () => {
    const current = custom({ samples: samples(30, 250) });
    expect(analyzeRide(current, [{ ...current, id: 'before', date: '2026-09-29T12:00:00Z' }]).comparison).toBeNull();
  });
  it('time blocks require their planned duration even when all actual seconds were measured', () => {
    const current = custom();
    delete current.workoutSnapshot!.blocks[0].distanceMeters;
    expect(analyzeExecution(current).intervals[0].coverage).toBe(1);
    expect(analyzeExecution(current).completedWorkIntervals).toBe(0);
  });
});
