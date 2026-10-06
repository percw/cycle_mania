import { measuredSamples, type IntervalExecution, type PowerSample } from './analytics';

/** Splits measured 1 Hz samples into contiguous runs; pauses and data gaps end a run. */
function contiguous(samples: PowerSample[]) {
  const runs: PowerSample[][] = [];
  for (const sample of samples) {
    const run = runs.at(-1), last = run?.at(-1);
    const gap = !last || sample.second !== last.second + 1
      || (sample.wallSecond !== undefined && last.wallSecond !== undefined && sample.wallSecond - last.wallSecond > 2.5);
    if (gap) runs.push([sample]); else run!.push(sample);
  }
  return runs;
}

/**
 * Normalized power: 30 s rolling mean, fourth-power average, fourth root.
 * Rolling windows never span a gap. Needs at least ten minutes of rolling values;
 * shorter rides return null rather than an unstable number.
 */
export function normalizedPower(samples: PowerSample[], seconds = Infinity): number | null {
  const rolling: number[] = [];
  for (const run of contiguous(measuredSamples(samples, seconds))) {
    let sum = 0;
    run.forEach((sample, index) => {
      sum += sample.power;
      if (index >= 30) sum -= run[index - 30].power;
      if (index >= 29) rolling.push(sum / 30);
    });
  }
  if (rolling.length < 600) return null;
  const mean4 = rolling.reduce((acc, value) => acc + value ** 4, 0) / rolling.length;
  return Math.round(mean4 ** 0.25);
}

/** Intensity factor and training stress from measured seconds only (TrainingPeaks definitions). */
export function trainingLoad(np: number | null, measuredSeconds: number, ftp: number) {
  if (np === null || !(ftp > 0) || measuredSeconds <= 0) return null;
  const intensity = np / ftp;
  return { intensity: Math.round(intensity * 100) / 100, tss: Math.round((measuredSeconds * np * intensity) / (ftp * 3600) * 100) };
}

export function sampleAverages(samples: PowerSample[], seconds = Infinity) {
  const clean = measuredSamples(samples, seconds);
  const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const hr = clean.map(s => s.heartRate).filter((v): v is number => typeof v === 'number' && v > 0);
  const cad = clean.map(s => s.cadence).filter((v): v is number => typeof v === 'number' && v > 0);
  return {
    heartRate: mean(hr), maxHeartRate: hr.length ? Math.max(...hr) : null,
    cadence: mean(cad), maxPower: clean.length ? Math.max(...clean.map(s => s.power)) : null,
  };
}

export type Tone = 'great' | 'good' | 'mixed' | 'off' | 'neutral';

export function verdict({ demo, adherence, measuredSeconds, completedWork, workCount, skippedSeconds }: {
  demo: boolean; adherence: number | null; measuredSeconds: number; completedWork: number; workCount: number; skippedSeconds: number;
}): { title: string; detail: string; tone: Tone } {
  if (demo) return { title: 'Demotur fullført', detail: 'Simulerte watt. Turen teller ikke i treningshistorikken, rekorder eller FTP.', tone: 'neutral' };
  if (!measuredSeconds || adherence === null) return { title: 'Økten er lagret', detail: 'Uten gyldige wattmålinger kan gjennomføringen ikke vurderes.', tone: 'neutral' };
  const title = adherence >= 90 ? 'Presis gjennomføring' : adherence >= 75 ? 'God kontroll' : adherence >= 50 ? 'Ujevn, men gjennomført' : 'Mye tid utenfor målet';
  const tone: Tone = adherence >= 90 ? 'great' : adherence >= 75 ? 'good' : adherence >= 50 ? 'mixed' : 'off';
  const parts = [`${adherence} % av hoveddelen innenfor ±10 % av wattmålet`];
  if (workCount > 1) parts.push(`${completedWork} av ${workCount} drag fullført`);
  if (skippedSeconds >= 30) parts.push('deler av planen ble hoppet over');
  return { title, detail: parts.join(' · ') + '.', tone };
}

/**
 * First versus last fully observed work interval, relative to each target.
 * A pacing observation, not a fitness claim.
 */
export function pacing(intervals: IntervalExecution[]) {
  const work = intervals.filter(i => i.kind === 'work' && !i.skipped && i.coverage >= 0.8 && i.meanPower !== null && i.targetPower > 0);
  if (work.length < 2) return null;
  const ratio = (i: IntervalExecution) => i.meanPower! / i.targetPower;
  const first = work[0], last = work[work.length - 1];
  const change = Math.round((ratio(last) - ratio(first)) * 100);
  const spread = Math.round((Math.max(...work.map(ratio)) - Math.min(...work.map(ratio))) * 100);
  const text = Math.abs(change) <= 2
    ? `Jevnt fra første til siste drag (${change >= 0 ? '+' : ''}${change} %-poeng mot målet).`
    : change <= -5
      ? `Effekten falt ${-change} %-poeng mot målet fra første til siste drag. En litt roligere start kan gi jevnere drag.`
      : change < 0
      ? `Effekten falt litt fra første til siste drag (${change} %-poeng mot målet).`
      : `Sterkere mot slutten: +${change} %-poeng mot målet i siste drag.`;
  return { change, spread, text, tone: (Math.abs(change) <= 2 ? 'great' : change < -5 ? 'mixed' : 'good') as Tone, count: work.length };
}

/** 5 s centred rolling mean per contiguous run, for a readable chart line. */
export function smoothedSeries(samples: PowerSample[], seconds = Infinity, window = 5) {
  const out: { second: number; power: number; target?: number; heartRate?: number | null; cadence?: number | null; gapBefore: boolean }[] = [];
  for (const run of contiguous(measuredSamples(samples, seconds))) {
    const half = Math.floor(window / 2);
    run.forEach((sample, index) => {
      const from = Math.max(0, index - half), to = Math.min(run.length - 1, index + half);
      let sum = 0;
      for (let k = from; k <= to; k++) sum += run[k].power;
      out.push({ second: sample.second, power: sum / (to - from + 1), target: sample.targetPower, heartRate: sample.heartRate, cadence: sample.cadence, gapBefore: index === 0 });
    });
  }
  return out;
}
