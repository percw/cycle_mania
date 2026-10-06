import { getWorkoutState, workouts, workoutDuration, type WorkoutBlock } from './training';
import type { RideRecord } from './storage';

export interface PowerSample {
  second: number;
  power: number;
  cadence?: number | null;
  heartRate?: number | null;
  targetPower?: number;
  measured?: boolean;
  wallSecond?: number;
  /** End of this observation on the planned workout clock, including skipped blocks. */
  workoutSecond?: number;
  blockIndex?: number;
}

export type AnalysisRide = Omit<RideRecord, 'samples'> & { samples?: PowerSample[]; workoutId?: string };

/** One measured observation per elapsed second. Gaps stay gaps, never zeros. */
export function measuredSamples(samples: PowerSample[] = [], seconds = Infinity): PowerSample[] {
  const unique = new Map<number, PowerSample>();
  for (const sample of samples) {
    if (sample.measured === false || !Number.isInteger(sample.second) || sample.second < 1 || sample.second > seconds
      || !Number.isFinite(sample.power) || sample.power < 0) continue;
    unique.set(sample.second, sample);
  }
  return [...unique.values()].sort((a, b) => a.second - b.second);
}

/** Best average for a fully observed, contiguous interval of duration seconds. */
export function bestRollingPower(samples: PowerSample[], duration: number): number | null {
  if (!Number.isInteger(duration) || duration < 1) return null;
  const clean = measuredSamples(samples);
  let sum = 0;
  let start = 0;
  let best: number | null = null;
  for (let index = 0; index < clean.length; index++) {
    if (index > 0 && (clean[index].second !== clean[index - 1].second + 1
      || (clean[index].wallSecond !== undefined && clean[index - 1].wallSecond !== undefined
        && clean[index].wallSecond! - clean[index - 1].wallSecond! > 2.5))) { sum = 0; start = index; }
    sum += clean[index].power;
    if (index - start + 1 > duration) sum -= clean[start++].power;
    if (index - start + 1 === duration) best = Math.max(best ?? 0, sum / duration);
  }
  return best === null ? null : Math.round(best);
}

export interface TargetAccuracy {
  observedSeconds: number;
  targetSeconds: number;
  inTargetSeconds: number;
  adherence: number | null;
}
export interface IntervalExecution extends TargetAccuracy {
  index: number;
  label: string;
  kind: WorkoutBlock['kind'];
  plannedSeconds: number;
  activeSeconds: number | null;
  plannedDistanceMeters: number | null;
  actualDistanceMeters: number | null;
  skipped: boolean;
  targetPower: number;
  meanPower: number | null;
  coverage: number;
}

function emptyAccuracy(): TargetAccuracy {
  return { observedSeconds: 0, targetSeconds: 0, inTargetSeconds: 0, adherence: null };
}
function workoutFor(ride: AnalysisRide) {
  return ride.workoutSnapshot ?? workouts.find(item => ride.workoutId ? item.id === ride.workoutId : item.name === ride.name);
}
function plannedPosition(ride: AnalysisRide, sample: PowerSample): number | null {
  if (Number.isFinite(sample.workoutSecond) && sample.workoutSecond! >= 1) return sample.workoutSecond!;
  // Earlier versions stored only active time: a skip makes block identity ambiguous.
  return (ride.skippedSeconds ?? 0) > 0 || (ride.skippedBlocks?.length ?? 0) > 0 ? null : sample.second;
}
function blockIndexFor(ride: AnalysisRide, sample: PowerSample): number | null {
  const workout = workoutFor(ride);
  if (!workout) return null;
  if (sample.blockIndex !== undefined) return Number.isInteger(sample.blockIndex) && sample.blockIndex >= 0 && sample.blockIndex < workout.blocks.length ? sample.blockIndex : null;
  // Distance changes the planned clock; a preview time is never an observed position.
  if (workout.blocks.some(block => block.distanceMeters !== undefined)) return null;
  const position = plannedPosition(ride, sample);
  if (position === null || position > workoutDuration(workout)) return null;
  return getWorkoutState(workout, Math.max(0, position - 0.00001)).index;
}
function targetFor(ride: AnalysisRide, sample: PowerSample): number | null {
  if (sample.targetPower !== undefined) return Number.isFinite(sample.targetPower) && sample.targetPower > 0 ? sample.targetPower : null;
  const workout = workoutFor(ride), index = blockIndexFor(ride, sample);
  if (!workout || index === null) return null;
  const target = workout.blocks[index].intensity * ride.ftp;
  return Number.isFinite(target) && target > 0 ? target : null;
}
function addObservation(group: TargetAccuracy, sample: PowerSample, target: number | null, seconds = 1) {
  if (seconds <= 0) return;
  group.observedSeconds += seconds;
  if (target === null) return;
  group.targetSeconds += seconds;
  if (Math.abs(sample.power - target) <= target * 0.1) group.inTargetSeconds += seconds;
  group.adherence = Math.round(group.inTargetSeconds / group.targetSeconds * 100);
}

/** Measured execution only. Unknown block positions remain unknown, never inferred from wattage. */
export function analyzeExecution(ride: AnalysisRide) {
  const workout = workoutFor(ride);
  const samples = ride.demo ? [] : measuredSamples(ride.samples, ride.seconds);
  const intervals: IntervalExecution[] = (workout?.blocks ?? []).map((block, index) => ({
    ...emptyAccuracy(), index, label: block.label, kind: block.kind,
    plannedSeconds: block.seconds,
    activeSeconds: ride.blockSeconds?.[index] ?? null,
    plannedDistanceMeters: block.distanceMeters ?? null,
    actualDistanceMeters: ride.blockMeters?.[index] ?? null,
    skipped: ride.skippedBlocks?.includes(index) ?? false,
    targetPower: Math.round(block.intensity * ride.ftp), meanPower: null, coverage: 0,
  }));
  const sums = intervals.map(() => 0);
  const overall = emptyAccuracy(), work = emptyAccuracy(), recovery = emptyAccuracy();
  let mappedSeconds = 0;
  for (const sample of samples) {
    const target = targetFor(ride, sample);
    addObservation(overall, sample, target);
    const index = blockIndexFor(ride, sample);
    if (index === null) continue;
    const interval = intervals[index];
    mappedSeconds++;
    // Samples are one-second observations. A fractional distance boundary can leave
    // less than one second in this block; never claim more observation than it rode.
    const observed = interval.activeSeconds === null ? 1 : Math.min(1, Math.max(0, interval.activeSeconds - interval.observedSeconds));
    addObservation(interval, sample, target, observed);
    sums[index] += sample.power * observed;
    // Include easy main blocks as work: this is plan accuracy, not a hard-effort award.
    if (interval.kind === 'work') addObservation(work, sample, target, observed);
    if (interval.kind === 'recovery') addObservation(recovery, sample, target, observed);
  }
  intervals.forEach((interval, index) => {
    const duration = interval.activeSeconds ?? (interval.plannedDistanceMeters === null ? interval.plannedSeconds : 0);
    interval.coverage = duration > 0 ? Math.min(1, interval.observedSeconds / duration) : 0;
    interval.meanPower = interval.observedSeconds ? Math.round(sums[index] / interval.observedSeconds) : null;
  });
  const activeSeconds = Math.max(0, Number.isFinite(ride.seconds) ? ride.seconds : 0);
  const plannedSeconds = workout ? workoutDuration(workout) : null;
  const plannedTimeEstimated = workout?.blocks.some(block => block.distanceMeters !== undefined) ?? false;
  const skippedSeconds = plannedTimeEstimated
    ? intervals.filter(interval => interval.skipped && interval.plannedDistanceMeters === null).reduce((sum, interval) => sum + Math.max(0, interval.plannedSeconds - (interval.activeSeconds ?? 0)), 0)
    : Math.max(0, Number.isFinite(ride.skippedSeconds) ? ride.skippedSeconds! : 0);
  return {
    intervals, overall, work, recovery, activeSeconds, plannedSeconds, skippedSeconds, plannedTimeEstimated,
    skippedBlockCount: ride.skippedBlocks?.length ?? 0,
    notRiddenSeconds: plannedSeconds === null || plannedTimeEstimated ? null : Math.max(0, plannedSeconds - activeSeconds - skippedSeconds),
    measuredSeconds: samples.length,
    coverage: Math.floor(activeSeconds) > 0 ? Math.min(1, samples.length / Math.floor(activeSeconds)) : 0,
    executionKnown: !!workout && samples.length > 0 && mappedSeconds === samples.length,
    unmappedSeconds: samples.length - mappedSeconds,
    // Requires almost all planned seconds observed, not merely high accuracy on a short sample.
    completedWorkIntervals: intervals.filter(interval => interval.kind === 'work' && !interval.skipped && interval.coverage >= 0.95
      && (interval.plannedDistanceMeters === null
        ? (interval.activeSeconds === null || interval.activeSeconds >= interval.plannedSeconds - 0.01) && interval.inTargetSeconds >= interval.plannedSeconds * 0.8
        : interval.actualDistanceMeters !== null && interval.actualDistanceMeters + 0.01 >= interval.plannedDistanceMeters
          && interval.activeSeconds !== null && interval.activeSeconds > 0 && interval.inTargetSeconds >= interval.activeSeconds * 0.8)).length,
  };
}

function adherence(ride: AnalysisRide): number | null {
  return analyzeExecution(ride).overall.adherence;
}

function comparableExecution(current: ReturnType<typeof analyzeExecution>, previous: ReturnType<typeof analyzeExecution>) {
  if (previous.coverage < 0.95) return false;
  if (current.skippedSeconds > 0 && (!current.executionKnown || !previous.executionKnown)) return false;
  return current.intervals.length === previous.intervals.length && current.intervals.every((interval, index) =>
    Math.abs(interval.observedSeconds - previous.intervals[index].observedSeconds) <= Math.max(2, interval.plannedSeconds * 0.1));
}

function samePlan(current: AnalysisRide, previous: AnalysisRide) {
  if (!current.workoutSnapshot && !previous.workoutSnapshot) return current.workoutId && previous.workoutId ? current.workoutId === previous.workoutId : current.name === previous.name;
  if (!current.workoutSnapshot || !previous.workoutSnapshot) return false;
  // Compare values in canonical order: object property order is not a revision.
  const signature = (ride: AnalysisRide) => {
    const plan = ride.workoutSnapshot!;
    return JSON.stringify([plan.id, plan.name, plan.subtitle, plan.description, plan.category, plan.difficulty, plan.custom,
      plan.blocks.map(block => [block.label, block.kind, block.seconds, block.intensity, block.distanceMeters ?? null])]);
  };
  return signature(current) === signature(previous)
    && JSON.stringify([...(current.skippedBlocks ?? [])].sort((a, b) => a - b)) === JSON.stringify([...(previous.skippedBlocks ?? [])].sort((a, b) => a - b));
}

const effortDurations = [5, 60, 300, 1200];

export function analyzeRide(ride: AnalysisRide, previousRides: AnalysisRide[] = []) {
  const samples = measuredSamples(ride.samples, ride.seconds);
  const eligible = !ride.demo && samples.length > 0;
  const coverage = Math.floor(ride.seconds) > 0 ? Math.min(1, samples.length / Math.floor(ride.seconds)) : 0;
  const previous = previousRides.filter(item => item.id !== ride.id && !item.demo
    && new Date(item.date).getTime() < new Date(ride.date).getTime());
  const bestEfforts = eligible ? effortDurations.flatMap(seconds => {
    const watts = bestRollingPower(samples, seconds);
    if (watts === null) return [];
    const previousValues = previous.map(item => bestRollingPower(measuredSamples(item.samples, item.seconds), seconds)).filter((value): value is number => value !== null);
    const previousWatts = previousValues.length ? Math.max(...previousValues) : null;
    return [{ seconds, watts, previousWatts, delta: previousWatts === null ? null : watts - previousWatts }];
  }) : [];
  const best20 = bestEfforts.find(item => item.seconds === 1200)?.watts;
  // A conservative suggestion only. A regular workout is not a maximal FTP test.
  // https://help.trainingpeaks.com/hc/en-us/articles/204071774
  const estimate = ride.rampTest || best20 === undefined ? null : Math.round(best20 * 0.95);
  const ftpEstimate = estimate === null ? null : {
    watts: estimate,
    best20MinutePower: best20!,
    suggestedIncrease: estimate > ride.ftp,
    delta: estimate - ride.ftp,
    explanation: '95 % av beste sammenhengende 20 min med målte watt. Et øktbasert estimat, ikke en FTP-test. Rolige økter sier ikke at terskelen har falt.',
  };
  const currentAdherence = eligible ? adherence(ride) : null;
  const execution = analyzeExecution(ride);
  const comparable = eligible ? previous.filter(item =>
    samePlan(ride, item)
    && item.ftp === ride.ftp && item.seconds > 0 && Math.abs(ride.seconds / item.seconds - 1) <= 0.1
    && (item.skippedSeconds ?? 0) === (ride.skippedSeconds ?? 0)
    && execution.coverage >= 0.95
    && (!ride.workoutSnapshot || (execution.executionKnown && analyzeExecution(item).executionKnown))
    && comparableExecution(execution, analyzeExecution(item)))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] : undefined;
  const previousAdherence = comparable ? adherence(comparable) : null;
  const previousSamples = comparable ? measuredSamples(comparable.samples, comparable.seconds) : [];
  const measuredAverage = (input: PowerSample[]) => input.reduce((sum, sample) => sum + sample.power, 0) / input.length;
  const comparison = comparable ? {
    previousRideId: comparable.id,
    adherence: currentAdherence,
    previousAdherence,
    adherenceDelta: currentAdherence === null || previousAdherence === null ? null : currentAdherence - previousAdherence,
    secondsDelta: Math.round(ride.seconds - comparable.seconds),
    powerDelta: Math.round(measuredAverage(samples) - measuredAverage(previousSamples)),
  } : null;
  const insights: string[] = [];
  if (ride.demo) insights.push('Demotur: teller ikke som fysisk fremgang eller grunnlag for FTP.');
  else if (!eligible) insights.push('Ingen lagrede wattmålinger. Økten er bevart, men kan ikke brukes til effektanalyse.');
  else {
    if (coverage < 0.95) insights.push(`${Math.round(coverage * 100)} % av økten har wattmålinger. Datagap fylles ikke inn i effektrekorder.`);
    const improvements = bestEfforts.filter(item => item.delta !== null && item.delta > 0);
    for (const item of improvements) insights.push(`Ny målt ${item.seconds < 60 ? `${item.seconds} sek` : `${item.seconds / 60} min`}-rekord: ${item.watts} W (+${item.delta} W).`);
    if (currentAdherence !== null) insights.push(`${currentAdherence} % av målte sekunder innenfor ±10 % av wattmålet.`);
    if (comparison?.adherenceDelta !== null && comparison?.adherenceDelta !== undefined && comparison.adherenceDelta > 0)
      insights.push(`Treffsikkerheten økte ${comparison.adherenceDelta} prosentpoeng fra forrige tilsvarende økt.`);
    if (comparison && comparison.secondsDelta > 30) insights.push(`Du syklet ${Math.round(comparison.secondsDelta / 60)} min lenger enn forrige tilsvarende økt.`);
    if (ftpEstimate?.suggestedIncrease) insights.push(`20-minuttersdata tyder på at ${ftpEstimate.watts} W kan være en aktuell terskel. Bekreft med en FTP-test før du justerer.`);
    else if (!ftpEstimate && !ride.rampTest) insights.push('FTP-estimat krever minst 20 sammenhengende minutter med målte watt.');
    if (!previous.length) insights.push('Første målte økt er utgangspunktet for senere sammenligninger.');
  }
  return { eligible, coverage, adherence: currentAdherence, bestEfforts, ftpEstimate, comparison, insights, execution };
}
