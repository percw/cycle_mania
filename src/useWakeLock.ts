import { useEffect, useRef } from 'react';

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void };
type WakeLockNavigator = { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
type VisibilityDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Keeps the screen on while wanted. Browsers drop the lock when the tab is
 * hidden, so it is requested again when the page becomes visible.
 */
export function createWakeLock(nav: WakeLockNavigator, doc: VisibilityDocument) {
  let wanted = false;
  let sentinel: Sentinel | null = null;
  let pending: Promise<void> | null = null;
  function acquire() {
    if (!wanted || pending || (sentinel && !sentinel.released) || doc.visibilityState !== 'visible' || !nav.wakeLock) return pending;
    pending = nav.wakeLock.request('screen').then(lock => {
      if (!wanted) { void lock.release().catch(() => {}); return; }
      sentinel = lock;
      lock.addEventListener('release', () => { if (sentinel === lock) sentinel = null; });
    }).catch(() => { /* Battery saver or no permission: the ride continues without it. */ })
      .finally(() => { pending = null; });
    return pending;
  }
  function release() {
    wanted = false;
    const lock = sentinel;
    sentinel = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }
  const onVisibility = () => { if (doc.visibilityState === 'visible') void acquire(); };
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    set(active: boolean) { if (active) { wanted = true; return acquire(); } release(); return null; },
    get held() { return !!sentinel && !sentinel.released; },
    dispose() { release(); doc.removeEventListener('visibilitychange', onVisibility); },
  };
}

/** Screen Wake Lock while a ride is running; released when paused or finished. */
export function useWakeLock(active: boolean) {
  const controller = useRef<ReturnType<typeof createWakeLock> | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const lock = createWakeLock(navigator as unknown as WakeLockNavigator, document);
    controller.current = lock;
    return () => { lock.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { void controller.current?.set(active); }, [active]);
}
