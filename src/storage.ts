import type { RampTestRecord } from "./rampTypes";
import type { Workout } from "./training";
import type { GameResult } from "./game";
import type { ExpeditionResult } from "./expedition";

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Session remains usable with unavailable storage. */
  }
}
export interface RideRecord {
  id: string;
  name: string;
  date: string;
  seconds: number;
  distance: number;
  avgPower: number;
  energy: number;
  zoneSeconds: number[];
  completed: boolean;
  demo: boolean;
  ftp: number;
  samples?: RideSample[];
  rampTest?: RampTestRecord;
  workoutId?: string;
  workoutSnapshot?: Workout;
  blockSeconds?: number[];
  blockMeters?: number[];
  skippedBlocks?: number[];
  worldId?: "tron" | "neon" | "sky" | "vestland" | "fjord" | "alpine" | "midnight";
  game?: GameResult;
  expedition?: ExpeditionResult;
  startedAt?: string;
  distanceMeasured?: boolean;
  skippedSeconds?: number;
  timerEvents?: { wallSecond: number; type: "start" | "stop" }[];
}
export interface RideSample {
  second: number;
  power: number;
  cadence: number | null;
  heartRate: number | null;
  targetPower?: number;
  measured?: boolean;
  wallSecond?: number;
  workoutSecond?: number;
  blockIndex?: number;
}
