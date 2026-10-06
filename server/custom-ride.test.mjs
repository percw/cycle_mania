import { describe, expect, it } from 'vitest';
import { validateCustomRideMetadata } from './custom-ride.mjs';
const fixture = () => ({
  seconds: 30, distance: 0.5, workoutId: 'custom-a',
  workoutSnapshot: { id: 'custom-a', name: 'Mine', subtitle: '', category: 'Egen', description: '', custom: true, difficulty: 2,
    blocks: [{ label: 'Work', kind: 'work', seconds: 60, intensity: 1, distanceMeters: 500 }, { label: 'Rest', kind: 'recovery', seconds: 30, intensity: 0.5 }] },
  blockSeconds: [30, 0], blockMeters: [500, 0], skippedBlocks: [], samples: [{ second: 1, blockIndex: 0 }],
});
const validate = value => validateCustomRideMetadata(value, { samples: value.samples?.map(sample => ({ second: sample.second })) });
describe('custom ride metadata validation', () => {
  it('deep copies approved fields and preserves block identity', () => {
    const input = fixture(); input.workoutSnapshot.untrusted = true;
    const output = validate(input);
    expect(output.samples[0].blockIndex).toBe(0);
    expect(output.workoutSnapshot.untrusted).toBeUndefined();
    input.workoutSnapshot.blocks[0].intensity = 2;
    expect(output.workoutSnapshot.blocks[0].intensity).toBe(1);
    expect(output.blockMeters).toEqual([500, 0]);
  });
  it('leaves normal legacy rides unchanged', () => {
    const output = { name: 'Legacy' };
    expect(validateCustomRideMetadata({}, output)).toBe(output);
    expect(output).toEqual({ name: 'Legacy' });
  });
  it('requires a valid custom snapshot for any custom execution metadata', () => {
    for (const data of [{ blockSeconds: [1] }, { samples: [{ blockIndex: 0 }] }, { ...fixture(), workoutSnapshot: undefined }]) {
      expect(() => validate(data)).toThrow();
    }
    const data = fixture(); data.workoutSnapshot.custom = false;
    expect(() => validate(data)).toThrow();
  });
  it('rejects invalid snapshot types, targets, lengths, or changed identities', () => {
    for (const change of [
      value => { value.workoutSnapshot.blocks[0].intensity = 0; },
      value => { value.workoutSnapshot.blocks[0].seconds = 0; },
      value => { value.workoutSnapshot.blocks[0].distanceMeters = 0; },
      value => { value.workoutSnapshot.blocks[0].kind = 'sprint'; },
      value => { value.workoutSnapshot.blocks = Array(1501).fill(value.workoutSnapshot.blocks[0]); },
      value => { value.workoutSnapshot.id = 'different'; },
      value => { value.workoutSnapshot.description = {}; },
    ]) {
      const data = fixture(); change(data);
      expect(() => validate(data)).toThrow();
    }
  });
  it('rejects invalid execution totals, array lengths, duplicates and block indices', () => {
    for (const change of [
      value => { value.blockSeconds = [31, 31]; },
      value => { value.blockSeconds = [-1, 31]; },
      value => { value.blockSeconds = [30]; },
      value => { value.blockMeters = [1000, 0]; },
      value => { value.skippedBlocks = [0, 0]; },
      value => { value.skippedBlocks = [2]; },
      value => { value.samples[0].blockIndex = 2; },
      value => { value.samples = [{ second: 1, blockIndex: 1 }, { second: 2, blockIndex: 0 }]; },
    ]) {
      const data = fixture(); change(data);
      expect(() => validate(data)).toThrow();
      try { validate(data); } catch (error) { expect(error.status).toBe(400); }
    }
  });
});
