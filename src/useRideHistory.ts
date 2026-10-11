import { useEffect, useRef, useState } from 'react';
import { BrowserModeError, detectBackend, recheckBackend, getBackendStatus, getProfile, loadRides, persistRide, saveProfile, deleteRemoteRide } from './api';
import { clearDeletedRideIds, deleteRideEverywhere, getLocalStore, mergeRides, readDeletedRideIds, readLegacyHistory, requestPersistentStorage, sortRides, type RemoteDeleteResult } from './localStore';
import { mergeImportedRides } from './backup';
import { readStored, saveStored, type RideRecord } from './storage';

/**
 * checking: deciding whether the local backend exists.
 * local / local-offline: the Node/SQLite backend was found (and may be down now).
 * browser: static hosting; everything lives in this browser's IndexedDB.
 */
export type StorageStatus = 'checking' | 'local' | 'local-offline' | 'browser';
type StoredProfile = { ftp: number; updatedAt: string | null };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SYNC_MS = 30000;
const validFtp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 600;
const mirrorProfile = (ftp: number, updatedAt: string | null) =>
  void getLocalStore().then(store => store.setValue('profile', { ftp, updatedAt } satisfies StoredProfile)).catch(() => {});

export function useRideHistory(options: {
  notify(message: string): void;
  /** FTP is never changed from storage while a ride is running. */
  isRiding(): boolean;
  applyFtp(ftp: number): void;
}) {
  const [history, setHistory] = useState<RideRecord[]>(() => sortRides(readLegacyHistory()));
  const [status, setStatus] = useState<StorageStatus>('checking');
  const historyRef = useRef(history);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const commit = (next: RideRecord[]) => { historyRef.current = next; setHistory(next); };

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function loadLocal() {
      try {
        const store = await getLocalStore();
        const [rides, profile] = await Promise.all([store.getRides(), store.getValue<StoredProfile>('profile')]);
        if (!active) return;
        const gone = new Set(readDeletedRideIds());
        commit(mergeRides(historyRef.current, mergeRides(rides, readLegacyHistory())).filter(ride => !gone.has(ride.id)));
        // FTP is read synchronously from localStorage at start; IndexedDB restores it if that was cleared.
        if (readStored<number | null>('summit-ftp', null) === null && validFtp(profile?.ftp) && !optionsRef.current.isRiding()) {
          saveStored('summit-ftp', profile.ftp);
          optionsRef.current.applyFtp(profile.ftp);
        }
      } catch { /* The legacy copy read at start stays visible. */ }
    }
    async function syncBackend() {
      try {
        const ftpBeforeSync = readStored('summit-ftp', 250);
        await getBackendStatus();
        const pendingFtp = readStored<number | null>('summit-pending-ftp', null);
        if (pendingFtp !== null && pendingFtp >= 50 && pendingFtp <= 600) {
          await saveProfile(pendingFtp);
          if (readStored('summit-pending-ftp', null) === pendingFtp) saveStored('summit-pending-ftp', null);
        }
        // Deletions made while the backend was down are applied before reading rides.
        for (const id of readDeletedRideIds()) {
          if (/^[a-zA-Z0-9_-]{1,128}$/.test(id)) await deleteRemoteRide(id); // other IDs never reach SQLite
          clearDeletedRideIds([id]);
        }
        const [remote, profile] = await Promise.all([loadRides(), getProfile()]);
        if (!active) return;
        setStatus('local');
        const deleted = () => new Set(readDeletedRideIds());
        const localIds = new Set(historyRef.current.map(ride => ride.id));
        const pendingDeletes = deleted();
        const merged = new Map(remote.filter(ride => !pendingDeletes.has(ride.id)).map(ride => [ride.id, ride]));
        for (const local of historyRef.current) {
          if (merged.has(local.id) || deleted().has(local.id)) continue;
          try { await persistRide(local); merged.set(local.id, local); } catch { /* Rejected ride stays in this browser only. */ }
        }
        if (!active) return;
        const gone = deleted();
        commit(mergeRides([...merged.values()], historyRef.current).filter(ride => !gone.has(ride.id)));
        const fromServer = remote.filter(ride => !localIds.has(ride.id) && !gone.has(ride.id));
        if (fromServer.length) void getLocalStore().then(store => store.putRides(fromServer)).catch(() => {});
        if (profile.updatedAt && !optionsRef.current.isRiding() && readStored('summit-pending-ftp', null) === null && readStored('summit-ftp', 250) === ftpBeforeSync) {
          saveStored('summit-ftp', profile.ftp);
          optionsRef.current.applyFtp(profile.ftp);
          mirrorProfile(profile.ftp, profile.updatedAt);
        }
      } catch (error) {
        if (active) setStatus(error instanceof BrowserModeError ? 'browser' : 'local-offline');
      }
    }
    void (async () => {
      await loadLocal();
      const mode = await detectBackend();
      if (!active) return;
      if (mode === 'local') await syncBackend();
      else setStatus('browser');
      // Hosted: no polling at all. On this machine a local server may be started later.
      if (!active || (mode === 'browser' && !LOCAL_HOSTS.has(globalThis.location?.hostname ?? ''))) return;
      timer = setInterval(() => void recheckBackend().then(next => { if (next === 'local') return syncBackend(); }), SYNC_MS);
    })();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  /** Saves a finished ride: IndexedDB first, then SQLite when the local backend exists. */
  async function addRide(record: RideRecord) {
    commit(mergeRides([record], historyRef.current));
    let savedLocally = false;
    try {
      await (await getLocalStore()).putRides([record]);
      savedLocally = true;
    } catch { /* Reported below. */ }
    if (savedLocally && !record.demo) void requestPersistentStorage();
    try {
      await persistRide(record);
      setStatus('local');
    } catch (error) {
      if (error instanceof BrowserModeError) {
        setStatus('browser');
        if (!savedLocally) optionsRef.current.notify('Nettleseren kunne ikke lagre økten. Last ned dataene fra rapporten før du lukker siden.');
        return;
      }
      setStatus('local-offline');
      optionsRef.current.notify(savedLocally
        ? 'Økten er lagret i nettleseren. Start lokal backend for databasesynkronisering.'
        : 'Økten kunne ikke lagres. Last ned dataene fra rapporten før du lukker siden.');
    }
  }

  /** Adds rides from a backup file. Rides already stored are kept unchanged. */
  async function importRides(incoming: RideRecord[]) {
    const { added, existing } = mergeImportedRides(historyRef.current, incoming);
    if (!added.length) return { added: 0, existing };
    await (await getLocalStore()).putRides(added);
    clearDeletedRideIds(added.map(ride => ride.id));
    commit(mergeRides(historyRef.current, added));
    if (added.some(ride => !ride.demo)) void requestPersistentStorage();
    if (await detectBackend() === 'local') {
      for (const ride of added) {
        try { await persistRide(ride); } catch { break; /* The next sync retries. */ }
      }
    }
    return { added: added.length, existing };
  }

  /**
   * Permanently deletes a saved ride: from the list, IndexedDB, the old
   * localStorage key and, when the local backend exists, SQLite. If the backend
   * is down, the deletion is queued for the next sync. Throws (Norwegian
   * message) and restores the ride if this browser could not delete it.
   */
  async function deleteRide(id: string): Promise<{ backend: RemoteDeleteResult }> {
    const removed = historyRef.current.filter(ride => ride.id === id);
    commit(historyRef.current.filter(ride => ride.id !== id));
    try {
      const backend = await deleteRideEverywhere(id, { store: await getLocalStore(), deleteRemote: deleteRemoteRide });
      setStatus(backend === 'deleted' ? 'local' : backend === 'pending' ? 'local-offline' : 'browser');
      return { backend };
    } catch (error) {
      commit(mergeRides(historyRef.current, removed));
      throw error;
    }
  }

  /** Mirrors FTP to IndexedDB and, with the local backend, to SQLite. */
  async function saveFtp(value: number) {
    mirrorProfile(value, new Date().toISOString());
    try {
      await saveProfile(value);
      if (readStored('summit-pending-ftp', null) === value) saveStored('summit-pending-ftp', null);
      setStatus('local');
    } catch (error) {
      if (error instanceof BrowserModeError) { setStatus('browser'); return; }
      setStatus('local-offline');
      optionsRef.current.notify('FTP er lagret lokalt og synkroniseres når backend er tilgjengelig.');
    }
  }

  return { history, status, addRide, importRides, deleteRide, saveFtp };
}
