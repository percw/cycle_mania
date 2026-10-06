import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkoutStore, validateCustomWorkout } from './custom-workouts.mjs';
import { createCustomWorkout, validateCustomWorkout as validateClient } from '../src/customWorkouts.ts';

describe('custom workout store', () => {
  it('persists create, update and deletion across SQLite restarts', () => {
    const folder = mkdtempSync(join(tmpdir(), 'xebex-workouts-')); let db;
    try {
      db = new DatabaseSync(join(folder, 'store.sqlite'));
      let store = createWorkoutStore(db); const draft = createCustomWorkout('8x4');
      expect(store.list()).toEqual([]);
      expect(store.save({ ...draft, unwanted: 'stripped' })).toEqual(draft);
      draft.name = 'Min oppdaterte økt'; store.save(draft);
      expect(store.list()).toHaveLength(1); db.close();
      db = new DatabaseSync(join(folder, 'store.sqlite')); store = createWorkoutStore(db);
      expect(store.list()).toEqual([draft]);
      expect(store.remove(draft.id)).toBe(true); expect(store.remove(draft.id)).toBe(false);
      db.close(); db = new DatabaseSync(join(folder, 'store.sqlite'));
      expect(createWorkoutStore(db).list()).toEqual([]);
    } finally { db?.close(); rmSync(folder, { recursive: true, force: true }); }
  });
  it('returns status 400 for invalid input and leaves saved data intact', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = createWorkoutStore(db), draft = createCustomWorkout(); store.save(draft);
      for (const input of [null, {}, { ...draft, id: '../bad' }, { ...draft, groups: [] }]) {
        expect(() => store.save(input)).toThrow();
        try { store.save(input); } catch (error) { expect(error.status).toBe(400); }
      }
      expect(() => store.remove('../bad')).toThrow(); expect(store.list()).toEqual([draft]);
    } finally { db.close(); }
  });
  it('matches frontend canonical validation for presets, mixed distance and rejection boundaries', () => {
    const draft = createCustomWorkout('3x13-30-15');
    draft.groups[0].recovery = { value: 0.1, unit: 'kilometers', intensity: 0.4 };
    draft.groups.push({ ...draft.groups[0], id: 'next', sets: 1, reps: 1 });
    const valid = ['blank', '8x4', '6x6-40-40', '3x13-30-15'].map(createCustomWorkout);
    for (const input of [...valid, draft]) expect(validateCustomWorkout(input)).toEqual(validateClient(input));
    const input = createCustomWorkout();
    for (const invalid of [null, { ...input, warmup: null, cooldown: null, groups: [{ ...input.groups[0], sets: 30, reps: 100 }] }, { ...input, warmup: { value: 172800, unit: 'seconds', intensity: 1 } }, { ...input, groups: [input.groups[0], input.groups[0]] }, { ...input, warmup: { value: 0.5, unit: 'meters', intensity: 1 } }]) {
      expect(() => validateCustomWorkout(invalid)).toThrow(); expect(() => validateClient(invalid)).toThrow();
    }
  });
});
