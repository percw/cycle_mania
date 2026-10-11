import { describe, expect, it } from 'vitest';
import { shouldRegisterServiceWorker } from './registerServiceWorker';

const hosted = { production: true, hostname: 'summit.example.app', secure: true, supported: true };
describe('service worker registration', () => {
  it('registers only for the hosted production build', () => {
    expect(shouldRegisterServiceWorker(hosted)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...hosted, production: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...hosted, secure: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...hosted, supported: false })).toBe(false);
  });
  it('never registers on this machine, including the local backend on 127.0.0.1:3001', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) expect(shouldRegisterServiceWorker({ ...hosted, hostname })).toBe(false);
  });
});
