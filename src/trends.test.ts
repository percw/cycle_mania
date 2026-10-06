import { describe, expect, it } from 'vitest';
import { powerCurve, rideLoad, rollingLoad, weekStart, weeklyLoad } from './trends';
import type { RideRecord } from './storage';

function ride(id: string, date: string, power: number, seconds = 1800, extra: Partial<RideRecord> = {}): RideRecord {
  return {
    id, name: 'Test', date, seconds, distance: 10, avgPower: power, energy: 0, zoneSeconds: [0, 0, 0, 0, 0, 0, 0],
    completed: true, demo: false, ftp: 250,
    samples: Array.from({ length: seconds }, (_, i) => ({ second: i + 1, power, cadence: 90, heartRate: null, measured: true })),
    ...extra,
  };
}

describe('weeks', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart(new Date(2026, 9, 5, 18)).getDay()).toBe(1);   // Monday stays
    expect(weekStart(new Date(2026, 9, 11, 9)).getDate()).toBe(5);  // Sunday → previous Monday
  });
  it('buckets measured rides and leaves demo out', () => {
    const now = new Date(2026, 9, 7, 12);
    const weeks = weeklyLoad([
      ride('a', new Date(2026, 9, 6, 8).toISOString(), 250, 3600),
      ride('b', new Date(2026, 8, 30, 8).toISOString(), 250, 1800),
      ride('demo', new Date(2026, 9, 6, 9).toISOString(), 400, 3600, { demo: true }),
    ], 4, now);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]).toMatchObject({ current: true, rides: 1, minutes: 60, tss: 100 });
    expect(weeks[2]).toMatchObject({ rides: 1, minutes: 30, tss: 50 });
  });
  it('counts rides without power as unknown load instead of zero effort', () => {
    const noPower = ride('x', new Date(2026, 9, 6).toISOString(), 0, 600, { samples: [] });
    expect(rideLoad(noPower)).toBeNull();
    expect(weeklyLoad([noPower], 1, new Date(2026, 9, 7))[0]).toMatchObject({ rides: 1, unknownLoad: 1, tss: 0 });
  });
});

describe('power curve', () => {
  it('takes the best ride per duration and respects the time window', () => {
    const now = new Date(2026, 9, 7);
    const rides = [ride('old', new Date(2026, 6, 1).toISOString(), 300, 1200), ride('new', new Date(2026, 9, 1).toISOString(), 220, 1800)];
    const all = powerCurve(rides);
    expect(all.find(p => p.seconds === 300)).toMatchObject({ watts: 300, rideId: 'old' });
    expect(all.find(p => p.seconds === 1800)).toMatchObject({ watts: 220, rideId: 'new' });
    expect(all.find(p => p.seconds === 3600)?.watts).toBeNull();
    expect(powerCurve(rides, { sinceDays: 42, now }).find(p => p.seconds === 300)?.watts).toBe(220);
  });
});

describe('rolling load', () => {
  it('compares the last 28 days with the 28 before, independent of week boundaries', () => {
    const now = new Date(2026, 9, 5, 7); // a Monday morning
    const r = rollingLoad([
      ride('a', new Date(2026, 9, 4).toISOString(), 250, 3600),   // 100 TSS, recent
      ride('b', new Date(2026, 8, 1).toISOString(), 250, 1800),   // 50 TSS, previous window
      ride('c', new Date(2026, 6, 1).toISOString(), 250, 3600),   // outside both
    ], 28, now);
    expect(r).toMatchObject({ recent: 100, previous: 50, change: 100, recentMinutes: 60 });
  });
});
