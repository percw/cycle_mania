import type { WorkoutBlock } from "./training";
import type { WorldVisualState } from "./worlds";
export interface GameState extends WorldVisualState {
  onTarget: number;
  observed: number;
  chainSeconds: number;
  missSeconds: number;
  bestCombo: number;
  pulses: number;
  stars: number;
  masteredBlocks: number;
  blockObserved: number;
  blockOnTarget: number;
  blockIndex: number;
  event: string;
  eventAt: number;
  checkpoints: { second: number; score: number }[];
}
export interface GameResult {
  score: number;
  stars: number;
  pulses: number;
  bestCombo: number;
  onTarget: number;
  observed: number;
  masteredBlocks: number;
  checkpoints: { second: number; score: number }[];
}
export function createGame(): GameState {
  return {
    charge: 0,
    combo: 0,
    score: 0,
    phase: "warmup",
    blockProgress: 0,
    accuracy: 0,
    eventSerial: 0,
    quality: "idle",
    elapsed: 0,
    onTarget: 0,
    observed: 0,
    chainSeconds: 0,
    missSeconds: 0,
    bestCombo: 0,
    pulses: 0,
    stars: 0,
    masteredBlocks: 0,
    blockObserved: 0,
    blockOnTarget: 0,
    blockIndex: -1,
    event: "Finn rytmen",
    eventAt: -10,
    checkpoints: [],
  };
}
export function stepGame(
  previous: GameState,
  {
    seconds,
    power,
    target,
    block,
    index,
    remaining,
    elapsed,
  }: {
    seconds: number;
    power: number | undefined;
    target: number;
    block: WorkoutBlock;
    index: number;
    remaining: number;
    elapsed: number;
  },
): GameState {
  const s = { ...previous, checkpoints: [...previous.checkpoints] };
  const dt = Math.max(0, Math.min(1, seconds));
  if (index !== s.blockIndex) {
    s.blockIndex = index;
    s.blockObserved = 0;
    s.blockOnTarget = 0;
    s.phase = block.kind;
    s.chainSeconds = 0;
    s.missSeconds = 0;
    s.quality = "idle";
  }
  s.elapsed = elapsed + dt;
  s.blockProgress = Math.min(
    1,
    Math.max(0, 1 - (remaining - dt) / block.seconds),
  );
  if (!Number.isFinite(power) || !Number.isFinite(target) || target <= 0) {
    s.quality = "idle";
    return s;
  }
  const ratio = power! / target;
  const hit = ratio >= 0.9 - 1e-9 && ratio <= 1.1 + 1e-9;
  s.quality = hit ? "locked" : ratio < 0.9 ? "low" : "high";
  s.observed += dt;
  s.blockObserved += dt;
  if (hit) {
    s.onTarget += dt;
    s.blockOnTarget += dt;
    s.chainSeconds += dt;
    s.missSeconds = 0;
    s.combo = Math.min(4, 1 + Math.floor((s.chainSeconds + 1e-6) / 15));
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    s.score += dt * (1 + (s.combo - 1) * 0.25);
    s.charge += dt / 12;
    if (s.charge >= 1 - 1e-8) {
      s.charge = Math.max(0, s.charge - 1);
      s.pulses++;
      s.score += 25;
      s.eventSerial++;
      s.event = `${s.combo > 1 ? `FLYTNIVÅ ${s.combo} · ` : ""}ENERGI AKTIVERT`;
      s.eventAt = s.elapsed;
    }
  } else {
    s.missSeconds += dt;
    s.charge = Math.max(0, s.charge - dt * 0.025);
    if (s.missSeconds > 3) {
      s.chainSeconds = 0;
      s.combo = 0;
    }
  }
  s.accuracy = s.observed ? s.onTarget / s.observed : 0;
  if (
    s.checkpoints.length === 0 ||
    s.elapsed - s.checkpoints[s.checkpoints.length - 1].second >= 10
  )
    s.checkpoints.push({ second: s.elapsed, score: Math.round(s.score) });
  return s;
}
/** Call only when ridden time reaches a block end, never when skipping. */
export function completeGameBlock(
  previous: GameState,
  block: WorkoutBlock,
): GameState {
  const s = { ...previous };
  const fraction = s.blockObserved ? s.blockOnTarget / s.blockObserved : 0;
  const coverage = Math.min(1, s.blockObserved / block.seconds);
  if (coverage >= 0.85 && fraction >= 0.7) {
    const stars = fraction >= 0.95 ? 3 : fraction >= 0.85 ? 2 : 1;
    s.stars += stars;
    s.score += stars * 40;
    if (stars >= 2 && block.kind === "work") s.masteredBlocks++;
    s.event = `${"★".repeat(stars)} ${block.kind === "recovery" || block.kind === "cooldown" ? "PERFEKT KONTROLL" : "SEGMENT MESTRET"}`;
    s.eventAt = s.elapsed;
    s.eventSerial++;
  }
  return s;
}
export function gameResult(s: GameState): GameResult {
  return {
    score: Math.round(s.score),
    stars: s.stars,
    pulses: s.pulses,
    bestCombo: s.bestCombo,
    onTarget: s.onTarget,
    observed: s.observed,
    masteredBlocks: s.masteredBlocks,
    checkpoints: [
      ...s.checkpoints,
      { second: s.elapsed, score: Math.round(s.score) },
    ],
  };
}
export function ghostScore(
  result: GameResult | undefined,
  elapsed: number,
): number | null {
  if (!result?.checkpoints?.length) return null;
  const sorted = result.checkpoints;
  const last = sorted[sorted.length - 1];
  if (elapsed > last.second) return null;
  let before = { second: 0, score: 0 };
  for (const point of sorted) {
    if (point.second >= elapsed) {
      const t =
        (elapsed - before.second) /
        Math.max(0.001, point.second - before.second);
      return Math.round(before.score + (point.score - before.score) * t);
    }
    before = point;
  }
  return null;
}
export function careerLevel(xp: number) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 600)) + 1;
  const floor = 600 * (level - 1) ** 2;
  const next = 600 * level ** 2;
  return {
    level,
    progress: (xp - floor) / (next - floor),
    remaining: next - xp,
    title:
      level >= 8
        ? "Legende"
        : level >= 5
          ? "Pilot"
          : level >= 3
            ? "Utforsker"
            : "Rekrutt",
  };
}
