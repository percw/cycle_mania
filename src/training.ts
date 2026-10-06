import type { RampProtocol } from "./rampTypes";
export type WorkoutBlock = {
  label: string;
  seconds: number;
  intensity: number;
  kind: 'warmup' | 'work' | 'recovery' | 'cooldown';
  /** Virtual meters; seconds is only a 30 km/h preview estimate for this block. */
  distanceMeters?: number;
};

export type Workout = {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  description: string;
  blocks: WorkoutBlock[];
  difficulty: 1 | 2 | 3;
  custom?: boolean;
  ramp?: RampProtocol;
};

// Continuous display boundaries avoid gaps between the rounded percentages.
// Source: https://www.trainingpeaks.com/blog/power-training-levels/
// >150% is a practical sprint display convention. Coggan's neuromuscular
// level is effort-based and does not have a fixed percentage of FTP.
export const zones = [
  { id: 1, name: 'Restitusjon', min: 0, max: 0.55, color: '#8ea7ba' },
  { id: 2, name: 'Utholdenhet', min: 0.55, max: 0.75, color: '#5bbefa' },
  { id: 3, name: 'Tempo', min: 0.75, max: 0.9, color: '#54db9e' },
  { id: 4, name: 'Terskel', min: 0.9, max: 1.05, color: '#f5ce68' },
  { id: 5, name: 'VO₂ maks', min: 1.05, max: 1.2, color: '#ff9866' },
  { id: 6, name: 'Anaerob', min: 1.2, max: 1.5, color: '#ff647d' },
  { id: 7, name: 'Sprint', min: 1.5, max: Infinity, color: '#c797ff' },
];

export function getZone(watts: number, ftp: number) {
  const fraction = Number.isFinite(watts) && Number.isFinite(ftp) && ftp > 0
    ? Math.max(0, watts) / ftp : 0;
  return zones.find(zone => fraction <= zone.max) ?? zones[6];
}

const block = (label: string, seconds: number, intensity: number, kind: WorkoutBlock['kind'] = 'work'): WorkoutBlock =>
  ({ label, seconds, intensity, kind });

function repeats(count: number, minutes: number, intensity: number, recovery: number): WorkoutBlock[] {
  return Array.from({ length: count }, (_, index) => [
    block(`Drag ${index + 1} av ${count}`, minutes * 60, intensity),
    ...(index < count - 1 && recovery > 0 ? [block('Aktiv pause', recovery * 60, 0.5, 'recovery')] : []),
  ]).flat();
}

function make(id: string, name: string, category: string, main: WorkoutBlock[], difficulty: 1 | 2 | 3,
  description: string, warmup = 10, cooldown = 5): Workout {
  const work = main.filter(item => item.kind === 'work');
  const min = Math.round(Math.min(...work.map(item => item.intensity)) * 100);
  const max = Math.round(Math.max(...work.map(item => item.intensity)) * 100);
  return {
    id, name, category, difficulty, description,
    subtitle: `${min === max ? min : `${min}–${max}`} % FTP · ${category}`,
    blocks: [
      block('Rolig oppvarming', warmup * 30, 0.5, 'warmup'),
      block('Finn rytmen', warmup * 30, category === 'Restitusjon' ? 0.5 : 0.65, 'warmup'),
      ...main,
      block('Nedkjøring', cooldown * 60, 0.45, 'cooldown'),
    ],
  };
}

type IntervalSpec = [id: string, name: string, count: number, minutes: number, intensity: number, recovery: number];
const intervalFamily = (category: string, difficulty: 1 | 2 | 3, description: string, specs: IntervalSpec[]) =>
  specs.map(([id, name, count, minutes, intensity, recovery]) =>
    make(id, name, category, repeats(count, minutes, intensity, recovery), difficulty, description));

// 100 curated sessions inspired by familiar interval formats; this is not a
// popularity ranking or a claim that every prescription fits every rider.
export const workouts: Workout[] = [
  ...intervalFamily('Terskel', 2, 'Jevne drag rundt terskel. Finn en effekt du kan holde gjennom hele serien.', [
    ['threshold-3x10', '3 × 10 min', 3, 10, 1, 3],
    ['threshold-4x10', '4 × 10 min', 4, 10, 0.98, 3],
    ['threshold-2x20', '2 × 20 min', 2, 20, 0.98, 5],
    ['threshold-2x25', '2 × 25 min', 2, 25, 0.95, 5],
    ['threshold-2x30', '2 × 30 min', 2, 30, 0.93, 5],
    ['threshold-3x8', '3 × 8 min', 3, 8, 1.02, 3],
    ['threshold-4x8', '4 × 8 min', 4, 8, 1.02, 3],
    ['threshold-5x8', '5 × 8 min', 5, 8, 1, 3],
    ['threshold-3x12', '3 × 12 min', 3, 12, 1, 4],
    ['threshold-4x12', '4 × 12 min', 4, 12, 0.97, 4],
    ['threshold-2x15', '2 × 15 min', 2, 15, 1, 4],
    ['threshold-3x15', '3 × 15 min', 3, 15, 0.98, 4],
    ['threshold-2x12', '2 × 12 min', 2, 12, 1.02, 4],
    ['threshold-5x6', '5 × 6 min', 5, 6, 1.04, 2],
    ['threshold-6x5', '6 × 5 min', 6, 5, 1.04, 2],
  ]),
  ...[2, 3, 4].map(count => make(`over-under-${count}x12`, `${count} × 12 over / under`, 'Terskel',
    Array.from({ length: count }, (_, index) => [
      ...Array.from({ length: 4 }, () => [block('Under terskel', 120, 0.95), block('Over terskel', 60, 1.05)]).flat(),
      ...(index < count - 1 ? [block('Aktiv pause', 240, 0.5, 'recovery')] : []),
    ]).flat(), 3, 'Veksle mellom to minutter på 95 % og ett minutt på 105 % FTP. Fire vekslinger per drag.')),
  make('threshold-pyramid', 'Terskelpyramiden', 'Terskel',
    [6, 8, 10, 8, 6].flatMap((minutes, index) => [block(`${minutes} min terskel`, minutes * 60, 1),
      ...(index < 4 ? [block('Aktiv pause', 180, 0.5, 'recovery')] : [])]), 2,
    'Bygg fra seks til ti minutter, og jobb deg ned igjen. Tre minutter pause mellom dragene.'),
  make('threshold-progression', 'Tre trinn til terskel', 'Terskel',
    [block('Kontrollert start', 600, 0.92), block('Bygg trykket', 600, 0.98), block('På terskel', 600, 1.02)], 2,
    'Tre sammenhengende trinn på ti minutter. Øk effekten litt for hvert trinn.'),

  ...intervalFamily('Sweet spot', 2, 'Kontrollerte drag like under terskel. Hold jevn effekt og en avslappet overkropp.', [
    ['sweetspot-2x10', '2 × 10 sweet spot', 2, 10, 0.9, 3],
    ['sweetspot-3x10', '3 × 10 sweet spot', 3, 10, 0.9, 3],
    ['sweetspot-4x10', '4 × 10 sweet spot', 4, 10, 0.9, 3],
    ['sweetspot-2x12', '2 × 12 sweet spot', 2, 12, 0.9, 3],
    ['sweetspot-3x12', '3 × 12 sweet spot', 3, 12, 0.9, 3],
    ['sweetspot-2x15', '2 × 15 sweet spot', 2, 15, 0.9, 4],
    ['sweetspot-3x15', '3 × 15 sweet spot', 3, 15, 0.9, 4],
    ['sweetspot-2x20', '2 × 20 sweet spot', 2, 20, 0.9, 5],
    ['sweetspot-3x20', '3 × 20 sweet spot', 3, 20, 0.88, 5],
    ['sweetspot-2x25', '2 × 25 sweet spot', 2, 25, 0.88, 5],
    ['sweetspot-2x30', '2 × 30 sweet spot', 2, 30, 0.88, 5],
    ['sweetspot-1x30', '30 min sweet spot', 1, 30, 0.9, 0],
    ['sweetspot-1x40', '40 min sweet spot', 1, 40, 0.88, 0],
    ['sweetspot-4x8', '4 × 8 sweet spot', 4, 8, 0.92, 2],
    ['sweetspot-5x6', '5 × 6 sweet spot', 5, 6, 0.92, 2],
  ]),

  ...intervalFamily('VO₂ maks', 3, 'Harde, repeterbare drag. Målet er å fullføre siste drag med like god kontroll som det første.', [
    ['vo2-4x4', '4 × 4 min', 4, 4, 1.12, 3],
    ['vo2-5x4', '5 × 4 min', 5, 4, 1.12, 3],
    ['vo2-6x4', '6 × 4 min', 6, 4, 1.1, 3],
    ['vo2-4x5', '4 × 5 min', 4, 5, 1.1, 4],
    ['vo2-5x5', '5 × 5 min', 5, 5, 1.08, 4],
    ['vo2-3x6', '3 × 6 min', 3, 6, 1.08, 4],
    ['vo2-4x6', '4 × 6 min', 4, 6, 1.08, 4],
    ['vo2-5x3', '5 × 3 min', 5, 3, 1.18, 3],
    ['vo2-6x3', '6 × 3 min', 6, 3, 1.16, 3],
    ['vo2-8x2', '8 × 2 min', 8, 2, 1.2, 2],
    ['vo2-10x1', '10 × 1 min', 10, 1, 1.2, 1],
  ]),
  ...([
    ['micro-30-15-2', '2 × 10 × 30/15', 2, 10, 30, 15],
    ['micro-30-15-3', '3 × 10 × 30/15', 3, 10, 30, 15],
    ['micro-40-20', '3 × 8 × 40/20', 3, 8, 40, 20],
    ['micro-30-30', '3 × 10 × 30/30', 3, 10, 30, 30],
  ] as const).map(([id, name, sets, count, on, off]) => make(id, name, 'VO₂ maks',
    Array.from({ length: sets }, (_, set) => [
      ...Array.from({ length: count }, (_, index) => [block(`Serie ${set + 1} · drag ${index + 1}`, on, 1.2),
        ...(index < count - 1 ? [block('Kort pause', off, 0.5, 'recovery')] : [])]).flat(),
      ...(set < sets - 1 ? [block('Seriepause', 180, 0.5, 'recovery')] : []),
    ]).flat(), 3, `${on} sekunder arbeid og ${off} sekunder rolig mellom dragene. Tre minutter mellom seriene.`)),

  ...intervalFamily('Tempo', 2, 'Stødig tempo med god flyt. Litt mer trykk enn rolig langkjøring.', [
    ['tempo-2x10', '2 × 10 tempo', 2, 10, 0.82, 3],
    ['tempo-3x10', '3 × 10 tempo', 3, 10, 0.82, 3],
    ['tempo-2x15', '2 × 15 tempo', 2, 15, 0.82, 4],
    ['tempo-3x15', '3 × 15 tempo', 3, 15, 0.82, 4],
    ['tempo-2x20', '2 × 20 tempo', 2, 20, 0.82, 5],
    ['tempo-3x20', '3 × 20 tempo', 3, 20, 0.8, 5],
    ['tempo-1x30', '30 min tempo', 1, 30, 0.8, 0],
    ['tempo-1x45', '45 min tempo', 1, 45, 0.8, 0],
    ['tempo-2x30', '2 × 30 tempo', 2, 30, 0.8, 5],
    ['tempo-4x8', '4 × 8 tempo', 4, 8, 0.85, 2],
  ]),

  ...[20, 30, 40, 45, 50, 60, 75, 90].map(minutes => make(`endurance-${minutes}`,
    `${minutes} min utholdenhet`, 'Utholdenhet', [block('Jevn langkjøring', minutes * 60, 0.65)], 1,
    'Rolig, jevn sykling i sone 2. Varigheten i navnet er hoveddelen; oppvarming og nedkjøring kommer i tillegg.')),
  ...intervalFamily('Utholdenhet', 1, 'Rolige arbeidsperioder i sone 2, med korte pauser for å bryte opp turen.', [
    ['endurance-2x20', '2 × 20 rolig', 2, 20, 0.68, 3],
    ['endurance-3x15', '3 × 15 rolig', 3, 15, 0.68, 3],
    ['endurance-3x20', '3 × 20 rolig', 3, 20, 0.68, 3],
    ['endurance-2x30', '2 × 30 rolig', 2, 30, 0.68, 4],
  ]),
  ...[30, 45, 60].map(minutes => make(`endurance-wave-${minutes}`, `${minutes} min bølger`, 'Utholdenhet',
    Array.from({ length: minutes / 5 }, (_, index) => block(`Bølge ${index + 1}`, 300, index % 2 ? 0.72 : 0.6)), 1,
    'Veksle mellom 60 og 72 % FTP hvert femte minutt. Hele hoveddelen holder seg i sone 2.')),

  ...intervalFamily('Anaerob', 3, 'Korte, krevende drag med tydelige pauser. Effekten er en veiledende startverdi; tilpass etter egen kapasitet.', [
    ['anaerobic-6x1', '6 × 1 min kraft', 6, 1, 1.3, 2],
    ['anaerobic-8x1', '8 × 1 min kraft', 8, 1, 1.3, 2],
    ['anaerobic-10x1', '10 × 1 min kraft', 10, 1, 1.25, 2],
    ['anaerobic-5x90', '5 × 90 sek', 5, 1.5, 1.25, 3],
    ['anaerobic-6x90', '6 × 90 sek', 6, 1.5, 1.25, 3],
    ['anaerobic-4x2', '4 × 2 min kraft', 4, 2, 1.22, 4],
    ['anaerobic-6x30', '6 × 30 sek kraft', 6, 0.5, 1.45, 2.5],
    ['anaerobic-8x30', '8 × 30 sek kraft', 8, 0.5, 1.45, 2.5],
    ['anaerobic-10x30', '10 × 30 sek kraft', 10, 0.5, 1.4, 2],
    ['anaerobic-8x45', '8 × 45 sek kraft', 8, 0.75, 1.35, 2.25],
  ]),

  ...([
    ['sprint-6x10', '6 × 10 sek sprint', 6, 10, 170],
    ['sprint-8x10', '8 × 10 sek sprint', 8, 10, 170],
    ['sprint-6x15', '6 × 15 sek sprint', 6, 15, 165],
    ['sprint-8x15', '8 × 15 sek sprint', 8, 15, 165],
    ['sprint-6x20', '6 × 20 sek sprint', 6, 20, 160],
  ] as const).map(([id, name, count, seconds, recovery]) => make(id, name, 'Sprint',
    repeats(count, seconds / 60, 1.65, recovery / 60), 3,
    'Korte akselerasjoner og god pause. 165 % FTP er kun et veiledende mål, ikke en måling av din maksimale sprintkraft.')),

  ...[10, 15, 20, 25, 30, 35, 40, 45].map(minutes => make(`recovery-${minutes}`, `${minutes} min lett tråkk`,
    'Restitusjon', [block('Lett tråkk', minutes * 60, 0.45)], 1,
    'Svært lett sykling. Hoveddelen går på 45 % FTP, med fem minutter oppvarming og fem minutter nedkjøring.', 5, 5)),
  make('recovery-reset', 'Beina i gang', 'Restitusjon',
    [block('Myk start', 300, 0.4), block('Lett flyt', 600, 0.5), block('Slipp opp', 300, 0.4)], 1,
    'En rolig økt med litt variasjon. Hold trykket lett hele veien.', 5, 5),
  make('recovery-waves', 'Rolige bølger', 'Restitusjon',
    Array.from({ length: 6 }, (_, index) => block(`Rolig del ${index + 1}`, 300, index % 2 ? 0.5 : 0.4)), 1,
    'Seks rolige femminuttere som veksler mellom 40 og 50 % FTP.', 5, 5),
];

export function workoutDuration(workout: Workout): number {
  return workout.blocks.reduce((seconds, current) => seconds + current.seconds, 0);
}

// Approximate planned load, not official TSS: integrates intensity squared.
// It does not model normalized power or measured ride stress.
export function workoutTss(workout: Workout): number {
  return Math.round(workout.blocks.reduce((load, current) => load + current.seconds / 3600 * current.intensity ** 2 * 100, 0));
}

export function zoneDistribution(workout: Workout): { zone: number; seconds: number }[] {
  const distribution = zones.map(zone => ({ zone: zone.id, seconds: 0 }));
  for (const current of workout.blocks) distribution[getZone(current.intensity, 1).id - 1].seconds += current.seconds;
  return distribution;
}

export function getWorkoutState(workout: Workout, elapsed: number) {
  if (!workout.blocks.length) throw new Error('Økten må inneholde minst én blokk.');
  const duration = workoutDuration(workout);
  // Clock accumulation and skipped-block offsets can land a few floating-point
  // ulps before a boundary. Treat the clock at microsecond resolution so a
  // caller cannot get trapped trying to consume an unrepresentably tiny dt.
  const microseconds = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const time = Number.isNaN(elapsed) ? 0
    : Math.min(duration, microseconds(Math.max(0, Math.min(elapsed, duration))));
  let blockStart = 0;
  for (let index = 0; index < workout.blocks.length; index++) {
    const current = workout.blocks[index];
    if (time < blockStart + current.seconds) return {
      block: current, index, remaining: microseconds(blockStart + current.seconds - time),
      totalRemaining: microseconds(duration - time), completed: false, progress: duration ? time / duration : 0,
    };
    blockStart += current.seconds;
  }
  return { block: workout.blocks[workout.blocks.length - 1], index: workout.blocks.length - 1,
    remaining: 0, totalRemaining: 0, completed: true, progress: 1 };
}

export function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  return `${Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60)} min`;
}
