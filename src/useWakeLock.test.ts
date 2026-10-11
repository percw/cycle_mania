import { describe, expect, it } from 'vitest';
import { createWakeLock } from './useWakeLock';

function setup(supported = true) {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener); },
  };
  const locks: { released: boolean; release(): Promise<void>; addEventListener(type: 'release', l: () => void): void; drop(): void }[] = [];
  const nav = supported ? { wakeLock: { async request() {
    let onRelease = () => {};
    const lock = {
      released: false,
      async release() { if (!lock.released) { lock.released = true; onRelease(); } },
      addEventListener(_: 'release', listener: () => void) { onRelease = listener; },
      drop() { lock.released = true; onRelease(); },
    };
    locks.push(lock);
    return lock;
  } } } : {};
  const hide = (state: DocumentVisibilityState) => { doc.visibilityState = state; listeners.forEach(listener => listener()); };
  return { doc, nav, locks, hide, listeners };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('screen wake lock', () => {
  it('holds the lock while riding and releases it on pause', async () => {
    const { doc, nav, locks } = setup();
    const lock = createWakeLock(nav, doc as unknown as Document);
    await lock.set(true);
    expect(lock.held).toBe(true);
    lock.set(false);
    expect(locks[0].released).toBe(true);
    expect(lock.held).toBe(false);
  });
  it('requests the lock again when the tab becomes visible', async () => {
    const { doc, nav, locks, hide } = setup();
    const lock = createWakeLock(nav, doc as unknown as Document);
    await lock.set(true);
    locks[0].drop();
    hide('hidden');
    await flush();
    expect(locks).toHaveLength(1);
    hide('visible');
    await flush();
    expect(locks).toHaveLength(2);
    expect(lock.held).toBe(true);
  });
  it('does not re-acquire after the ride has stopped', async () => {
    const { doc, nav, locks, hide, listeners } = setup();
    const lock = createWakeLock(nav, doc as unknown as Document);
    await lock.set(true);
    lock.set(false);
    hide('hidden');
    hide('visible');
    await flush();
    expect(locks).toHaveLength(1);
    lock.dispose();
    expect(listeners.size).toBe(0);
  });
  it('releases a lock that arrives after the ride was paused', async () => {
    const { doc, nav, locks } = setup();
    const lock = createWakeLock(nav, doc as unknown as Document);
    const pending = lock.set(true);
    lock.set(false);
    await pending;
    expect(locks[0].released).toBe(true);
    expect(lock.held).toBe(false);
  });
  it('is a no-op where the API is missing', async () => {
    const { doc, nav } = setup(false);
    const lock = createWakeLock(nav, doc as unknown as Document);
    await lock.set(true);
    expect(lock.held).toBe(false);
  });
});
