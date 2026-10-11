import type { RideRecord } from './storage';
import { validateCustomWorkout, type CustomWorkoutDraft } from './customWorkouts';
import { mergeRides } from './localStore';

/** A complete, portable copy of what SUMMIT keeps in this browser. */
export interface SummitBackup {
  app: 'SUMMIT';
  kind: 'backup';
  version: 1;
  exportedAt: string;
  profile: { ftp: number };
  rides: RideRecord[];
  customWorkouts: CustomWorkoutDraft[];
}
export interface ParsedBackup {
  rides: RideRecord[];
  customWorkouts: CustomWorkoutDraft[];
  ftp: number | null;
  /** Entries that were not valid rides or workouts and were left out. */
  skipped: number;
}

export function createBackup(input: { rides: RideRecord[]; ftp: number; customWorkouts: CustomWorkoutDraft[]; now?: Date }): SummitBackup {
  return {
    app: 'SUMMIT', kind: 'backup', version: 1, exportedAt: (input.now ?? new Date()).toISOString(),
    profile: { ftp: input.ftp }, rides: input.rides, customWorkouts: input.customWorkouts,
  };
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const optionalNumber = (v: unknown, max: number) => v === undefined || v === null || finite(v, 0, max);
const validFtp = (v: unknown): v is number => finite(v, 50, 600);

/**
 * Accepts rides from a file the user picked. The same limits as the local
 * server apply to the fields the app reads; unknown extra fields are kept.
 */
export function validateImportedRide(value: unknown): RideRecord | null {
  if (!object(value)) return null;
  const v = value;
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v.id)) return null;
  if (typeof v.name !== 'string' || !v.name || v.name.length > 200 || typeof v.date !== 'string' || !Number.isFinite(Date.parse(v.date))) return null;
  if (!finite(v.seconds, 0, 172800) || !finite(v.distance, 0, 10000) || !finite(v.avgPower, 0, 5000) || !finite(v.energy, 0, 1000000)) return null;
  if (!validFtp(v.ftp) || typeof v.demo !== 'boolean' || typeof v.completed !== 'boolean') return null;
  if (!Array.isArray(v.zoneSeconds) || v.zoneSeconds.length !== 7 || !v.zoneSeconds.every(n => finite(n, 0, (v.seconds as number) + 1))) return null;
  if (v.startedAt !== undefined && (typeof v.startedAt !== 'string' || !Number.isFinite(Date.parse(v.startedAt)))) return null;
  if (v.samples !== undefined) {
    if (!Array.isArray(v.samples) || v.samples.length > 172800) return null;
    let previous = -1;
    for (const sample of v.samples) {
      if (!object(sample) || !finite(sample.second, 0, (v.seconds as number) + 1) || sample.second <= previous || !finite(sample.power, 0, 5000)) return null;
      if (!optionalNumber(sample.cadence, 254) || !optionalNumber(sample.heartRate, 254)) return null;
      if (sample.measured !== undefined && typeof sample.measured !== 'boolean') return null;
      previous = sample.second;
    }
  }
  if (v.timerEvents !== undefined && (!Array.isArray(v.timerEvents) || !v.timerEvents.every(e => object(e) && finite(e.wallSecond, 0, 172800) && (e.type === 'start' || e.type === 'stop')))) return null;
  for (const key of ['game', 'expedition', 'rampTest'] as const) if (v[key] !== undefined && !object(v[key])) return null;
  for (const key of ['blockSeconds', 'blockMeters', 'skippedBlocks'] as const) if (v[key] !== undefined && (!Array.isArray(v[key]) || !(v[key] as unknown[]).every(n => finite(n, 0, 10000000)))) return null;
  if (v.workoutSnapshot !== undefined && (!object(v.workoutSnapshot) || !Array.isArray(v.workoutSnapshot.blocks) || !v.workoutSnapshot.blocks.length || v.workoutSnapshot.blocks.length > 1500)) return null;
  return v as unknown as RideRecord;
}

/** Reads a SUMMIT backup, or the plain ride list from the older «Eksporter» button. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Filen er ikke gyldig JSON.'); }
  const backup = object(data) && data.app === 'SUMMIT' && data.kind === 'backup';
  if (!Array.isArray(data) && !backup) throw new Error('Filen er ikke en sikkerhetskopi fra SUMMIT.');
  if (backup && (data as Record<string, unknown>).version !== 1) throw new Error('Sikkerhetskopien er fra en nyere versjon av SUMMIT.');
  const source = (backup ? data : { rides: data }) as Record<string, unknown>;
  const rideInput = Array.isArray(source.rides) ? source.rides : [];
  const workoutInput = Array.isArray(source.customWorkouts) ? source.customWorkouts : [];
  const rides: RideRecord[] = [];
  const customWorkouts: CustomWorkoutDraft[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const item of rideInput) {
    const ride = validateImportedRide(item);
    if (!ride || seen.has(ride.id)) { skipped++; continue; }
    seen.add(ride.id);
    rides.push(ride);
  }
  for (const item of workoutInput) {
    try { customWorkouts.push(validateCustomWorkout(item)); } catch { skipped++; }
  }
  const ftp = object(source.profile) && validFtp(source.profile.ftp) ? Math.round(source.profile.ftp) : null;
  return { rides, customWorkouts, ftp, skipped };
}

/** Merge by ride id: rides already here are kept as they are. */
export function mergeImportedRides(current: RideRecord[], incoming: RideRecord[]) {
  const known = new Set(current.map(ride => ride.id));
  const added = incoming.filter(ride => !known.has(ride.id));
  return { rides: mergeRides(current, added), added, existing: incoming.length - added.length };
}
