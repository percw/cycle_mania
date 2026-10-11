import type { RideRecord } from './storage';
import type { CustomWorkoutDraft } from './customWorkouts';

export interface BackendStatus { ok: boolean; storage: 'sqlite'; rides: number }
export interface Profile { ftp: number; updatedAt: string | null }
export interface AntStatus {
  status: 'disconnected' | 'connecting' | 'scanning' | 'connected' | 'error';
  error: string | null;
  heartRate: number | null;
  power: number | null;
  cadence: number | null;
  deviceId: number | null;
  bikeId: number;
  heartRateDeviceId: number | null;
  updatedAt: number | null;
  heartRateUpdatedAt: number | null;
  powerUpdatedAt: number | null;
}
/**
 * 'local': the Node/SQLite backend answers /api/health (npm run dev / npm start).
 * 'browser': static hosting without a backend. Data lives in IndexedDB, and API
 * calls fail fast without touching the network.
 */
export type BackendMode = 'local' | 'browser';
export class BrowserModeError extends Error {
  constructor() { super('ANT+ og SQLite krever den lokale SUMMIT-serveren. Bluetooth og lagring virker direkte i nettleseren.'); this.name = 'BrowserModeError'; }
}
let backendMode: BackendMode | null = null;
let detection: Promise<BackendMode> | null = null;
async function healthAnswers(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return false;
    const body = await response.json();
    return body?.ok === true && body.storage === 'sqlite';
  } catch { return false; }
}
/** One shared health probe decides the mode for this page load. */
export function detectBackend(timeoutMs = 4000): Promise<BackendMode> {
  if (backendMode) return Promise.resolve(backendMode);
  detection ??= healthAnswers(timeoutMs).then(ok => (backendMode = ok ? 'local' : 'browser'));
  return detection;
}
/** Quiet re-check from browser mode, e.g. when the local server is started after the page. */
export async function recheckBackend(): Promise<BackendMode> {
  const mode = await detectBackend();
  if (mode === 'browser' && await healthAnswers(4000)) backendMode = 'local';
  return backendMode ?? mode;
}
export const currentBackendMode = () => backendMode;
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (await detectBackend() === 'browser') throw new BrowserModeError();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }, signal: AbortSignal.timeout(12000) });
  } catch { throw new Error('Den lokale serveren svarer ikke. Start den med npm run server og prøv igjen.'); }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('Lokal API er utilgjengelig. Start serveren og bruk appens Vite-proxy.');
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Den lokale serveren kunne ikke utføre forespørselen.');
  return body as T;
}
export const loadRides = () => request<RideRecord[]>('/rides');
export const loadCustomWorkouts = () => request<CustomWorkoutDraft[]>('/workouts');
export const putCustomWorkout = (workout:CustomWorkoutDraft) => request<CustomWorkoutDraft>('/workouts', {method:'POST',body:JSON.stringify(workout)});
export const deleteCustomWorkout = (id:string) => request<{ok:boolean}>(`/workouts/${encodeURIComponent(id)}`, {method:'DELETE'});
export const persistRide = (ride: RideRecord) => request<RideRecord>('/rides', { method: 'POST', body: JSON.stringify(ride) });
export const deleteRemoteRide = (id: string) => request<{ ok: boolean; deleted: boolean }>(`/rides/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getFitUrl = (id: string) => `/api/rides/${encodeURIComponent(id)}/fit`;
export const getBackendStatus = () => request<BackendStatus>('/health');
export const getProfile = () => request<Profile>('/profile');
export const saveProfile = (ftp: number) => request<Profile>('/profile', { method: 'PUT', body: JSON.stringify({ ftp }) });
export const getAntStatus = () => request<AntStatus>('/ant/status');
export const connectAnt = (options: { bikeId?: number; heartRateId?: number | null } = {}) => request<AntStatus>('/ant/connect', { method: 'POST', body: JSON.stringify(options) });
export const disconnectAnt = () => request<AntStatus>('/ant/disconnect', { method: 'POST', body: '{}' });
