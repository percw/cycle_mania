import { describe, it, expect } from 'vitest';
import { createCustomWorkout, validateCustomWorkout, compileCustomWorkout, validateWorkoutSnapshot, stepSeconds } from './customWorkouts';
import type { CustomTemplateId } from './customWorkouts';

describe('custom workout compiler', () => {
  it.each<[CustomTemplateId, number, number, number]>([
    ['6x6-40-40', 36, 73, 4440], ['3x13-30-15', 39, 79, 2970], ['8x4', 8, 17, 3660],
  ])('compiles %s with exact work, pause counts and total seconds', (template, work, blocks, total) => {
    const compiled = compileCustomWorkout(createCustomWorkout(template));
    expect(compiled.blocks.filter(b => b.kind === 'work')).toHaveLength(work);
    expect(compiled.blocks).toHaveLength(blocks);
    expect(compiled.blocks.reduce((sum, b) => sum + b.seconds, 0)).toBe(total);
    expect(compiled.blocks.at(-2)?.kind).toBe('work');
    expect(compiled.blocks.some((b, index) => b.kind === 'recovery' && compiled.blocks[index + 1]?.kind === 'recovery')).toBe(false);
  });
  it('uses set recovery between groups and never appends a final recovery', () => {
    const draft = createCustomWorkout('blank');
    draft.warmup = draft.cooldown = null;
    draft.groups[0].setRecovery = { value: 500, unit: 'meters', intensity: 0.5 };
    draft.groups.push({ ...draft.groups[0], id: 'second', name: 'Avslutning' });
    const compiled = compileCustomWorkout(draft);
    expect(compiled.blocks.map(b => b.kind)).toEqual(['work', 'recovery', 'work']);
    expect(compiled.blocks[1]).toMatchObject({ distanceMeters: 500, seconds: 60 });
    draft.groups[0].setRecovery = null;
    expect(compileCustomWorkout(draft).blocks.map(b => b.kind)).toEqual(['work', 'work']);
  });
  it('preserves distances while using 30 km/h only for preview', () => {
    const draft = createCustomWorkout('blank'); draft.warmup = draft.cooldown = null;
    draft.groups[0].work = { value: 2.5, unit: 'kilometers', intensity: 0.9 };
    expect(compileCustomWorkout(draft).blocks[0]).toMatchObject({ seconds: 300, distanceMeters: 2500 });
    expect(stepSeconds({ value: 1.5, unit: 'minutes', intensity: 1 })).toBe(90);
    expect(stepSeconds({ value: 1, unit: 'meters', intensity: 1 })).toBe(1);
  });
  it('changes history revision when structure or intensity changes, not random editor group IDs', () => {
    const draft = createCustomWorkout('8x4'); const original = compileCustomWorkout(draft).id;
    expect(compileCustomWorkout(JSON.parse(JSON.stringify(draft))).id).toBe(original);
    draft.groups[0].id = 'other-id'; expect(compileCustomWorkout(draft).id).toBe(original);
    draft.groups[0].work.intensity = 0.95; expect(compileCustomWorkout(draft).id).not.toBe(original);
    const changed = compileCustomWorkout(draft).id;
    draft.groups[0].reps--; expect(compileCustomWorkout(draft).id).not.toBe(changed);
  });
  it.each(['sets', 'reps'] as const)('rejects noninteger %s and explosive expansion', key => {
    const draft = createCustomWorkout(); draft.groups[0][key] = 1.5;
    expect(() => validateCustomWorkout(draft)).toThrow();
    draft.groups[0].sets = 30; draft.groups[0].reps = 100;
    expect(() => validateCustomWorkout(draft)).toThrow(/1500/);
  });
  it('rejects invalid units, duration, identity, FTP and excessive duration', () => {
    const base = createCustomWorkout();
    for (const input of [null, {}, { ...base, id: '../bad' }, { ...base, groups: [] }, { ...base, groups: Array(31).fill(base.groups[0]) }, { ...base, warmup: { value: 1, unit: 'hours', intensity: 1 } }, { ...base, warmup: { value: 0, unit: 'seconds', intensity: 1 } }, { ...base, warmup: { value: NaN, unit: 'minutes', intensity: 1 } }, { ...base, warmup: { value: 1, unit: 'minutes', intensity: 3.1 } }]) expect(() => validateCustomWorkout(input)).toThrow();
    base.groups[0].work = { value: 172800, unit: 'seconds', intensity: 1 };
    expect(() => validateCustomWorkout(base)).toThrow(/48 timer/);
  });
  it('restores a valid compiled snapshot independent of editor changes and rejects malformed blocks', () => {
    const workout = compileCustomWorkout(createCustomWorkout('3x13-30-15'));
    expect(validateWorkoutSnapshot(workout)).toEqual(workout);
    expect(() => validateWorkoutSnapshot({ ...workout, blocks: [] })).toThrow();
    expect(() => validateWorkoutSnapshot({ ...workout, blocks: [{ ...workout.blocks[0], distanceMeters: -1 }] })).toThrow();
    expect(() => validateWorkoutSnapshot({ ...workout, blocks: [{ ...workout.blocks[0], kind: 'work', seconds: 0 }] })).toThrow();
  });
});
