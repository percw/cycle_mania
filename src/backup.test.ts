import { describe, expect, it } from 'vitest';
import { createBackup, mergeImportedRides, parseBackup, validateImportedRide } from './backup';
import { createCustomWorkout } from './customWorkouts';
import type { RideRecord } from './storage';

const ride = (id: string, date: string, extra: Partial<RideRecord> = {}): RideRecord => ({
  id, name: `Økt ${id}`, date, seconds: 120, distance: 1, avgPower: 200, energy: 24,
  zoneSeconds: [0, 0, 120, 0, 0, 0, 0], completed: true, demo: false, ftp: 250,
  samples: [{ second: 1, power: 200, cadence: 90, heartRate: null, measured: true }, { second: 2, power: 210, cadence: null, heartRate: 130 }],
  ...extra,
});

describe('JSON backup', () => {
  it('round-trips rides, profile FTP and custom workouts', () => {
    const workout = createCustomWorkout('8x4');
    const backup = createBackup({ rides: [ride('a', '2026-10-01T10:00:00Z'), ride('demo', '2026-10-02T10:00:00Z', { demo: true })], ftp: 265, customWorkouts: [workout], now: new Date('2026-10-06T08:00:00Z') });
    expect(backup).toMatchObject({ app: 'SUMMIT', kind: 'backup', version: 1, exportedAt: '2026-10-06T08:00:00.000Z' });
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.rides.map(r => r.id)).toEqual(['a', 'demo']);
    expect(parsed.rides[1].demo).toBe(true);
    expect(parsed.rides[0].samples).toEqual(backup.rides[0].samples);
    expect(parsed.customWorkouts).toEqual([workout]);
    expect(parsed.ftp).toBe(265);
    expect(parsed.skipped).toBe(0);
  });
  it('also reads the plain ride list from the older export button', () => {
    const parsed = parseBackup(JSON.stringify([ride('x', '2026-10-01T10:00:00Z')]));
    expect(parsed.rides.map(r => r.id)).toEqual(['x']);
    expect(parsed.ftp).toBeNull();
  });
  it('skips invalid entries and rejects unrelated files', () => {
    const parsed = parseBackup(JSON.stringify({ app: 'SUMMIT', kind: 'backup', version: 1, profile: { ftp: 9000 },
      rides: [ride('ok', '2026-10-01T10:00:00Z'), ride('ok', '2026-10-01T10:00:00Z'), { id: 'bad id!' }, ride('neg', '2026-10-01T10:00:00Z', { seconds: -1 })],
      customWorkouts: [{ version: 1, id: 'nope', groups: [] }] }));
    expect(parsed.rides.map(r => r.id)).toEqual(['ok']);
    expect(parsed.skipped).toBe(4);
    expect(parsed.ftp).toBeNull();
    expect(() => parseBackup('{"hello":1}')).toThrow(/sikkerhetskopi/);
    expect(() => parseBackup('not json')).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ app: 'SUMMIT', kind: 'backup', version: 2 }))).toThrow(/nyere/);
  });
  it('rejects rides with unsorted samples or a missing demo flag', () => {
    expect(validateImportedRide(ride('s', '2026-10-01T10:00:00Z', { samples: [{ second: 2, power: 1, cadence: null, heartRate: null }, { second: 1, power: 1, cadence: null, heartRate: null }] }))).toBeNull();
    const withoutDemo: Partial<RideRecord> = ride('d', '2026-10-01T10:00:00Z');
    delete withoutDemo.demo;
    expect(validateImportedRide(withoutDemo)).toBeNull();
  });
  it('merges by ride id and keeps rides that are already stored', () => {
    const current = [ride('a', '2026-10-01T10:00:00Z', { name: 'Her fra før' })];
    const result = mergeImportedRides(current, [ride('a', '2026-10-01T10:00:00Z', { name: 'Fra fil' }), ride('b', '2026-10-03T10:00:00Z')]);
    expect(result.added.map(r => r.id)).toEqual(['b']);
    expect(result.existing).toBe(1);
    expect(result.rides.map(r => [r.id, r.name])).toEqual([['b', 'Økt b'], ['a', 'Her fra før']]);
  });
});
