const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Offline support only for the hosted production build. Dev servers, previews
 * and the local backend on 127.0.0.1:3001 never get a service worker, so local
 * tests always see fresh files.
 */
export function shouldRegisterServiceWorker(env: { production: boolean; hostname: string; secure: boolean; supported: boolean }) {
  return env.production && env.supported && env.secure && !LOCAL_HOSTS.has(env.hostname);
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const register = shouldRegisterServiceWorker({
    production: import.meta.env.PROD,
    hostname: location.hostname,
    secure: window.isSecureContext,
    supported: 'serviceWorker' in navigator,
  });
  if (!register) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the app works without offline support */ });
  }, { once: true });
}
