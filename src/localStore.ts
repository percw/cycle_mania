import type { RideRecord } from './storage';
import { BrowserModeError } from './api';

/**
 * Durable browser storage. Rides with 1 Hz samples outgrow localStorage (~5 MB)
 * after a few hours of riding, so they live in IndexedDB. Small preferences stay
 * in localStorage. If IndexedDB is unavailable, the old localStorage format is
 * used so the app keeps working exactly as before.
 */
export const LEGACY_HISTORY_KEY = 'summit-history';
const DB_NAME = 'summit';
const DB_VERSION = 1;
const RIDES = 'rides';
const VALUES = 'kv';

export interface LocalStore {
  kind: 'indexeddb' | 'localstorage';
  /** Newest first. */
  getRides(): Promise<RideRecord[]>;
  putRides(rides: RideRecord[]): Promise<void>;
  deleteRides(ids: string[]): Promise<void>;
  getValue<T>(key: string): Promise<T | undefined>;
  setValue(key: string, value: unknown): Promise<void>;
}

/** The minimum the app needs to render a stored ride. */
export function isStoredRide(value: unknown): value is RideRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ride = value as Partial<RideRecord>;
  return typeof ride.id === 'string' && ride.id.length > 0 && typeof ride.seconds === 'number' && Array.isArray(ride.zoneSeconds);
}
export function sortRides(rides: RideRecord[]): RideRecord[] {
  return [...rides].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
/** Union by ride id. The first list wins on conflicts: saved rides never change afterwards. */
export function mergeRides(first: RideRecord[], second: RideRecord[]): RideRecord[] {
  const merged = new Map(first.map(ride => [ride.id, ride]));
  for (const ride of second) if (!merged.has(ride.id)) merged.set(ride.id, ride);
  return sortRides([...merged.values()]);
}

function safeLocalStorage(): Storage | undefined {
  try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}
/** Rides still in the old localStorage key (before migration, or when IndexedDB is unavailable). */
export function readLegacyHistory(storage: Storage | undefined = safeLocalStorage()): RideRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LEGACY_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isStoredRide) : [];
  } catch { return []; }
}

const done = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB-forespørselen feilet.'));
});
const committed = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB-transaksjonen feilet.'));
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB-transaksjonen ble avbrutt.'));
});

export async function openIndexedStore(factory: IDBFactory, name = DB_NAME, timeoutMs = 5000): Promise<LocalStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB svarte ikke.')), timeoutMs);
    let request: IDBOpenDBRequest;
    try { request = factory.open(name, DB_VERSION); } catch (error) { clearTimeout(timer); reject(error); return; }
    request.onupgradeneeded = () => {
      const upgrade = request.result;
      if (!upgrade.objectStoreNames.contains(RIDES)) upgrade.createObjectStore(RIDES, { keyPath: 'id' });
      if (!upgrade.objectStoreNames.contains(VALUES)) upgrade.createObjectStore(VALUES);
    };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error('IndexedDB kunne ikke åpnes.')); };
  });
  // A newer tab upgrading the schema must not be blocked by this one.
  db.onversionchange = () => db.close();
  return {
    kind: 'indexeddb',
    async getRides() {
      const rides = await done(db.transaction(RIDES, 'readonly').objectStore(RIDES).getAll());
      return sortRides((rides as unknown[]).filter(isStoredRide));
    },
    async putRides(rides) {
      if (!rides.length) return;
      const transaction = db.transaction(RIDES, 'readwrite');
      const finished = committed(transaction);
      const store = transaction.objectStore(RIDES);
      for (const ride of rides) store.put(ride);
      await finished;
    },
    async deleteRides(ids) {
      if (!ids.length) return;
      const transaction = db.transaction(RIDES, 'readwrite');
      const finished = committed(transaction);
      const store = transaction.objectStore(RIDES);
      for (const id of ids) store.delete(id);
      await finished;
    },
    async getValue<T>(key: string) {
      return await done(db.transaction(VALUES, 'readonly').objectStore(VALUES).get(key)) as T | undefined;
    },
    async setValue(key, value) {
      const transaction = db.transaction(VALUES, 'readwrite');
      const finished = committed(transaction);
      transaction.objectStore(VALUES).put(value, key);
      await finished;
    },
  };
}

/** Fallback with the pre-IndexedDB format, so old data stays readable. */
export function createLegacyStore(storage: Storage | undefined = safeLocalStorage()): LocalStore {
  const valueKey = (key: string) => `summit-store-${key}`;
  return {
    kind: 'localstorage',
    async getRides() { return sortRides(readLegacyHistory(storage)); },
    async putRides(rides) {
      if (!storage) throw new Error('Nettleseren tillater ikke lokal lagring.');
      const incoming = new Map(rides.map(ride => [ride.id, ride]));
      const kept = readLegacyHistory(storage).filter(ride => !incoming.has(ride.id));
      storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify(sortRides([...incoming.values(), ...kept])));
    },
    async deleteRides(ids) {
      if (!storage) throw new Error('Nettleseren tillater ikke lokal lagring.');
      removeFromLegacyHistory(ids, storage);
    },
    async getValue<T>(key: string) {
      try { const raw = storage?.getItem(valueKey(key)); return raw ? JSON.parse(raw) as T : undefined; } catch { return undefined; }
    },
    async setValue(key, value) {
      if (!storage) throw new Error('Nettleseren tillater ikke lokal lagring.');
      storage.setItem(valueKey(key), JSON.stringify(value));
    },
  };
}

/**
 * Copies rides from the old localStorage key into IndexedDB. The old key is
 * removed only after every migrated ride has been read back, and entries that
 * cannot be migrated are left where they were.
 */
export async function migrateLegacyHistory(store: LocalStore, storage: Storage | undefined = safeLocalStorage()): Promise<number> {
  if (store.kind !== 'indexeddb' || !storage) return 0;
  let parsed: unknown;
  try {
    const raw = storage.getItem(LEGACY_HISTORY_KEY);
    if (raw === null) return 0;
    parsed = JSON.parse(raw);
  } catch { return 0; }
  if (!Array.isArray(parsed)) return 0;
  const rides = parsed.filter(isStoredRide);
  const leftovers = parsed.filter(entry => !isStoredRide(entry));
  const existing = new Set((await store.getRides()).map(ride => ride.id));
  const fresh = rides.filter(ride => !existing.has(ride.id));
  await store.putRides(fresh);
  const stored = new Set((await store.getRides()).map(ride => ride.id));
  if (!rides.every(ride => stored.has(ride.id))) throw new Error('Migreringen kunne ikke bekreftes.');
  if (leftovers.length) storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify(leftovers));
  else storage.removeItem(LEGACY_HISTORY_KEY);
  return fresh.length;
}

/** Removes rides from the old localStorage key, if it still exists (fallback mode or failed migration). */
export function removeFromLegacyHistory(ids: string[], storage: Storage | undefined = safeLocalStorage()) {
  const raw = storage?.getItem(LEGACY_HISTORY_KEY);
  if (!storage || raw == null) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(parsed)) return;
  const remove = new Set(ids);
  const kept = parsed.filter(entry => !(isStoredRide(entry) && remove.has(entry.id)));
  if (kept.length !== parsed.length) storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify(kept));
}

/**
 * Rides deleted here but not yet in SQLite (backend down). The next sync deletes
 * them there and never pulls them back.
 */
export const DELETED_RIDES_KEY = 'summit-deleted-rides';
export function readDeletedRideIds(storage: Storage | undefined = safeLocalStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DELETED_RIDES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}
function writeDeletedRideIds(ids: string[], storage: Storage | undefined) {
  try {
    if (ids.length) storage?.setItem(DELETED_RIDES_KEY, JSON.stringify(ids));
    else storage?.removeItem(DELETED_RIDES_KEY);
  } catch { /* the delete still happened locally */ }
}
export function markRidesDeleted(ids: string[], storage: Storage | undefined = safeLocalStorage()) {
  writeDeletedRideIds([...new Set([...readDeletedRideIds(storage), ...ids])], storage);
}
export function clearDeletedRideIds(ids: string[], storage: Storage | undefined = safeLocalStorage()) {
  const clear = new Set(ids);
  writeDeletedRideIds(readDeletedRideIds(storage).filter(id => !clear.has(id)), storage);
}

/**
 * 'deleted': removed from SQLite too. 'pending': the local backend did not answer;
 * the next sync deletes it there. 'none': browser mode, there is no backend.
 */
export type RemoteDeleteResult = 'deleted' | 'pending' | 'none';
/** Deletes one ride from this browser and, when the local backend exists, from SQLite. */
export async function deleteRideEverywhere(id: string, deps: { store: LocalStore; deleteRemote(id: string): Promise<unknown>; storage?: Storage }): Promise<RemoteDeleteResult> {
  const storage = deps.storage ?? safeLocalStorage();
  // Remember the deletion first, so a sync running at the same time cannot bring the ride back.
  markRidesDeleted([id], storage);
  try {
    await deps.store.deleteRides([id]);
    removeFromLegacyHistory([id], storage);
  } catch {
    clearDeletedRideIds([id], storage);
    throw new Error('Økten kunne ikke slettes i nettleseren. Prøv igjen.');
  }
  try {
    await deps.deleteRemote(id);
    clearDeletedRideIds([id], storage);
    return 'deleted';
  } catch (error) {
    return error instanceof BrowserModeError ? 'none' : 'pending';
  }
}

let shared: Promise<LocalStore> | null = null;
/** One store per page: IndexedDB with migration, or the localStorage fallback. */
export function getLocalStore(): Promise<LocalStore> {
  shared ??= (async () => {
    const storage = safeLocalStorage();
    let store: LocalStore;
    try {
      const factory = globalThis.indexedDB;
      if (!factory) throw new Error('IndexedDB mangler.');
      store = await openIndexedStore(factory);
    } catch {
      return createLegacyStore(storage);
    }
    // A failed migration leaves the old key intact; callers keep reading it.
    try { await migrateLegacyHistory(store, storage); } catch { /* retried on next start */ }
    return store;
  })();
  return shared;
}

let persistenceRequested = false;
/**
 * Asks the browser not to evict our storage under pressure. Called after the
 * first saved real ride, never on start (Firefox shows a prompt).
 */
export async function requestPersistentStorage(storageManager: StorageManager | undefined = globalThis.navigator?.storage): Promise<boolean | null> {
  if (persistenceRequested || !storageManager?.persist) return null;
  persistenceRequested = true;
  try {
    if (await storageManager.persisted?.()) return true;
    return await storageManager.persist();
  } catch { return null; }
}
