import { afterEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('./api');
async function freshApi(handler: (url: string) => Response | Promise<Response>) {
  vi.resetModules();
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { const url = String(input); calls.push(url); return handler(url); }));
  return { api: await import('./api') as Api, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); });

describe('backend detection', () => {
  it('uses the local backend when /api/health answers like SUMMIT', async () => {
    const { api, calls } = await freshApi(url => url.endsWith('/health') ? json({ ok: true, storage: 'sqlite', rides: 0 }) : json([]));
    expect(await api.detectBackend()).toBe('local');
    expect(await api.loadRides()).toEqual([]);
    expect(calls).toEqual(['/api/health', '/api/rides']);
  });
  it('switches to browser mode on a static host and stops calling the API', async () => {
    // Static hosts answer unknown paths with 404 or with index.html (SPA fallback).
    for (const response of [() => new Response('Not found', { status: 404 }), () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })]) {
      const { api, calls } = await freshApi(() => response());
      await expect(api.loadRides()).rejects.toBeInstanceOf(api.BrowserModeError);
      await expect(api.getAntStatus()).rejects.toBeInstanceOf(api.BrowserModeError);
      expect(api.currentBackendMode()).toBe('browser');
      expect(calls).toEqual(['/api/health']);
    }
  });
  it('treats a network failure as browser mode and probes only once', async () => {
    const { api, calls } = await freshApi(() => { throw new TypeError('Failed to fetch'); });
    const [a, b] = await Promise.all([api.detectBackend(), api.detectBackend()]);
    expect([a, b]).toEqual(['browser', 'browser']);
    expect(calls).toHaveLength(1);
  });
  it('can pick up a local server that starts later', async () => {
    let up = false;
    const { api } = await freshApi(url => up && url.endsWith('/health') ? json({ ok: true, storage: 'sqlite', rides: 0 }) : new Response('', { status: 502 }));
    expect(await api.detectBackend()).toBe('browser');
    up = true;
    expect(await api.recheckBackend()).toBe('local');
    expect(api.currentBackendMode()).toBe('local');
  });
});
