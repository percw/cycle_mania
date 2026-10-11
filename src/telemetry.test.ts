import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countsAsRealRide, initTelemetry, isLocalHost, minutesBucket, nthBucket, realRideCount, sanitizeProps,
  setTelemetryAdapter, telemetryAllowed, track, trackOnce, trackRideSaved, workoutCategory, type TelemetryAdapter,
} from './telemetry';
import { workouts } from './training';
import type { RideRecord } from './storage';

function recorder() {
  const sent: [string, Record<string, string>][] = [];
  const adapter: TelemetryAdapter = { start: () => {}, send: (name, props) => { sent.push([name, props]); } };
  return { sent, adapter };
}
const ride = (over: Partial<RideRecord> = {}): RideRecord => ({
  id: 'r', name: 'Test', date: '2026-10-06T10:00:00Z', seconds: 1800, distance: 10, avgPower: 200, energy: 360,
  zoneSeconds: [0, 0, 0, 0, 0, 0, 0], completed: true, demo: false, ftp: 250, worldId: 'vestland', ...over,
});

afterEach(() => { setTelemetryAdapter(null); vi.unstubAllGlobals(); });

describe('bucketing', () => {
  it('buckets the nth real ride into low-cardinality strings', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10, 11, 250].map(nthBucket)).toEqual(['0', '1', '2', '3', '4-5', '4-5', '6-10', '6-10', '11+', '11+']);
    expect(nthBucket(Number.NaN)).toBe('0');
    expect(nthBucket(-3)).toBe('0');
  });
  it('buckets ride minutes', () => {
    expect([0, 599, 600, 1199, 1200, 1799, 1800, 2699, 2700, 3599, 3600, 5399, 5400, 99999].map(minutesBucket))
      .toEqual(['<10', '<10', '10-19', '10-19', '20-29', '20-29', '30-44', '30-44', '45-59', '45-59', '60-89', '60-89', '90+', '90+']);
    expect(minutesBucket(Number.POSITIVE_INFINITY)).toBe('<10');
  });
  it('maps workouts to coarse category slugs', () => {
    expect(workoutCategory(workouts.find(w => w.id === 'threshold-4x10'))).toBe('threshold');
    expect(workoutCategory(workouts.find(w => w.id === 'vo2-4x4'))).toBe('vo2');
    expect(workoutCategory({ category: 'Egen økt', custom: true })).toBe('custom');
    expect(workoutCategory(undefined)).toBe('other');
    expect(new Set(workouts.map(w => workoutCategory(w))).has('other')).toBe(false);
  });
  it('counts only real rides that finished the plan or lasted ten minutes', () => {
    expect(countsAsRealRide(ride())).toBe(true);
    expect(countsAsRealRide(ride({ demo: true }))).toBe(false);
    expect(countsAsRealRide(ride({ completed: false, seconds: 599 }))).toBe(false);
    expect(countsAsRealRide(ride({ completed: false, seconds: 600 }))).toBe(true);
    expect(realRideCount([ride(), ride({ demo: true }), ride({ completed: false, seconds: 30 }), ride()])).toBe(2);
  });
});

describe('privacy guarantees', () => {
  it('drops unknown keys and replaces unknown values, so watts, FTP or HR can never be sent', () => {
    const props = sanitizeProps('ride_completed', {
      demo: false, nth: '3', minutes: '30-44', world: 'vestland', full: true,
      ftp: 250, avgPower: 212, heartRate: 151, userId: 'abc',
    } as never);
    expect(props).toEqual({ demo: 'false', nth: '3', minutes: '30-44', world: 'vestland', full: 'true' });
    expect(sanitizeProps('survey_answer', { question: 'switch', answer: 'my ftp is 250' })).toEqual({ question: 'switch', answer: 'other' });
    expect(sanitizeProps('ride_started', { demo: true, world: 'atlantis', workout_category: 'threshold' })).toEqual({ demo: 'true', world: 'other', workout_category: 'threshold' });
    expect(sanitizeProps('sensor_connected', { kind: 250 } as never)).toEqual({ kind: 'other' });
  });

  it('only allows sending in production on a real host without opt-out signals', () => {
    const live = { prod: true, hostname: 'summit-sykkel.vercel.app' };
    expect(telemetryAllowed(live)).toBe(true);
    expect(telemetryAllowed({ ...live, prod: false })).toBe(false);
    for (const hostname of ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', '192.168.1.20', '10.0.0.5', '172.20.1.1', 'summit.local', 'app.localhost', ''])
      expect(telemetryAllowed({ ...live, hostname }), hostname).toBe(false);
    expect(isLocalHost('172.32.0.1')).toBe(false);
    expect(telemetryAllowed({ ...live, optedOut: true })).toBe(false);
    expect(telemetryAllowed({ ...live, gpc: true })).toBe(false);
    expect(telemetryAllowed({ ...live, dnt: true })).toBe(false);
    expect(telemetryAllowed({ ...live, automated: true })).toBe(false);
  });

  it('sends nothing outside production, even in a browser-like environment on a public host', () => {
    const fetchSpy = vi.fn(), beacon = vi.fn(), append = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { sendBeacon: beacon, doNotTrack: null, webdriver: false });
    vi.stubGlobal('location', { hostname: 'summit-sykkel.vercel.app' });
    vi.stubGlobal('document', { head: { appendChild: append }, createElement: vi.fn() });
    expect(import.meta.env.PROD).toBe(false);
    expect(initTelemetry()).toBe(false);
    track('app_open', { bluetooth: true, installed: false });
    trackRideSaved(ride(), [ride()]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('is a no-op without an adapter and never throws from a failing adapter', () => {
    expect(() => track('share_card', { method: 'download' })).not.toThrow();
    setTelemetryAdapter({ start: () => {}, send: () => { throw new Error('network'); } });
    expect(() => track('share_card', { method: 'download' })).not.toThrow();
  });
});

describe('events', () => {
  it('reports the nth real ride from local history', () => {
    const { sent, adapter } = recorder();
    setTelemetryAdapter(adapter);
    const history = [ride({ id: 'c' }), ride({ id: 'b', demo: true }), ride({ id: 'a' }), ride({ id: 'x', completed: false, seconds: 60 })];
    trackRideSaved(history[0], history);
    trackRideSaved(ride({ demo: true, seconds: 300, completed: false }), history);
    expect(sent).toEqual([
      ['ride_completed', { demo: 'false', nth: '2', minutes: '30-44', world: 'vestland', full: 'true' }],
      ['ride_completed', { demo: 'true', nth: '2', minutes: '<10', world: 'vestland', full: 'false' }],
    ]);
  });
  it('tracks a keyed event once per page load', () => {
    const { sent, adapter } = recorder();
    setTelemetryAdapter(adapter);
    trackOnce('sensor-test-ftms', 'sensor_connected', { kind: 'ftms' });
    trackOnce('sensor-test-ftms', 'sensor_connected', { kind: 'ftms' });
    trackOnce('sensor-test-hr', 'sensor_connected', { kind: 'hr' });
    expect(sent.map(([, props]) => props.kind)).toEqual(['ftms', 'hr']);
  });
});
