/* SUMMIT service worker (hand-written, no build step).
 * - Pages (navigation, /, /index.html): network first, cached copy when offline.
 * - Hashed Vite output (/assets/name-HASH.ext): cache first; the file never changes.
 * - Other same-origin files (icons, textures): network first with a cached fallback.
 * - /api/* (local backend), /_vercel/* and other origins: never touched or cached.
 * Registered only in production builds on a real host (see src/registerServiceWorker.ts).
 */
const VERSION = 'summit-v1';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const STATIC = `${VERSION}-static`;
const MAX_ASSETS = 120;
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try { await (await caches.open(PAGES)).add(new Request('/', { cache: 'reload' })); } catch { /* offline install: first visit caches it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('summit-') && !name.startsWith(`${VERSION}-`)) await caches.delete(name);
    await self.clients.claim();
  })());
});

const cacheable = response => response && response.ok && response.status === 200 && response.type === 'basic';

async function page(request, url) {
  const cache = await caches.open(PAGES);
  const key = url.pathname === '/index.html' ? '/' : url.pathname;
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key) || await cache.match('/');
    if (cached) return cached;
    throw error;
  }
}

async function hashedAsset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
  }
  return response;
}

async function staticFile(request) {
  const cache = await caches.open(STATIC);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js' || url.pathname.startsWith('/_vercel/')) return;
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(page(request, url));
  } else if (HASHED.test(url.pathname)) {
    event.respondWith(hashedAsset(request));
  } else {
    event.respondWith(staticFile(request));
  }
});
