import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BrowserModeError } from './api';
import { DELETED_RIDES_KEY, LEGACY_HISTORY_KEY, createLegacyStore, deleteRideEverywhere, markRidesDeleted, mergeRides, migrateLegacyHistory, openIndexedStore, readDeletedRideIds, readLegacyHistory, requestPersistentStorage, type LocalStore } from './localStore';
import type { RideRecord } from './storage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  quota = Infinity;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new DOMException('Full', 'QuotaExceededError');
    this.data.set(key, value);
  }
}
const ride = (id: string, date: string, extra: Partial<RideRecord> = {}): RideRecord => ({
  id, name: `Økt ${id}`, date, seconds: 3600, distance: 30, avgPower: 200, energy: 720,
  zoneSeconds: [0, 0, 3600, 0, 0, 0, 0], completed: true, demo: false, ftp: 250,
  samples: Array.from({ length: 3600 }, (_, i) => ({ second: i + 1, power: 200, cadence: 88, heartRate: null, measured: true })),
  ...extra,
});

describe('IndexedDB ride store', () => {
  it('stores full rides with samples and returns them newest first', async () => {
    const store = await openIndexedStore(new IDBFactory());
    await store.putRides([ride('a', '2026-10-01T10:00:00Z'), ride('b', '2026-10-03T10:00:00Z')]);
    await store.putRides([ride('c', '2026-10-02T10:00:00Z', { demo: true })]);
    const rides = await store.getRides();
    expect(rides.map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(rides[0].samples).toHaveLength(3600);
    expect(rides[1].demo).toBe(true);
  });
  it('keeps small values such as the profile and custom workouts', async () => {
    const store = await openIndexedStore(new IDBFactory());
    expect(await store.getValue('profile')).toBeUndefined();
    await store.setValue('profile', { ftp: 262, updatedAt: '2026-10-01T10:00:00Z' });
    expect(await store.getValue('profile')).toEqual({ ftp: 262, updatedAt: '2026-10-01T10:00:00Z' });
  });
  it('survives reopening the same database', async () => {
    const factory = new IDBFactory();
    await (await openIndexedStore(factory)).putRides([ride('kept', '2026-10-01T10:00:00Z')]);
    expect((await (await openIndexedStore(factory)).getRides()).map(r => r.id)).toEqual(['kept']);
  });
});

describe('migration from localStorage', () => {
  it('moves every legacy ride into IndexedDB and frees the old key', async () => {
    const storage = new MemoryStorage();
    const legacy = [ride('old-1', '2026-09-01T10:00:00Z'), ride('old-2', '2026-09-02T10:00:00Z', { demo: true })];
    storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify(legacy));
    const store = await openIndexedStore(new IDBFactory());
    expect(await migrateLegacyHistory(store, storage)).toBe(2);
    expect(storage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
    const rides = await store.getRides();
    expect(rides).toEqual([legacy[1], legacy[0]]);
    expect(await migrateLegacyHistory(store, storage)).toBe(0);
  });
  it('does not overwrite rides that are already in IndexedDB', async () => {
    const storage = new MemoryStorage();
    const store = await openIndexedStore(new IDBFactory());
    await store.putRides([ride('same', '2026-09-01T10:00:00Z', { name: 'Fra databasen' })]);
    storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([ride('same', '2026-09-01T10:00:00Z', { name: 'Gammel kopi' })]));
    expect(await migrateLegacyHistory(store, storage)).toBe(0);
    expect((await store.getRides())[0].name).toBe('Fra databasen');
    expect(storage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });
  it('leaves entries it cannot migrate in place instead of deleting them', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([ride('ok', '2026-09-01T10:00:00Z'), { name: 'uten id' }]));
    const store = await openIndexedStore(new IDBFactory());
    expect(await migrateLegacyHistory(store, storage)).toBe(1);
    expect(JSON.parse(storage.getItem(LEGACY_HISTORY_KEY) ?? '[]')).toEqual([{ name: 'uten id' }]);
  });
  it('keeps corrupt legacy data untouched', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_HISTORY_KEY, '{not json');
    const store = await openIndexedStore(new IDBFactory());
    expect(await migrateLegacyHistory(store, storage)).toBe(0);
    expect(storage.getItem(LEGACY_HISTORY_KEY)).toBe('{not json');
  });
});

describe('localStorage fallback without IndexedDB', () => {
  it('reads and writes the old format so existing history stays visible', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([ride('old', '2026-09-01T10:00:00Z')]));
    const store = createLegacyStore(storage);
    expect((await store.getRides()).map(r => r.id)).toEqual(['old']);
    await store.putRides([ride('new', '2026-10-01T10:00:00Z')]);
    expect(readLegacyHistory(storage).map(r => r.id)).toEqual(['new', 'old']);
    await store.setValue('profile', { ftp: 240 });
    expect(await store.getValue('profile')).toEqual({ ftp: 240 });
  });
  it('reports a full localStorage instead of pretending the ride was saved', async () => {
    const storage = new MemoryStorage();
    storage.quota = 1000;
    await expect(createLegacyStore(storage).putRides([ride('big', '2026-10-01T10:00:00Z')])).rejects.toThrow();
  });
});

describe('helpers', () => {
  it('merges by id and keeps the first copy', () => {
    const merged = mergeRides([ride('a', '2026-10-01T10:00:00Z', { name: 'lokal' })], [ride('a', '2026-10-01T10:00:00Z', { name: 'annen' }), ride('b', '2026-10-02T10:00:00Z')]);
    expect(merged.map(r => [r.id, r.name])).toEqual([['b', 'Økt b'], ['a', 'lokal']]);
  });
  it('asks for persistent storage once and tolerates missing support', async () => {
    let calls = 0;
    const manager = { persisted: async () => false, persist: async () => { calls++; return true; } } as unknown as StorageManager;
    expect(await requestPersistentStorage(undefined)).toBeNull();
    expect(await requestPersistentStorage(manager)).toBe(true);
    expect(await requestPersistentStorage(manager)).toBeNull();
    expect(calls).toBe(1);
  });
});

describe('deleting a ride', () => {
  it('removes it from IndexedDB, the old localStorage key and SQLite', async () => {
    const storage = new MemoryStorage();
    const store = await openIndexedStore(new IDBFactory());
    await store.putRides([ride('keep', '2026-10-01T10:00:00Z'), ride('gone', '2026-10-02T10:00:00Z')]);
    storage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([ride('gone', '2026-10-02T10:00:00Z')]));
    const remote: string[] = [];
    expect(await deleteRideEverywhere('gone', { store, storage, deleteRemote: async id => { remote.push(id); } })).toBe('deleted');
    expect((await store.getRides()).map(r => r.id)).toEqual(['keep']);
    expect(readLegacyHistory(storage)).toEqual([]);
    expect(remote).toEqual(['gone']);
    expect(storage.getItem(DELETED_RIDES_KEY)).toBeNull();
  });
  it('queues the SQLite delete when the local backend is down, and needs none in browser mode', async () => {
    const storage = new MemoryStorage();
    const store = await openIndexedStore(new IDBFactory());
    await store.putRides([ride('a', '2026-10-01T10:00:00Z'), ride('b', '2026-10-02T10:00:00Z')]);
    expect(await deleteRideEverywhere('a', { store, storage, deleteRemote: async () => { throw new Error('Den lokale serveren svarer ikke.'); } })).toBe('pending');
    expect(readDeletedRideIds(storage)).toEqual(['a']);
    expect(await deleteRideEverywhere('b', { store, storage, deleteRemote: async () => { throw new BrowserModeError(); } })).toBe('none');
    expect(await store.getRides()).toEqual([]);
    markRidesDeleted(['a'], storage);
    expect(readDeletedRideIds(storage)).toEqual(['a', 'b']);
  });
  it('keeps the ride and reports an error if this browser cannot delete it', async () => {
    const storage = new MemoryStorage();
    const failing: LocalStore = { ...createLegacyStore(storage), deleteRides: async () => { throw new Error('blocked'); } };
    let remoteCalled = false;
    await expect(deleteRideEverywhere('x', { store: failing, storage, deleteRemote: async () => { remoteCalled = true; } })).rejects.toThrow(/kunne ikke slettes/);
    expect(remoteCalled).toBe(false);
    expect(readDeletedRideIds(storage)).toEqual([]);
  });
  it('works in the localStorage fallback', async () => {
    const storage = new MemoryStorage();
    const store = createLegacyStore(storage);
    await store.putRides([ride('a', '2026-10-01T10:00:00Z'), ride('b', '2026-10-02T10:00:00Z')]);
    await store.deleteRides(['a']);
    expect(readLegacyHistory(storage).map(r => r.id)).toEqual(['b']);
  });
});
