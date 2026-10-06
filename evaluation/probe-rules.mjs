import { writeFileSync } from 'node:fs';
import { createGame, stepGame, completeGameBlock, gameResult, careerLevel } from '../src/game.ts';

// Deterministic synthetic watt streams through the actual game engine.
// These are rule probes, not sensor recordings or human enjoyment measurements.
const blocks = [
  { label: 'Warmup', kind: 'warmup', seconds: 300, intensity: .5 },
  { label: 'Work 1', kind: 'work', seconds: 600, intensity: 1 },
  { label: 'Recovery', kind: 'recovery', seconds: 180, intensity: .5 },
  { label: 'Work 2', kind: 'work', seconds: 600, intensity: 1 },
  { label: 'Cooldown', kind: 'cooldown', seconds: 300, intensity: .5 },
];
const streams = [
  { id: 'on_target', label: 'Exactly prescribed target throughout', signal: () => 1 },
  { id: 'gentle_variation', label: 'Smooth variation within ±8% of target', signal: t => 1 + .08 * Math.sin(t / 4) },
  { id: 'wide_variation', label: 'Smooth variation within ±20% of target', signal: t => 1 + .2 * Math.sin(t / 4) },
  { id: 'overshoot', label: 'Constant 125% of target', signal: () => 1.25 },
  { id: 'fatigue', label: 'Work starts at target and linearly falls to 85%; other segments at target', signal: (t, block) => block.kind === 'work' ? 1 - .15 * t / block.seconds : 1 },
  { id: 'missing_data', label: 'No data for seconds 20–29 in each minute, otherwise target', signal: t => t % 60 >= 20 && t % 60 < 30 ? undefined : 1 },
];
const results = streams.map(stream => {
  let game = createGame(), elapsed = 0;
  const segments = [];
  for (const [index, block] of blocks.entries()) {
    const startScore = game.score, startStars = game.stars, startPulses = game.pulses;
    for (let t = 0; t < block.seconds; t++) {
      const ratio = stream.signal(t, block);
      game = stepGame(game, { seconds: 1, power: ratio === undefined ? undefined : 250 * block.intensity * ratio,
        target: 250 * block.intensity, block, index, remaining: block.seconds - t, elapsed });
      elapsed++;
    }
    game = completeGameBlock(game, block);
    segments.push({ kind: block.kind, seconds: block.seconds, score: Math.round(game.score - startScore),
      stars: game.stars - startStars, pulses: game.pulses - startPulses,
      coverage: Number((game.blockObserved / block.seconds).toFixed(3)),
      targetFractionOfObserved: Number((game.blockOnTarget / Math.max(1, game.blockObserved)).toFixed(3)) });
  }
  const result = gameResult(game);
  delete result.checkpoints;
  return { scenario: stream.id, label: stream.label, ...result, segments, careerFromOneRide: careerLevel(result.score) };
});
writeFileSync(new URL('./runtime-probes.json', import.meta.url), JSON.stringify({
  kind: 'deterministic_rule_probes', date: '2026-09-30', ftp: 250, seconds: 1980,
  limitation: 'Engine-only synthetic streams. Missing-data probe bypasses app auto-pause and is NOT an end-to-end BLE test. No claim of human enjoyment or measured hardware performance.', results
}, null, 2));
console.log(JSON.stringify(results.map(({ scenario, score, stars, pulses, bestCombo }) => ({ scenario, score, stars, pulses, bestCombo })), null, 2));
