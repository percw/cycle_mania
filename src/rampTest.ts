import type { Workout } from './training';
import type { RideRecord, RideSample } from './storage';
import type { RampHistoryPoint, RampProtocol, RampResult, RampTestRecord } from './rampTypes';
export type { RampProtocol, RampTestRecord, RampResult, RampHistoryPoint } from './rampTypes';

export const STANDARD_RAMP_PROTOCOL: RampProtocol = Object.freeze({
  version: 1, startWatts: 100, stepWatts: 20, stageSeconds: 60,
  warmupSeconds: 300, cooldownSeconds: 180, maxStages: 40,
});
export const GENTLE_RAMP_PROTOCOL: RampProtocol = Object.freeze({ ...STANDARD_RAMP_PROTOCOL, startWatts: 50, stepWatts: 10 });

export function isRampProtocol(value: unknown): value is RampProtocol {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<RampProtocol>;
  return p.version === 1 && p.stageSeconds === 60 && p.warmupSeconds === 300
    && p.cooldownSeconds === 180 && p.maxStages === 40
    && Number.isInteger(p.startWatts) && p.startWatts! >= 25 && p.startWatts! <= 250
    && Number.isInteger(p.stepWatts) && p.stepWatts! >= 5 && p.stepWatts! <= 40;
}

export function rampProtocolKey(protocol: RampProtocol): string {
  return `ramp-v1-${protocol.startWatts}-${protocol.stepWatts}`;
}

export function rampWorkout(protocol: RampProtocol, ftp: number): Workout {
  if (!isRampProtocol(protocol) || !Number.isFinite(ftp) || ftp <= 0) throw new Error('Ugyldig rampeprotokoll eller FTP.');
  return {
    ramp: { ...protocol }, id: rampProtocolKey(protocol), name: 'FTP rampetest', category: 'FTP-test', difficulty: 3,
    subtitle: `${protocol.startWatts} W start · +${protocol.stepWatts} W hvert minutt`,
    description: 'Sitt på setet og følg wattmålet med jevn tråkkfrekvens. Avslutt rampen når du ikke lenger klarer målet. Resultatet er et FTP-anslag basert på beste sammenhengende minutt.',
    blocks: [
      { label: 'Rolig oppvarming', seconds: 300, intensity: protocol.startWatts * 0.75 / ftp, kind: 'warmup' },
      ...Array.from({ length: protocol.maxStages }, (_, stage) => ({
        label: `Trinn ${stage + 1} · ${protocol.startWatts + stage * protocol.stepWatts} W`,
        seconds: protocol.stageSeconds, intensity: (protocol.startWatts + stage * protocol.stepWatts) / ftp,
        kind: 'work' as const,
      })),
      { label: 'Rolig nedkjøring', seconds: 180, intensity: protocol.startWatts * 0.6 / ftp, kind: 'cooldown' },
    ],
  };
}

type RampRide = RideRecord & { rampTest?: RampTestRecord };

/** A stop between two observed ramp samples is a pause, even if active seconds are contiguous. */
function continuous(previous: RideSample, current: RideSample): boolean {
  if (current.second !== previous.second + 1) return false;
  if (previous.wallSecond !== undefined && current.wallSecond !== undefined) {
    const wallDelta = current.wallSecond - previous.wallSecond;
    if (!Number.isFinite(wallDelta) || wallDelta < 0 || wallDelta > 2.5) return false;
  }
  return true;
}

/**
 * 75% of best measured rolling minute: TrainerRoad's ramp-test convention.
 * https://support.trainerroad.com/hc/trainerroad-support/articles/360003910912-how-to-test-with-the-ramp-test
 * Coverage, adherence and minimum duration below are app quality gates, not a
 * claim of physiological validation. A ramp estimate is not a direct FTP measurement.
 */
export function analyzeRampTest(ride: RampRide): RampResult | null {
  const test = ride.rampTest;
  if (!test || test.version !== 1 || !isRampProtocol(test.protocol)
    || !Number.isFinite(test.endSecond) || test.endSecond < 0 || test.endSecond > ride.seconds
    || !Number.isFinite(test.referenceFtp) || test.referenceFtp <= 0
    || !['exhaustion', 'aborted', 'ceiling'].includes(test.reason) || typeof test.interrupted !== 'boolean') return null;
  const p = test.protocol;
  const rampEnd = Math.min(Math.floor(test.endSecond), p.warmupSeconds + p.maxStages * p.stageSeconds);
  const rampSeconds = Math.max(0, rampEnd - p.warmupSeconds);
  const unique = new Map<number, RideSample>();
  for (const sample of ride.samples ?? []) {
    if ((!ride.demo && sample.measured !== true) || !Number.isInteger(sample.second)
      || sample.second <= p.warmupSeconds || sample.second > rampEnd
      || !Number.isFinite(sample.power) || sample.power < 0) continue;
    // Conflicting duplicate observations cannot manufacture extra seconds.
    if (!unique.has(sample.second)) unique.set(sample.second, sample);
  }
  const samples = [...unique.values()].sort((a, b) => a.second - b.second);
  const coverage = rampSeconds ? samples.length / rampSeconds * 100 : 0;
  let sum = 0, windowStart = 0;
  let best60Watts: number | null = null, best60EndSecond: number | null = null;
  let wallGap = false;
  for (let index = 0; index < samples.length; index++) {
    if (index && !continuous(samples[index - 1], samples[index])) {
      const a = samples[index - 1], b = samples[index];
      // Missing telemetry is assessed by coverage; a wall-time pause is separately invalid.
      if (a.wallSecond !== undefined && b.wallSecond !== undefined
        && (b.wallSecond - a.wallSecond > b.second - a.second + 1.5 || b.wallSecond < a.wallSecond)) wallGap = true;
      sum = 0; windowStart = index;
    }
    sum += samples[index].power;
    if (index - windowStart + 1 > 60) sum -= samples[windowStart++].power;
    if (index - windowStart + 1 === 60 && (best60Watts === null || sum / 60 > best60Watts)) {
      best60Watts = sum / 60;
      best60EndSecond = samples[index].second;
    }
  }
  // The final 15 seconds may contain the natural failure/drop-off that ends a test.
  const adherenceSamples = samples.filter(sample => sample.second <= rampEnd - 15);
  const onTarget = adherenceSamples.filter(sample => {
    const stage = Math.floor((sample.second - p.warmupSeconds - 1) / p.stageSeconds);
    const target = p.startWatts + stage * p.stepWatts;
    return Math.abs(sample.power - target) <= target * 0.15;
  }).length;
  const adherence = adherenceSamples.length ? onTarget / adherenceSamples.length * 100 : null;
  const firstWall = samples[0]?.wallSecond, lastWall = samples.at(-1)?.wallSecond;
  const paused = test.interrupted || wallGap || (firstWall !== undefined && lastWall !== undefined
    && (ride.timerEvents ?? []).some(event => event.type === 'stop' && event.wallSecond >= firstWall && event.wallSecond < lastWall));
  const issues: string[] = [];
  if (ride.demo) issues.push('Demo: simulerte watt gir ikke et personlig FTP-anslag.');
  if (test.reason === 'aborted') issues.push('Testen ble avbrutt før utmattelse.');
  if (test.reason === 'ceiling' || test.endSecond >= p.warmupSeconds + p.maxStages * p.stageSeconds) issues.push('Alle trinn ble fullført. Velg en høyere rampe for en ny test.');
  if (paused) issues.push('Rampen ble pauset eller avbrutt. Kjør en sammenhengende test.');
  if ((ride.skippedSeconds ?? 0) > 0 || (ride.skippedBlocks?.length ?? 0) > 0) issues.push('Et segment ble hoppet over. Testen kan ikke sammenlignes.');
  if (rampSeconds < 300) issues.push('Rampen var kortere enn fem minutter. Velg en roligere rampe.');
  if (coverage < 95) issues.push('Mindre enn 95 % av rampen har målt effekt.');
  if (adherence === null || adherence < 85) issues.push('Wattmålet ble fulgt for lite til et pålitelig rampeanslag.');
  if (best60Watts === null || best60Watts <= 0) issues.push('Mangler et helt sammenhengende minutt med målt effekt.');
  const previewFtp = best60Watts !== null && best60Watts > 0 ? Math.round(best60Watts * 0.75) : null;
  const valid = issues.length === 0;
  return {
    rideId: ride.id, date: ride.date, protocolKey: rampProtocolKey(p), protocol: { ...p },
    referenceFtp: test.referenceFtp, rampSeconds, completedStages: Math.floor(rampSeconds / 60),
    finalStageWatts: p.startWatts + Math.max(0, Math.ceil(rampSeconds / 60) - 1) * p.stepWatts,
    best60Watts, best60EndSecond, best60StartSecond: best60EndSecond === null ? null : best60EndSecond - 59,
    estimatedFtp: valid ? previewFtp : null, previewFtp, valid, demo: ride.demo,
    coverage, adherence, issues, reason: test.reason,
  };
}

/** Deltas always use the previous valid real test with the exact same protocol. */
export function comparableRampHistory(history: RampRide[], protocol?: RampProtocol | string): RampHistoryPoint[] {
  const key = typeof protocol === 'string' ? protocol : protocol ? rampProtocolKey(protocol) : null;
  const results = history.map(analyzeRampTest).filter((result): result is RampResult =>
    result !== null && result.valid && result.estimatedFtp !== null && !result.demo
      && (!key || result.protocolKey === key) && Number.isFinite(Date.parse(result.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.rideId.localeCompare(b.rideId));
  const seen = new Set<string>(), previous = new Map<string, number>();
  return results.filter(result => !seen.has(result.rideId) && !!seen.add(result.rideId)).map(result => {
    const previousFtp = previous.get(result.protocolKey) ?? null;
    const deltaWatts = previousFtp === null ? null : result.estimatedFtp! - previousFtp;
    previous.set(result.protocolKey, result.estimatedFtp!);
    return { ...result, previousFtp, deltaWatts,
      deltaPercent: previousFtp === null || previousFtp <= 0 ? null : deltaWatts! / previousFtp * 100 };
  });
}
