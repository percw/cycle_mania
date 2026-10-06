import { describe, expect, it } from 'vitest';
import type { RideRecord, RideSample } from './storage';
import {
  analyzeRampTest, comparableRampHistory, GENTLE_RAMP_PROTOCOL, isRampProtocol,
  rampProtocolKey, rampWorkout, STANDARD_RAMP_PROTOCOL,
  type RampProtocol, type RampTestRecord,
} from './rampTest';

type TestRide = RideRecord & { rampTest: RampTestRecord; samples: RideSample[] };
function ride(rampSeconds = 630, protocol: RampProtocol = STANDARD_RAMP_PROTOCOL): TestRide {
  const endSecond = 300 + rampSeconds;
  return {
    id: 'test', date: '2026-10-05T10:00:00Z', name: 'FTP rampetest', seconds: endSecond + 180,
    distance: 8, avgPower: 190, energy: 300, zoneSeconds: [0, 0, 0, 0, 0, 0, 0],
    completed: true, demo: false, ftp: 200, workoutId: rampProtocolKey(protocol),
    rampTest: { version: 1, protocol, referenceFtp: 200, endSecond, reason: 'exhaustion', interrupted: false },
    samples: Array.from({ length: endSecond + 180 }, (_, index) => {
      const second = index + 1;
      const power = second <= 300 ? 1000 : second > endSecond ? 1500
        : protocol.startWatts + Math.floor((second - 301) / 60) * protocol.stepWatts;
      return { second, power, measured: true, wallSecond: second, cadence: 85, heartRate: null };
    }),
  };
}

describe('repeatable ramp protocol', () => {
  it('fixes absolute watts even when profile FTP changes', () => {
    const a = rampWorkout(STANDARD_RAMP_PROTOCOL, 200), b = rampWorkout(STANDARD_RAMP_PROTOCOL, 260);
    expect(a.id).toBe('ramp-v1-100-20');
    expect(a.id).toBe(b.id);
    expect(a.blocks).toHaveLength(42);
    a.blocks.forEach((block, i) => expect(block.intensity * 200).toBeCloseTo(b.blocks[i].intensity * 260));
    expect(a.blocks[1].intensity * 200).toBe(100);
    expect(a.blocks[40].intensity * 200).toBeCloseTo(880);
    expect(a.custom).toBeUndefined();
    expect(a.ramp).toEqual(STANDARD_RAMP_PROTOCOL);
  });
  it('validates persisted protocol bounds and rejects malformed values', () => {
    expect(isRampProtocol(GENTLE_RAMP_PROTOCOL)).toBe(true);
    for (const value of [null, {}, { ...STANDARD_RAMP_PROTOCOL, stepWatts: 0 }, { ...STANDARD_RAMP_PROTOCOL, maxStages: 400 },
      { ...STANDARD_RAMP_PROTOCOL, startWatts: 100.5 }, { ...STANDARD_RAMP_PROTOCOL, stageSeconds: 30 }]) {
      expect(isRampProtocol(value)).toBe(false);
    }
    expect(() => rampWorkout(STANDARD_RAMP_PROTOCOL, 0)).toThrow();
  });
});

describe('measured ramp FTP analysis', () => {
  it('uses the best rolling minute across a partly completed stage and excludes warmup/cooldown', () => {
    const result = analyzeRampTest(ride())!;
    expect(result.valid).toBe(true);
    expect(result.best60Watts).toBe(290); // 30 seconds at 280 + 30 at 300.
    expect(result.estimatedFtp).toBe(218);
    expect(result.best60StartSecond).toBe(871);
    expect(result.best60EndSecond).toBe(930);
    expect(result.completedStages).toBe(10);
    expect(result.finalStageWatts).toBe(300);
    expect(result.coverage).toBe(100);
  });
  it('multiplies unrounded power before rounding FTP once', () => {
    const input = ride();
    input.samples.filter(s => s.second > 300 && s.second <= 930).forEach(s => { s.power += 0.4; });
    const result = analyzeRampTest(input)!;
    expect(result.best60Watts).toBeCloseTo(290.4);
    expect(result.estimatedFtp).toBe(218);
    // 289.6 * .75 rounds to 217; prematurely rounding to 290 produces 218.
    input.samples.filter(s => s.second > 300 && s.second <= 930).forEach(s => { s.power -= 0.8; });
    expect(analyzeRampTest(input)!.best60Watts).toBeCloseTo(289.6);
    expect(analyzeRampTest(input)!.estimatedFtp).toBe(217);
  });
  it('accepts a short natural power collapse at the end without replacing best effort', () => {
    const input = ride();
    input.samples.filter(s => s.second > 915 && s.second <= 930).forEach(s => { s.power = 0; });
    const result = analyzeRampTest(input)!;
    expect(result.valid).toBe(true);
    expect(result.adherence).toBe(100);
    expect(result.best60Watts).toBe(285);
  });
  it('requires explicitly measured power, rejecting missing flags and telemetry below 95% coverage', () => {
    const absent = ride();
    absent.samples.forEach(s => { delete s.measured; });
    expect(analyzeRampTest(absent)).toMatchObject({ valid: false, estimatedFtp: null, best60Watts: null, coverage: 0 });
    const missing = ride();
    missing.samples = missing.samples.filter(s => s.second < 600 || s.second > 640);
    expect(analyzeRampTest(missing)).toMatchObject({ valid: false, estimatedFtp: null });
  });
  it('never bridges a missing second to manufacture a best minute', () => {
    const input = ride();
    input.samples = input.samples.filter(s => s.second !== 900);
    const result = analyzeRampTest(input)!;
    expect(result.valid).toBe(true);
    expect(result.best60EndSecond).toBe(899);
    expect(result.best60Watts).toBeCloseTo((59 * 280 + 260) / 60);
  });
  it('rejects fragmented measurements even above 95% overall coverage and ignores duplicate seconds', () => {
    const fragmented = ride();
    fragmented.samples = fragmented.samples.filter(s => s.second % 50 !== 0);
    const result = analyzeRampTest(fragmented)!;
    expect(result.coverage).toBeGreaterThan(95);
    expect(result.best60Watts).toBeNull();
    expect(result.estimatedFtp).toBeNull();
    const repeated = ride();
    repeated.samples = repeated.samples.flatMap(s => [s, { ...s }]);
    expect(analyzeRampTest(repeated)).toMatchObject({ coverage: 100, estimatedFtp: 218 });
  });
  it('rejects pauses via persisted flag, timer events, or wall-clock gaps', () => {
    const interrupted = ride(); interrupted.rampTest.interrupted = true;
    expect(analyzeRampTest(interrupted)?.valid).toBe(false);
    const events = ride(); events.timerEvents = [{ type: 'stop', wallSecond: 650 }, { type: 'start', wallSecond: 655 }];
    expect(analyzeRampTest(events)?.valid).toBe(false);
    const gap = ride(); gap.samples.filter(s => s.second >= 901).forEach(s => { s.wallSecond! += 20; });
    expect(analyzeRampTest(gap)).toMatchObject({ valid: false, estimatedFtp: null, best60Watts: 280 });
  });
  it('allows cooldown pauses and excludes them from ramp quality', () => {
    const input = ride(); input.timerEvents = [{ type: 'stop', wallSecond: 950 }, { type: 'start', wallSecond: 980 }];
    expect(analyzeRampTest(input)?.valid).toBe(true);
  });
  it('rejects early exits, short ramps, ceiling finishes and skipped segments', () => {
    expect(analyzeRampTest(ride(299))?.valid).toBe(false);
    for (const reason of ['aborted', 'ceiling'] as const) {
      const input = ride(); input.rampTest.reason = reason;
      expect(analyzeRampTest(input)).toMatchObject({ valid: false, estimatedFtp: null });
    }
    expect(analyzeRampTest(ride(2400))?.valid).toBe(false);
    const skipped = ride(); skipped.skippedSeconds = 300;
    expect(analyzeRampTest(skipped)?.valid).toBe(false);
  });
  it('rejects poor adherence even when the sample targetPower claims otherwise', () => {
    const input = ride();
    input.samples.forEach(s => { s.power = 500; s.targetPower = 500; });
    expect(analyzeRampTest(input)).toMatchObject({ valid: false, estimatedFtp: null, adherence: 0 });
  });
  it('shows a labelled demo calculation without granting a real FTP result', () => {
    const demo = ride(); demo.demo = true; demo.samples.forEach(s => { s.measured = false; });
    expect(analyzeRampTest(demo)).toMatchObject({ demo: true, valid: false, estimatedFtp: null, previewFtp: 218 });
    expect(comparableRampHistory([demo])).toEqual([]);
  });
  it('rejects malformed metadata and never mutates original samples or reference FTP', () => {
    const input = ride(); const before = JSON.stringify(input);
    analyzeRampTest(input);
    expect(JSON.stringify(input)).toBe(before);
    input.rampTest.endSecond = Infinity;
    expect(analyzeRampTest(input)).toBeNull();
    expect(analyzeRampTest({ ...ride(), rampTest: undefined })).toBeNull();
  });
});

describe('longitudinal ramp history', () => {
  it('compares only real valid tests with matching protocols, independent of profile FTP', () => {
    const a = ride(600); a.id = 'a'; a.date = '2026-09-01T12:00:00Z';
    const b = ride(600, GENTLE_RAMP_PROTOCOL); b.id = 'b'; b.date = '2026-09-15T12:00:00Z';
    const c = ride(630); c.id = 'c'; c.ftp = 230; c.rampTest.referenceFtp = 230;
    const demo = ride(1200); demo.id = 'demo'; demo.demo = true;
    const invalid = ride(); invalid.id = 'bad'; invalid.rampTest.interrupted = true;
    const points = comparableRampHistory([c, invalid, b, demo, a, a]);
    expect(points.map(p => p.rideId)).toEqual(['a', 'b', 'c']);
    expect(points[0].previousFtp).toBeNull();
    expect(points[1].previousFtp).toBeNull();
    expect(points[2]).toMatchObject({ estimatedFtp: 218, previousFtp: 210, deltaWatts: 8 });
    expect(points[2].deltaPercent).toBeCloseTo(8 / 210 * 100);
    expect(comparableRampHistory([a, b, c], STANDARD_RAMP_PROTOCOL).map(p => p.rideId)).toEqual(['a', 'c']);
  });
});
