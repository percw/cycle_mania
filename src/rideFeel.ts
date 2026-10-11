import type { WorldId } from './worlds';

/**
 * How power turns into speed on screen. Road worlds stay believable but answer
 * clearly when you push; arcade worlds exaggerate on purpose, so a surge feels
 * like a launch. Both are relative to FTP, so every rider gets the same feel at
 * the same effort. Speed is presentation and virtual distance only: it never
 * changes watts, targets or any training metric.
 */
export type FeelProfile = 'road' | 'arcade';

export const MODEL = {
  road: { base: 9, gain: 31, exponent: 0.75, max: 80, tauUp: 1.4, tauDown: 3.5 },
  arcade: { base: 60, gain: 240, exponent: 1.6, max: 900, tauUp: 0.55, tauDown: 1.6 },
} as const;

const ARCADE: WorldId[] = ['tron', 'neon', 'sky'];
export function feelProfile(world: WorldId): FeelProfile {
  return ARCADE.includes(world) ? 'arcade' : 'road';
}

/** km/h the rider is heading towards at this power. Below 5 W the bike coasts to a stop. */
export function targetSpeed(profile: FeelProfile, power: number | undefined, ftp: number) {
  if (power === undefined || !Number.isFinite(power) || power < 5 || !(ftp > 0)) return 0;
  const m = MODEL[profile];
  const ratio = Math.min(3, power / ftp);
  return Math.min(m.max, m.base + m.gain * ratio ** m.exponent);
}

/** First-order response: quick to accelerate, slower to roll out. */
export function approachSpeed(current: number, target: number, dt: number, profile: FeelProfile) {
  const m = MODEL[profile];
  const tau = target > current ? m.tauUp : m.tauDown;
  const next = target + (current - target) * Math.exp(-Math.max(0, dt) / tau);
  return Math.abs(next - target) < 0.01 ? target : next;
}

/**
 * Per-frame motion for arcade worlds. The app sends a smoothed arcade speed a few
 * times a second; this eases between updates, integrates travel and exposes the
 * acceleration that drives field of view and camera effects. Large jumps in the
 * recorded distance (a restored session, a skipped block, virtual test time) are
 * followed so the scene never lags behind the workout.
 */
export class ArcadeMotion {
  travel: number;
  speed = 0;
  accel = 0;
  private lastExpected: number;

  constructor(meters: number) {
    const start = Number.isFinite(meters) ? Math.max(0, meters) : 0;
    this.travel = start;
    this.lastExpected = start;
  }

  /** Returns true when the travel jumped instead of moving smoothly. */
  update(dt: number, running: boolean, speedKmh: number, expectedMeters: number) {
    const expected = Number.isFinite(expectedMeters) ? Math.max(0, expectedMeters) : this.lastExpected;
    const jump = expected - this.lastExpected;
    this.lastExpected = expected;
    let jumped = false;
    if (jump > 40) { this.travel += jump; jumped = true; }
    if (!running) { this.speed = 0; this.accel = 0; return jumped; }
    const previous = this.speed;
    const target = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
    this.speed += (target - this.speed) * Math.min(1, Math.max(0, dt) * 6);
    this.accel = dt > 0 ? (this.speed - previous) / dt : 0;
    this.travel += (this.speed / 3.6) * Math.max(0, dt);
    return jumped;
  }
}

/** 0..1 helpers for effects: how fast, and how hard the rider is accelerating right now. */
export function speedFactor(speedKmh: number, full = 600) {
  return Math.min(1, Math.max(0, speedKmh / full));
}
export function surgeFactor(accelKmhPerS: number, full = 160) {
  return Math.min(1, Math.max(0, accelKmhPerS / full));
}
