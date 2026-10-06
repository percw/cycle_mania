import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime, getWorkoutState, getZone, workoutDuration, workouts, workoutTss, zoneDistribution, type Workout } from './training';

const sample: Workout = {
  id: 'test', name: 'Test', category: 'Terskel', subtitle: '', description: '', difficulty: 1,
  blocks: [
    { label: 'Warmup', seconds: 60, intensity: 0.5, kind: 'warmup' },
    { label: 'Work', seconds: 120, intensity: 1, kind: 'work' },
    { label: 'Cooldown', seconds: 60, intensity: 0.45, kind: 'cooldown' },
  ],
};

describe('curated workout catalog', () => {
  it('contains exactly 100 unique, usable sessions in all eight families', () => {
    expect(workouts).toHaveLength(100);
    expect(new Set(workouts.map(workout => workout.id)).size).toBe(100);
    expect(new Set(workouts.map(workout => workout.name)).size).toBe(100);
    expect(new Set(workouts.map(workout => workout.category)).size).toBe(8);
    for (const workout of workouts) {
      expect(workout.blocks[0].kind).toBe('warmup');
      expect(workout.blocks.at(-1)?.kind).toBe('cooldown');
      expect(workout.blocks.some(current => current.kind === 'work')).toBe(true);
      for (const current of workout.blocks) {
        expect(current.seconds).toBeGreaterThan(0);
        expect(Number.isInteger(current.seconds)).toBe(true);
        expect(current.intensity).toBeGreaterThan(0);
      }
      expect(zoneDistribution(workout).reduce((sum, zone) => sum + zone.seconds, 0)).toBe(workoutDuration(workout));
    }
  });
  it('preserves the requested long interval formats, with no extra final rest', () => {
    expect(workoutDuration(workouts.find(workout => workout.id === 'threshold-3x10')!)).toBe(51 * 60);
    expect(workoutDuration(workouts.find(workout => workout.id === 'threshold-4x10')!)).toBe(64 * 60);
    expect(workoutDuration(workouts.find(workout => workout.id === 'threshold-2x20')!)).toBe(60 * 60);
    expect(workouts.find(workout => workout.id === 'threshold-2x25')?.blocks.filter(current => current.kind === 'work').map(current => current.seconds)).toEqual([1500, 1500]);
  });
  it('keeps microintervals and series rests exact', () => {
    const workout = workouts.find(item => item.id === 'micro-30-15-3')!;
    expect(workout.blocks.filter(current => current.kind === 'work')).toHaveLength(30);
    expect(workoutDuration(workout)).toBe(15 * 60 + 30 * 30 + 27 * 15 + 2 * 180);
  });
});

describe('session timing', () => {
  it('moves into the next block at its exact boundary', () => {
    expect(getWorkoutState(sample, 0)).toMatchObject({ index: 0, remaining: 60, totalRemaining: 240, completed: false, progress: 0 });
    expect(getWorkoutState(sample, 59.5)).toMatchObject({ index: 0, remaining: 0.5 });
    expect(getWorkoutState(sample, 60)).toMatchObject({ index: 1, remaining: 120, totalRemaining: 180, progress: 0.25 });
    expect(getWorkoutState(sample, 180)).toMatchObject({ index: 2, remaining: 60 });
  });
  it('clamps invalid early times and completed sessions', () => {
    expect(getWorkoutState(sample, -50).progress).toBe(0);
    expect(getWorkoutState(sample, NaN).progress).toBe(0);
    for (const elapsed of [240, 241, Infinity]) {
      expect(getWorkoutState(sample, elapsed)).toMatchObject({ index: 2, remaining: 0, totalRemaining: 0, completed: true, progress: 1 });
    }
  });
  it('snaps floating-point residue at boundaries instead of returning a stalled tiny step', () => {
    expect(getWorkoutState(sample, 60 - 1e-13)).toMatchObject({ index: 1, remaining: 120 });
    expect(getWorkoutState(sample, 180 - 1e-12)).toMatchObject({ index: 2, remaining: 60 });
    expect(getWorkoutState(sample, 240 - 1e-12)).toMatchObject({ completed: true, remaining: 0 });
    expect(getWorkoutState(sample, 60 - 0.00001)).toMatchObject({ index: 0, remaining: 0.00001 });
    let elapsed = 60 - 1e-13;
    let remaining = 40;
    let iterations = 0;
    while (remaining > 0.0001 && iterations < 100) {
      const state = getWorkoutState(sample, elapsed);
      const dt = Math.min(remaining, 1, state.remaining);
      expect(dt).toBeGreaterThan(0.000001);
      elapsed += dt;
      remaining -= dt;
      iterations++;
    }
    expect(iterations).toBe(40);
    expect(remaining).toBe(0);
    expect(elapsed).toBeCloseTo(100, 8);
  });
});

describe('power zones and planned load', () => {
  it('has continuous and unambiguous zone boundaries', () => {
    for (const [watts, expected] of [[0, 1], [110, 1], [111, 2], [150, 2], [151, 3], [180, 3], [181, 4], [210, 4], [211, 5], [240, 5], [241, 6], [300, 6], [301, 7]]) {
      expect(getZone(watts, 200).id).toBe(expected);
    }
    expect(getZone(100, 0).id).toBe(1);
    expect(getZone(-5, 200).id).toBe(1);
    expect(getZone(NaN, 200).id).toBe(1);
  });
  it('distributes all planned time, including easy blocks', () => {
    expect(zoneDistribution(sample)).toEqual([
      { zone: 1, seconds: 120 }, { zone: 2, seconds: 0 }, { zone: 3, seconds: 0 },
      { zone: 4, seconds: 120 }, { zone: 5, seconds: 0 }, { zone: 6, seconds: 0 }, { zone: 7, seconds: 0 },
    ]);
  });
  it('estimates 100 load points for one hour at FTP', () => {
    expect(workoutTss({ ...sample, blocks: [{ label: 'FTP', seconds: 3600, intensity: 1, kind: 'work' }] })).toBe(100);
    expect(workoutTss({ ...sample, blocks: [{ label: 'Easy', seconds: 3600, intensity: 0.5, kind: 'work' }] })).toBe(25);
  });
});

describe('time labels', () => {
  it('rounds countdowns up and supports long sessions', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(0.1)).toBe('00:01');
    expect(formatTime(61)).toBe('01:01');
    expect(formatTime(3661)).toBe('61:01');
    expect(formatTime(-5)).toBe('00:00');
    expect(formatDuration(3120)).toBe('52 min');
  });
});
