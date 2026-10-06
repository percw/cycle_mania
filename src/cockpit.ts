import { workoutDuration, type Workout, type WorkoutBlock } from './training';

/** Minimal sample shape the cockpit reads; matches Session["samples"] entries. */
export type CockpitSample = {
  second: number;
  power: number;
  targetPower?: number;
  workoutSecond?: number;
  blockIndex?: number;
  measured?: boolean;
};

export type TargetState = 'none' | 'under' | 'on' | 'over';

/** The ±10 % band matches the game, expedition and achievement rules. */
export const TARGET_BAND = 0.1;
/** The gauge shows target ±30 %; anything beyond is pinned to the edge. */
export const GAUGE_SPAN = 0.3;

export function targetFeedback(power: number | undefined, target: number) {
  if (power === undefined || !Number.isFinite(power) || !(target > 0))
    return { state: 'none' as TargetState, delta: 0, ratio: 0 };
  const delta = Math.round(power - target);
  const ratio = power / target - 1;
  const state: TargetState = Math.abs(ratio) <= TARGET_BAND + 1e-9 ? 'on' : ratio < 0 ? 'under' : 'over';
  return { state, delta, ratio };
}

/** Position of the power marker on the gauge, 0 = target −30 %, 1 = target +30 %. */
export function gaugePosition(power: number | undefined, target: number) {
  if (power === undefined || !(target > 0)) return 0.5;
  const ratio = power / target - 1;
  return Math.min(1, Math.max(0, (ratio + GAUGE_SPAN) / (GAUGE_SPAN * 2)));
}

/**
 * Time-weighted mean of the readings inside the window. Each reading holds
 * until the next one, so a steady sensor that only reports on change still
 * averages correctly. Display only: recorded samples stay untouched.
 */
export function smoothedPower(readings: { at: number; power: number }[], now: number, windowMs = 3000) {
  if (!readings.length) return undefined;
  const from = now - windowMs;
  let weighted = 0, total = 0;
  for (let i = 0; i < readings.length; i++) {
    const start = Math.max(from, readings[i].at);
    const end = Math.min(now, readings[i + 1]?.at ?? now);
    if (end <= start) continue;
    weighted += readings[i].power * (end - start);
    total += end - start;
  }
  return total > 0 ? Math.round(weighted / total) : Math.round(readings[readings.length - 1].power);
}

export function blockStarts(workout: Workout) {
  const starts: number[] = [];
  let at = 0;
  for (const block of workout.blocks) { starts.push(at); at += block.seconds; }
  return starts;
}

function blockAt(starts: number[], workout: Workout, planSecond: number) {
  for (let i = starts.length - 1; i >= 0; i--) if (planSecond >= starts[i]) return Math.min(i, workout.blocks.length - 1);
  return 0;
}

/**
 * Plan position (x) and block for every sample. Built-in workouts carry the
 * exact plan second; custom plans carry the block index, so the x position
 * inside the block is the sample's order within that block (1 Hz samples).
 * Older samples with neither field fall back to elapsed seconds.
 */
export function placeSamples(workout: Workout, samples: CockpitSample[]) {
  const starts = blockStarts(workout);
  const seen = new Map<number, number>();
  return samples.map(sample => {
    if (sample.blockIndex !== undefined) {
      const index = Math.min(Math.max(0, sample.blockIndex), workout.blocks.length - 1);
      const rank = (seen.get(index) ?? 0) + 1;
      seen.set(index, rank);
      return { x: starts[index] + Math.min(rank, workout.blocks[index].seconds), index, sample };
    }
    const x = sample.workoutSecond ?? sample.second;
    return { x, index: blockAt(starts, workout, Math.max(0, x - 0.5)), sample };
  });
}

export function blockStats(workout: Workout, samples: CockpitSample[], index: number) {
  const block = workout.blocks[index];
  const own = placeSamples(workout, samples).filter(p => p.index === index).map(p => p.sample);
  const withTarget = own.filter(s => (s.targetPower ?? 0) > 0);
  const onTarget = withTarget.filter(s => Math.abs(s.power / (s.targetPower as number) - 1) <= TARGET_BAND + 1e-9).length;
  const avg = own.length ? Math.round(own.reduce((sum, s) => sum + s.power, 0) / own.length) : undefined;
  return {
    block,
    seconds: own.length,
    avgPower: avg,
    inBand: withTarget.length ? onTarget / withTarget.length : undefined,
    /** Share of the planned block that was actually observed (skips lower it). */
    coverage: block && block.seconds > 0 ? Math.min(1, own.length / block.seconds) : 0,
  };
}

/**
 * Trace for the workout graph as SVG path data in a 0..total × 0..100 box.
 * Long rides are bucketed so the path stays light to redraw four times a second.
 * Gaps longer than three plan seconds (skips, pauses without data) break the line.
 */
export function tracePath(workout: Workout, samples: CockpitSample[], ftp: number, maxIntensity: number, maxPoints = 600) {
  if (!samples.length || !(ftp > 0)) return '';
  const placed = placeSamples(workout, samples);
  const total = Math.max(1, workoutDuration(workout));
  const bucket = Math.max(1, Math.ceil(total / maxPoints));
  const points: { x: number; y: number }[] = [];
  let acc = 0, n = 0, key = -1, lastX = 0;
  const flush = () => {
    if (!n) return;
    const ratio = acc / n / ftp / maxIntensity;
    points.push({ x: lastX, y: 100 - Math.min(104, Math.max(0, ratio * 92)) });
    acc = 0; n = 0;
  };
  for (const p of placed) {
    const k = Math.floor(p.x / bucket);
    if (k !== key) { flush(); key = k; }
    acc += p.sample.power; n++; lastX = p.x;
  }
  flush();
  let d = '';
  points.forEach((p, i) => {
    const jump = i === 0 || p.x - points[i - 1].x > Math.max(3, bucket * 2.5);
    d += `${jump ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  });
  return d;
}

export function blockHeight(block: WorkoutBlock, maxIntensity: number) {
  return Math.max(8, Math.min(100, (block.intensity / maxIntensity) * 92));
}

export function phaseName(kind: WorkoutBlock['kind']) {
  return kind === 'warmup' ? 'Oppvarming' : kind === 'recovery' ? 'Pause' : kind === 'cooldown' ? 'Nedkjøring' : 'Drag';
}
