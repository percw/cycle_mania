import { describe, expect, it } from 'vitest';
import { RideMotion } from './rideMotion';

describe('buffered ride presentation distance', () => {
  it('removes tick-frequency velocity pulses at 8 m/s sampled four times a second', () => {
    const motion = new RideMotion(0, 0, true);
    let previous = 0;
    const velocities: number[] = [];
    for (let frame = 0; frame <= 600; frame++) {
      const now = frame * 1000 / 60;
      if (frame % 15 === 0) motion.ingest(now * .008, now, true);
      const meters = motion.update(now);
      if (frame > 30) velocities.push((meters - previous) * 60);
      expect(meters).toBeLessThanOrEqual(now * .008);
      previous = meters;
    }
    expect(Math.min(...velocities)).toBeCloseTo(8, 8);
    expect(Math.max(...velocities)).toBeCloseTo(8, 8);
    expect(previous).toBeCloseTo((10000 - RideMotion.bufferMs) * .008, 8);
  });

  it('interpolates through uneven update intervals within the buffer', () => {
    const motion = new RideMotion(0, 0, true);
    const times = [0, 200, 480, 730, 1030, 1260, 1520, 1750, 2000];
    let sample = 1;
    for (let now = 0; now <= 2200; now += 10) {
      while (sample < times.length && times[sample] <= now) {
        const at = times[sample++];
        motion.ingest(at * .008, at, true);
      }
      expect(motion.update(now)).toBeCloseTo(Math.max(0, now - 300) * .008, 8);
    }
  });

  it('never invents distance after samples stop or while stationary', () => {
    const motion = new RideMotion(0, 0, true);
    motion.ingest(2, 250, true);
    expect(motion.update(550)).toBe(2);
    expect(motion.update(10000)).toBe(2);
    motion.ingest(2, 10000, true);
    motion.ingest(2, 10250, true);
    expect(motion.update(10550)).toBe(2);
  });

  it('freezes at the authoritative pause and resumes without moving backwards', () => {
    const motion = new RideMotion(100, 0, true);
    motion.ingest(102, 250, true);
    expect(motion.update(400)).toBeCloseTo(100.8);
    motion.ingest(102, 410, false);
    expect(motion.update(5000)).toBe(102);
    motion.ingest(102, 5000, true);
    motion.ingest(104, 5250, true);
    expect(motion.update(5250)).toBe(102);
    expect(motion.update(5400)).toBeCloseTo(102.8);
  });

  it('uses absolute distance smoothly across a route lap', () => {
    const motion = new RideMotion(8398, 0, true);
    motion.ingest(8400, 250, true);
    motion.ingest(8402, 500, true);
    expect(motion.update(550)).toBe(8400);
    expect(motion.update(650)).toBeCloseTo(8400.8);
  });

  it('reanchors on a restored checkpoint, a new session or a long tab stall', () => {
    const motion = new RideMotion(350, 0, false);
    expect(motion.update(500)).toBe(350);
    motion.ingest(350, 500, true);
    motion.ingest(352, 750, true);
    motion.ingest(800, 1000, true);
    expect(motion.update(1000)).toBe(800);
    motion.ingest(820, 6000, true);
    expect(motion.update(6000)).toBe(820);
    motion.ingest(0, 6100, true);
    expect(motion.update(6100)).toBe(0);
  });

  it('ignores invalid and out-of-order inputs and never rewinds playback', () => {
    const motion = new RideMotion(10, 0, true);
    motion.ingest(12, 250, true);
    expect(motion.update(500)).toBeCloseTo(11.6);
    motion.ingest(13, 200, true);
    motion.ingest(NaN, 550, true);
    motion.ingest(-1, 550, true);
    expect(motion.update(450)).toBeCloseTo(11.6);
    expect(motion.update(1000)).toBe(12);
  });
});
