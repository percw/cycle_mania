/**
 * Run: node scripts/sensor-smoke.mjs
 * Tron journey coverage: SUMMIT_SENSOR_WORLD=tron node scripts/sensor-smoke.mjs
 * Real browser + real isolated SQLite/API/FIT exporter, simulated BLE packets.
 * Three.js scene is stubbed in-browser: graphics are covered by the visual smoke.
 * Never connects to the user's app, database, Bluetooth or ANT USB hardware.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { Decoder, Stream } from '@garmin/fitsdk';
import { createLocalServer } from '../server/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tron = process.env.SUMMIT_SENSOR_WORLD === 'tron';
const artifacts = resolve(root, `output/playwright/sensor-smoke${tron ? '-tron' : ''}`);
const temporary = await mkdtemp(resolve(tmpdir(), 'summit-sensor-smoke-'));
const database = resolve(temporary, 'smoke.sqlite');
const checks = [];
const pageErrors = [];
let backend, vite, browser, page;
const antStub = {
  getStatus: () => ({ status: 'disconnected', error: null, heartRate: null, power: null,
    cadence: null, bikeId: 47963, updatedAt: null, heartRateUpdatedAt: null, powerUpdatedAt: null }),
  disconnect() { return this.getStatus(); },
  connect() { throw new Error('ANT hardware must never be accessed by this smoke test'); },
};
const listen = (app, port = 0) => new Promise((resolveListen, reject) => {
  app.server.once('error', reject);
  app.server.listen(port, '127.0.0.1', () => resolveListen(`http://127.0.0.1:${app.server.address().port}`));
});
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const checkpoint = () => page.evaluate(() => JSON.parse(localStorage.getItem('summit-active-session')));
const check = name => { checks.push(name); console.log(`PASS ${name}`); };

try {
  await mkdir(artifacts, { recursive: true });
  backend = createLocalServer({ dbPath: database, antBridge: antStub });
  const apiBase = await listen(backend);
  assert.notEqual(new URL(apiBase).port, '3001');
  vite = await createViteServer({
    root, configFile: false, plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, proxy: { '/api': apiBase } },
  });
  await vite.listen();
  const appBase = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.notEqual(new URL(appBase).port, '5186');
  const initial = await (await fetch(`${apiBase}/api/rides`)).json();
  assert.deepEqual(initial, []);
  check('isolated temporary SQLite, ephemeral API and independent Vite server');

  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const controls = { requests: JSON.parse(localStorage.getItem('__sensor-smoke-requests') || '[]'), power: 125, cadence: 92, heartRate: 156, contact: true };
    window.__sensorMock = controls;
    const u16 = value => [value & 255, (value >> 8) & 255];
    class Characteristic extends EventTarget {
      constructor(kind) { super(); this.kind = kind; }
      emit() {
        const bytes = this.kind === 'bike'
          ? [...u16(4 | 64), ...u16(3200), ...u16(controls.cadence * 2), ...u16(controls.power)]
          : [controls.contact ? 6 : 4, controls.heartRate];
        this.value = new DataView(Uint8Array.from(bytes).buffer);
        this.dispatchEvent(new Event('characteristicvaluechanged'));
      }
      async startNotifications() {
        this.timer = setInterval(() => this.emit(), 200);
        setTimeout(() => this.emit(), 0);
        return this;
      }
    }
    class Device extends EventTarget {
      constructor(kind) {
        super();
        this.id = `sensor-smoke-${kind}`;
        this.name = kind === 'bike' ? 'XEBEX simulated FTMS' : 'Polar simulated BLE HR';
        this.characteristic = new Characteristic(kind);
        const device = this;
        this.gatt = {
          connected: false,
          async connect() { this.connected = true; return this; },
          disconnect() {
            this.connected = false;
            clearInterval(device.characteristic.timer);
            device.dispatchEvent(new Event('gattserverdisconnected'));
          },
          async getPrimaryService(uuid) {
            if (uuid !== (kind === 'bike' ? 0x1826 : 0x180d)) throw new DOMException('No service', 'NotFoundError');
            return { async getCharacteristic(characteristicId) {
              if (characteristicId !== (kind === 'bike' ? 0x2ad2 : 0x2a37)) throw new DOMException('No characteristic', 'NotFoundError');
              return device.characteristic;
            } };
          },
        };
      }
    }
    const devices = { bike: new Device('bike'), hr: new Device('hr') };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
      async getDevices() {
        const authorized = JSON.parse(localStorage.getItem('__sensor-smoke-permissions') || '[]');
        return authorized.map(kind => devices[kind]);
      },
      async requestDevice(options) {
        const kind = options.filters.some(filter => filter.services?.includes(0x180d)) ? 'hr' : 'bike';
        controls.requests.push(kind);
        localStorage.setItem('__sensor-smoke-requests', JSON.stringify(controls.requests));
        const authorized = JSON.parse(localStorage.getItem('__sensor-smoke-permissions') || '[]');
        localStorage.setItem('__sensor-smoke-permissions', JSON.stringify([...new Set([...authorized, kind])]));
        return devices[kind];
      },
    } });
  });
  page = await context.newPage();
  // Shader compilation on headless software GPUs can block the event loop for
  // >3s and intentionally trigger the app's inactivity pause. This test covers
  // sensors/timers/storage; leave rendering performance to the separate smoke.
  await page.route('**/src/WorldScene.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export default function SensorTestScene() { return null; }',
  }));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.port === '3001' || url.port === '5186') pageErrors.push(`Forbidden user runtime request: ${request.url()}`);
  });
  await page.goto(appBase, { waitUntil: 'networkidle' });
  if (tron) {
    await page.locator('.world-option').filter({ hasText: 'TRON / The Grid' }).click();
    assert.equal((await state()).route, 'tron');
    assert.equal((await state()).journey.completed, 0);
  }
  await page.locator('.quick-duration button').filter({hasText:'4 × 10 min'}).click();
  await page.getByRole('button', { name: 'Start økten', exact: true }).click();
  await page.getByText('LIVE · BLUETOOTH', { exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).session?.elapsed >= 2);
  assert.equal((await state()).session.demo, false);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__sensorMock.requests), ['bike']);
  check('one Start click connects the bike and begins a measured workout without an app dialog');

  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).session?.expedition?.restored === 1, undefined, { timeout: 45000 });
  const firstMission = (await state()).session.expedition;
  assert.equal(firstMission.completed, 1);
  assert.equal(firstMission.discovered, 0);
  assert.equal(firstMission.choiceOpen, true);
  check('thirty real seconds of fresh on-target BLE packets complete a restoration mission');
  const earnedJourney = tron ? (await state()).journey : null;
  if (tron) {
    assert.ok(earnedJourney.completed >= 1);
    assert.equal(earnedJourney.step, 2);
    assert.equal(earnedJourney.log.at(-1).variant, 'bridge');
    assert.equal(earnedJourney.choices.explore.variant, 'garden');
    await page.locator('.journey-choice button[data-route="explore"]').click();
    const chosenJourney = (await state()).journey;
    assert.equal(chosenJourney.route, 'explore');
    assert.equal(chosenJourney.destination, earnedJourney.choices.explore.destination);
    assert.equal(chosenJourney.variant, 'garden');
    assert.notEqual(chosenJourney.destination, earnedJourney.choices.restore.destination);
    check('measured Tron bridge completion unlocks its garden branch and choice changes the next destination');
  } else {
    await page.locator('.expedition-choice').getByRole('button', { name: /Utforsk/ }).click();
  }
  assert.equal((await state()).session.expedition.route, 'explore');
  assert.equal((await state()).session.expedition.choiceOpen, false);
  check('earned route decision selects exploration through the live mission controls');

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const beforeReload = await state();
  const initialCheckpoint = await checkpoint();
  assert.ok(initialCheckpoint.samples.every(sample => Number.isFinite(sample.workoutSecond)));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).bluetooth === 'connected');
  const reloaded = await state();
  assert.notEqual(reloaded.mode, 'riding', 'Automatic sensor connection must not resume the workout');
  assert.deepEqual(await page.evaluate(() => window.__sensorMock.requests), ['bike']);
  assert.ok(Math.abs(reloaded.session.elapsed - beforeReload.session.elapsed) < 1);
  assert.deepEqual(reloaded.session.expedition, beforeReload.session.expedition);
  if (tron) assert.deepEqual(reloaded.journey, beforeReload.journey, 'Paused journey must survive checkpoint reload exactly');
  assert.deepEqual((await checkpoint()).samples, initialCheckpoint.samples);
  check('reload silently reconnects the remembered authorized bike with no new picker and keeps workout paused');
  await page.locator('.toast').filter({ hasText: /Forbindelsen ble brutt|Ingen ferske wattdata|Koble til sykkelen/ }).waitFor({ state: 'hidden', timeout: 10000 });
  check('fresh reconnected telemetry clears stale connection notices without dismissing them');

  await page.getByRole('button', { name: 'Sensorinnstillinger', exact: true }).click();
  await page.getByRole('button', { name: 'Koble til BLE-puls', exact: true }).click();
  await page.getByText('Polar simulated BLE HR', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.sensor-value')?.textContent === '156');
  assert.deepEqual(await page.evaluate(() => window.__sensorMock.requests), ['bike', 'hr']);
  check('sensor settings connects an independent standard BLE heart-rate sensor');
  await page.evaluate(() => { window.__sensorMock.power = 267; });
  await page.getByRole('button', { name: 'Lukk', exact: true }).click();
  await page.getByRole('button', { name: 'Fortsett økten', exact: true }).click();
  await page.getByText('LIVE · BLUETOOTH', { exact: true }).waitFor();
  await page.waitForFunction(elapsed => JSON.parse(window.render_game_to_text()).session?.elapsed >= elapsed + 2, beforeReload.session.elapsed);
  assert.equal((await state()).session.demo, false);
  // The cockpit shows 3 s average power (display only); it must settle on the exact sensor value.
  await page.waitForFunction(() => document.querySelector('.ride-console .power-focus > strong')?.textContent === '267W', null, { timeout: 8000 });
  assert.deepEqual((await page.locator('.ride-console .secondary-metrics b').allTextContents()).slice(0, 2), ['92', '156']);
  {
    // Speed and distance sit in the capsule; arcade worlds show their own exaggerated distance.
    const live = (await state()).session;
    const shown = Number(await page.locator('.speed-capsule .hud-distance b').textContent());
    const km = ['tron', 'neon', 'sky'].includes(live.world) ? live.arcadeKm : live.distanceKm;
    assert.ok(Math.abs(shown - km) < 0.15, `capsule shows ${shown} km, session has ${km}`);
    assert.ok(Number.parseInt(await page.locator('.speed-capsule strong').textContent()) > 0);
  }
  check('ride console displays measured 267 W, 92 rpm, 156 bpm and accumulated distance');

  const beforeWarmup = (await state()).session;
  assert.equal(beforeWarmup.block.kind, 'warmup');
  await page.getByRole('button', { name: 'Jeg er ferdig oppvarmet', exact: true }).click();
  const afterWarmup = (await state()).session;
  assert.notEqual(afterWarmup.block.kind, 'warmup');
  assert.ok(afterWarmup.elapsed - beforeWarmup.elapsed < 1, 'Skipping warmup must not add ride time');
  // Record some actual work before skipping again: later analysis must place
  // these samples in the work block, not in the skipped warmup.
  await page.waitForFunction(elapsed => JSON.parse(window.render_game_to_text()).session?.elapsed >= elapsed + 2, afterWarmup.elapsed);
  const beforeSegment = (await state()).session;
  await page.getByRole('button', { name: 'Neste segment', exact: true }).click();
  const afterSegment = (await state()).session;
  assert.ok(afterSegment.index > afterWarmup.index);
  assert.ok(afterSegment.elapsed - beforeSegment.elapsed < 1, 'Skipping segment must not add ride time');
  check('warmup and segment skips advance workout without inflating recorded duration');

  await page.waitForFunction(elapsed => JSON.parse(window.render_game_to_text()).session?.elapsed >= elapsed + 2, afterSegment.elapsed);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const skippedCheckpoint = await checkpoint();
  assert.ok(skippedCheckpoint.samples.some(sample => sample.workoutSecond > 600 && sample.workoutSecond <= 1200 && sample.targetPower === 245));
  assert.ok(skippedCheckpoint.samples.some(sample => sample.workoutSecond > 1200 && sample.workoutSecond <= 1380 && sample.targetPower === 125));
  assert.ok(skippedCheckpoint.samples.every((sample, index, all) => !index || sample.workoutSecond > all[index - 1].workoutSecond));
  check('samples retain increasing planned positions and exact work/recovery targets after skips');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).bluetooth === 'connected');
  assert.deepEqual((await checkpoint()).samples, skippedCheckpoint.samples);
  assert.equal((await checkpoint()).skippedSeconds, skippedCheckpoint.skippedSeconds);
  assert.equal((await state()).session.elapsed, skippedCheckpoint.elapsed);
  await page.evaluate(() => { window.__sensorMock.power = 267; });
  check('reload after skips preserves every sample position and skipped offset exactly while paused');
  const paused = await state();
  assert.equal(paused.mode, 'paused');
  await page.waitForTimeout(1600);
  assert.equal((await state()).session.elapsed, paused.session.elapsed);
  await page.getByRole('button', { name: 'Fortsett økten', exact: true }).click();
  await page.waitForTimeout(1600);
  const resumed = await state();
  assert.equal(resumed.mode, 'riding');
  assert.ok(resumed.session.elapsed - paused.session.elapsed > 1);
  assert.ok(resumed.session.elapsed - paused.session.elapsed < 2.4, 'Paused time must not be backfilled');
  check('pause freezes elapsed time and resume excludes paused duration');

  await page.getByRole('button', { name: 'Avslutt økt', exact: true }).click();
  const beforeSave = await state();
  const savedRequest = page.waitForResponse(response => response.url().endsWith('/api/rides') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lagre og avslutt', exact: true }).click();
  const savedResponse = await savedRequest;
  assert.equal(savedResponse.status(), 200, await savedResponse.text());
  const rides = await (await fetch(`${apiBase}/api/rides`)).json();
  assert.equal(rides.length, 1);
  const ride = rides[0];
  assert.equal(ride.demo, false);
  assert.ok(ride.seconds >= 30 && ride.seconds < 60);
  assert.ok(ride.skippedSeconds > 60);
  assert.ok(ride.samples.length >= 3);
  assert.ok(ride.samples.every(sample => [125, 267].includes(sample.power) && sample.cadence === 92));
  assert.ok(ride.samples.some(sample => sample.heartRate === 156));
  assert.deepEqual(ride.samples.slice(0, skippedCheckpoint.samples.length), skippedCheckpoint.samples);
  assert.ok(ride.samples.every(sample => Number.isFinite(sample.workoutSecond)));
  assert.ok(ride.samples.some(sample => sample.workoutSecond - sample.second > 1100));
  assert.ok(['neon', 'sky', 'fjord', 'alpine', 'midnight', 'tron'].includes(ride.worldId));
  if (tron) assert.equal(ride.worldId, 'tron');
  assert.ok(ride.game && Number.isFinite(ride.game.score));
  assert.ok(ride.game.observed > 0);
  assert.ok(ride.game.checkpoints.length > 0);
  assert.ok(ride.game.score > 0, 'Measured on-target warmup must earn game points');
  assert.equal(ride.game.score, Math.round(beforeSave.session.game.score));
  assert.equal(ride.game.stars, beforeSave.session.game.stars);
  assert.equal(ride.game.pulses, beforeSave.session.game.pulses);
  assert.equal(ride.worldId, beforeSave.session.world);
  check('saved world and positive game score match the real workout after checkpoint recovery');
  const runtimeExpedition = beforeSave.session.expedition;
  assert.deepEqual(ride.expedition, Object.fromEntries(['version', 'restored', 'discovered', 'completed', 'discoveries', 'choices'].map(key => [key, runtimeExpedition[key]])));
  assert.equal(ride.expedition.restored, 1);
  assert.equal(ride.expedition.discovered, 0);
  assert.equal(ride.expedition.completed, 1);
  assert.equal(ride.expedition.choices[0].route, 'restore');
  assert.equal(ride.expedition.choices[1].route, 'explore');
  assert.equal(ride.expedition.choices[1].stage, 2);
  check('saved positive expedition counters, discoveries and route choices match the measured runtime');
  assert.ok(Math.abs(ride.zoneSeconds.reduce((sum, seconds) => sum + seconds, 0) - ride.seconds) < 0.01);
  check('save stores actual duration, zones and measured sensor samples via API into isolated SQLite');

  await page.locator('.session-analysis').waitFor({ state: 'visible' });
  assert.match(await page.locator('.session-analysis').innerText(), /Slik traff du økten/);
  assert.match(await page.locator('.session-analysis').innerText(), /av planen ble hoppet over/);
  assert.equal(await page.locator('.session-power-plot svg').count(), 1);
  // The full per-part table is progressive disclosure in the report; open it like a rider would.
  await page.locator('.interval-analysis > summary').click();
  const intervalRows = page.locator('.interval-analysis tbody tr');
  assert.equal(await intervalRows.count(), 10);
  assert.match(await intervalRows.nth(2).innerText(), /245 W/);
  assert.match(await intervalRows.nth(3).innerText(), /125 W/);
  assert.equal(await page.locator('.summary-game-details').getAttribute('open'), null);
  assert.equal(await page.locator('.game-summary').isVisible(), false);
  assert.equal(await page.evaluate(() => !!(document.querySelector('.session-analysis').compareDocumentPosition(document.querySelector('.summary-game-details')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  check('measured execution, skipped time, power chart and interval targets appear before collapsed game rewards');
  await page.locator('.summary-game-details > summary').click();
  assert.equal(await page.locator('.game-summary').isVisible(), true);
  const savedJourney = tron ? (await state()).journey : null;
  if (tron) {
    assert.equal(await page.locator('.journey-receipt').isVisible(), true);
    assert.equal(savedJourney.completed, ride.expedition.completed);
    assert.equal(savedJourney.step, 2);
    assert.deepEqual(savedJourney.log, beforeSave.journey.log);
    assert.deepEqual(savedJourney.choices, beforeSave.journey.choices);
    assert.equal(savedJourney.route, beforeSave.journey.route);
    assert.equal(savedJourney.destination, beforeSave.journey.destination);
    assert.ok((await page.locator('.journey-receipt').innerText()).includes(savedJourney.destination));
    check('Tron journey receipt follows training analysis and retained choices determine the next saved destination');
  }
  await page.locator('.summary-game-details > summary').click();

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Last ned FIT-fil', exact: true }).click();
  const download = await pendingDownload;
  const fitPath = resolve(artifacts, 'simulated-sensors.fit');
  await download.saveAs(fitPath);
  const bytes = await readFile(fitPath);
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  assert.equal(decoder.isFIT(), true);
  assert.equal(decoder.checkIntegrity(), true);
  const { messages, errors } = decoder.read();
  assert.deepEqual(errors, []);
  const measuredSamples = ride.samples.filter(sample => sample.measured !== false);
  assert.ok(measuredSamples.length > 0);
  assert.equal(messages.recordMesgs.length, measuredSamples.length);
  assert.ok(messages.recordMesgs.every(record => [125, 267].includes(record.power) && record.cadence === 92));
  assert.ok(messages.recordMesgs.some(record => record.heartRate === 156));
  assert.equal(messages.sessionMesgs[0].sport, 'cycling');
  assert.ok(Math.abs(messages.sessionMesgs[0].totalTimerTime - ride.seconds) < 0.002);
  assert.ok(messages.eventMesgs.some(event => event.eventType === 'stop'), 'FIT should retain the pause event');
  assert.ok(messages.eventMesgs.filter(event => event.eventType === 'start').length >= 2, 'FIT should retain resume');
  check('downloaded FIT passes Garmin CRC/integrity decoder and contains measured watts, cadence and heart rate');
  await page.screenshot({ path: resolve(artifacts, 'summary.png'), fullPage: true });
  await backend.close();
  backend = createLocalServer({ dbPath: database, antBridge: antStub });
  const restartedApi = await listen(backend, Number(new URL(apiBase).port));
  // FIT is now encoded in the browser, so this runs within Node's keep-alive window and
  // the pooled socket may still point at the closed server: retry once on that error only.
  const restartedRides = await fetch(`${restartedApi}/api/rides`).catch(error => {
    if (error.cause?.code !== 'UND_ERR_SOCKET') throw error;
    return fetch(`${restartedApi}/api/rides`);
  });
  assert.deepEqual(await restartedRides.json(), rides);
  check('SQLite retains the ride after restarting the isolated backend');
  if (tron) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).journey?.completed >= 1);
    assert.equal((await state()).mode, 'browse');
    assert.deepEqual((await state()).journey, savedJourney);
    assert.ok((await page.locator('.journey-board').innerText()).includes(savedJourney.destination));
    check('SQLite restart and fresh browser load retain exact saved Tron journey and next destination');
  }
  await browser.close(); browser = undefined;
  await vite.close(); vite = undefined;
  assert.deepEqual(pageErrors, []);
  check('no browser exceptions or requests to the user runtime');
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ ok: true, world: ride.worldId, checks, samples: ride.samples.length, seconds: ride.seconds, fitBytes: bytes.length, expedition: ride.expedition, ...(tron ? { journey: savedJourney } : {}), pageErrors }, null, 2));
  console.log(`Sensor smoke completed: ${checks.length} checks. Artifacts: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(resolve(artifacts, 'failure-state.json'), JSON.stringify({ state: await state().catch(() => null), text: await page.locator('body').innerText().catch(() => ''), pageErrors, checks }, null, 2));
  }
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await backend?.close();
  await rm(temporary, { recursive: true, force: true });
}
