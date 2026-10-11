/**
 * Static-hosting smoke test (browser mode, like Vercel): serves dist/ with a
 * plain static server, so /api does not exist.
 *
 *   npm run build && node scripts/static-smoke.mjs
 *
 * Port: SUMMIT_STATIC_PORT (default 5302). The page is opened as
 * http://summit.test:<port> (mapped to 127.0.0.1 and treated as a secure
 * origin) so the production service worker registers as on a real host.
 * Never contacts the user's app (3001/5186), database or sensors.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { Decoder, Stream } from '@garmin/fitsdk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'output/static-smoke');
const port = Number(process.env.SUMMIT_STATIC_PORT || 5302);
assert.ok(![3001, 5186].includes(port), 'Use a port that is not the user\'s running app');
const origin = `http://summit.test:${port}`;
const checks = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const errors = [];
const apiRequests = [];

const ride = (id, date, extra = {}) => ({
  id, name: extra.name ?? `Økt ${id}`, date, startedAt: new Date(Date.parse(date) - 125000).toISOString(),
  seconds: 120, distance: 0.9, avgPower: 205, energy: 24.6, zoneSeconds: [0, 0, 120, 0, 0, 0, 0],
  completed: true, demo: false, ftp: 250, skippedSeconds: 0, timerEvents: [{ wallSecond: 0, type: 'start' }],
  samples: Array.from({ length: 120 }, (_, i) => ({ second: i + 1, power: 200 + (i % 11), cadence: 88, heartRate: i < 20 ? null : 131, targetPower: 205, wallSecond: i + 1, workoutSecond: i + 1, measured: i !== 60 })),
  ...extra,
});
const legacyRide = ride('legacy-ride-1', '2026-09-20T18:00:00.000Z', { name: 'Gammel økt fra localStorage' });
const importedRide = ride('imported-ride-1', '2026-09-28T18:00:00.000Z', { name: 'Importert sweet spot' });
const customWorkout = {
  version: 1, id: 'imported-template', name: 'Importert 4 × 8', description: 'Fra sikkerhetskopi', warmup: { value: 10, unit: 'minutes', intensity: 0.55 }, cooldown: null,
  groups: [{ id: 'g1', name: 'Hoveddel', sets: 1, reps: 4, work: { value: 8, unit: 'minutes', intensity: 0.9 }, recovery: { value: 2, unit: 'minutes', intensity: 0.5 }, setRecovery: null }],
};

let server, browser;
try {
  await mkdir(out, { recursive: true });
  server = await preview({
    root, configFile: false, logLevel: 'error',
    preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, allowedHosts: ['summit.test'] },
  });
  // The full Chromium build (channel "chromium") honours the secure-origin flag; the headless shell does not.
  browser = await chromium.launch({
    headless: true, channel: 'chromium',
    args: ['--enable-unsafe-swiftshader', '--host-resolver-rules=MAP summit.test 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${origin}`],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'allow' });
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(new URL(request.url()).pathname); });
  await context.addInitScript(() => {
    window.__wake = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { async request(type) {
      const lock = new EventTarget();
      lock.type = type; lock.released = false;
      lock.release = async () => { if (!lock.released) { lock.released = true; window.__wake.push('release'); lock.dispatchEvent(new Event('release')); } };
      window.__wake.push('request');
      return lock;
    } } });
    window.__persistCalls = 0;
    if (navigator.storage) {
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => { window.__persistCalls++; return true; };
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/net::ERR|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const ready = () => page.waitForFunction(() => !!window.render_game_to_text);
  const toast = async () => (await page.locator('.toast').count()) ? page.locator('.toast').innerText() : '';
  const openHistory = () => page.getByRole('button', { name: 'Min utvikling', exact: true }).first().click();
  const idbRides = () => page.evaluate(() => new Promise((resolveIds, reject) => {
    const open = indexedDB.open('summit');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const get = open.result.transaction('rides').objectStore('rides').getAllKeys(); get.onsuccess = () => { resolveIds(get.result); open.result.close(); }; };
  }));

  // 1. Legacy localStorage history migrates into IndexedDB without loss.
  await page.goto(origin);
  await ready();
  await page.evaluate(ride => { localStorage.setItem('summit-history', JSON.stringify([ride])); }, legacyRide);
  await page.reload();
  await ready();
  await openHistory();
  await page.getByText(legacyRide.name).waitFor();
  await page.waitForFunction(() => localStorage.getItem('summit-history') === null);
  assert.deepEqual(await idbRides(), [legacyRide.id]);
  assert.ok(await page.getByText('Lagret i denne nettleseren').isVisible());
  check('legacy localStorage history migrated to IndexedDB; history shows calm browser-storage status');

  // 2. Demo ride: wake lock while running, released on pause/finish; no backend toasts; no FIT for demo.
  await page.getByRole('button', { name: 'Treningsrom', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ta en demotur', exact: true }).click();
  await page.waitForFunction(() => window.__wake.includes('request'));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => window.__wake.at(-1) === 'release');
  await page.getByRole('button', { name: 'Fortsett økten', exact: true }).first().click();
  await page.waitForFunction(() => window.__wake.at(-1) === 'request');
  for (let i = 0; i < 240 && (await state()).session; i++) await page.evaluate(() => window.advanceTime(30000));
  assert.equal((await state()).session, null);
  await page.waitForFunction(() => window.__wake.at(-1) === 'release');
  await page.getByRole('button', { name: 'Last ned FIT-fil', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Last ned FIT-fil', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__persistCalls), 0, 'demo rides do not ask for persistent storage');
  await page.waitForTimeout(500);
  assert.doesNotMatch(await toast(), /backend|server|database/i);
  check('demo ride completes in browser mode: wake lock held while riding and released on pause/finish, FIT disabled, no backend toast');
  await page.screenshot({ path: resolve(out, 'demo-summary.png') });
  await page.getByRole('button', { name: 'Se min utvikling', exact: true }).click();
  assert.equal((await idbRides()).length, 2);

  // 3. Import a backup with a real ride, a custom workout and an FTP.
  const backupIn = resolve(out, 'backup-in.json');
  await writeFile(backupIn, JSON.stringify({ app: 'SUMMIT', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), profile: { ftp: 280 }, rides: [importedRide, legacyRide], customWorkouts: [customWorkout] }));
  await page.locator('input.backup-file').setInputFiles(backupIn);
  await page.locator('.backup-status').getByText(/Importert: 1 ny økt · 1 fantes fra før · 1 ny øktmal/).waitFor();
  await page.getByRole('button', { name: 'Bruk 280 W som FTP' }).click();
  assert.equal((await state()).ftp, 280);
  assert.equal(await page.evaluate(() => window.__persistCalls), 1, 'persistent storage requested after the first real ride');
  await page.getByText(importedRide.name).waitFor();
  check('import merges by ride id, adds custom workout, FTP changes only on explicit click, persist() requested once');
  await page.screenshot({ path: resolve(out, 'history-after-import.png'), fullPage: true });

  // 4. FIT export of a real ride in the browser.
  await page.getByText(importedRide.name).click();
  const fitDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Last ned FIT-fil', exact: true }).click();
  const fitFile = resolve(out, 'imported.fit');
  await (await fitDownload).saveAs(fitFile);
  const decoder = new Decoder(Stream.fromByteArray(await readFile(fitFile)));
  assert.equal(decoder.checkIntegrity(), true);
  const { messages, errors: fitErrors } = decoder.read();
  assert.deepEqual(fitErrors, []);
  assert.equal(messages.recordMesgs.length, 119, 'unmeasured sample is left out, never invented');
  assert.equal(messages.sessionMesgs[0].subSport, 'indoorCycling');
  assert.equal(messages.recordMesgs[0].heartRate, undefined);
  check('FIT export works without backend: Garmin CRC ok, measured samples only, no invented heart rate');
  await page.getByRole('button', { name: 'Se min utvikling', exact: true }).click();

  // 5. Full backup export, and re-import is idempotent.
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sikkerhetskopi', exact: true }).click();
  const backupOut = resolve(out, 'backup-out.json');
  await (await backupDownload).saveAs(backupOut);
  const backup = JSON.parse(await readFile(backupOut, 'utf8'));
  assert.equal(backup.app, 'SUMMIT');
  assert.equal(backup.rides.length, 3);
  assert.equal(backup.rides.filter(r => r.demo).length, 1);
  assert.equal(backup.profile.ftp, 280);
  assert.deepEqual(backup.customWorkouts.map(w => w.id), [customWorkout.id]);
  await page.locator('input.backup-file').setInputFiles(backupOut);
  await page.locator('.backup-status').getByText(/Importert: 0 nye økter · 3 fantes fra før/).waitFor();
  check('backup contains rides, profile and custom workouts; re-import adds nothing');

  // 6. Reload keeps everything; IndexedDB restores FTP and templates if localStorage is cleared.
  await page.reload();
  await ready();
  await openHistory();
  for (const name of [legacyRide.name, importedRide.name]) await page.getByText(name).first().waitFor();
  assert.equal((await state()).ftp, 280);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).ftp === 280);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).workoutCount === 101);
  check('reload keeps rides; FTP and custom workouts restored from IndexedDB after localStorage was cleared');

  // 7. Offline reload through the service worker.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined);
  await context.setOffline(true);
  await page.reload();
  await ready();
  await openHistory();
  await page.getByText(importedRide.name).waitFor();
  await context.setOffline(false);
  check('service worker serves the app offline; history still loads from IndexedDB');

  // 8. Mobile layout of the history header.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(out, 'history-mobile.png') });
  check('history header with backup buttons fits 390 px without horizontal scroll');

  assert.ok(apiRequests.every(path => path === '/api/health'), `unexpected API calls: ${apiRequests.join(', ')}`);
  assert.ok(apiRequests.length <= 6, `health probed once per page load, got ${apiRequests.length}`);
  check(`only /api/health was requested (${apiRequests.length}×, once per page load); no ANT or sync polling`);
  assert.deepEqual(errors, []);
  check('no page or console errors');
  console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
} finally {
  await browser?.close();
  await new Promise(done => server ? server.httpServer.close(done) : done());
}
