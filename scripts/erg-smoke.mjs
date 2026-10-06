/**
 * Run: node scripts/erg-smoke.mjs
 * Real browser + isolated temporary SQLite/API + its own Vite server. Simulated
 * BLE devices: an FTMS smart trainer whose control point records every written
 * command and answers with indications, a Tacx FE-C-only trainer, and a
 * standalone CSC cadence sensor. Verifies the exact ERG opcode sequence through
 * a ride (start, block change, pause/resume, disconnect/reconnect, ERG off/on,
 * end), that demo rides and ramp tests never write, the CSC sensor, and the
 * "Test sykkelen din" page including its ERG test, stop button, verdicts,
 * report copy and unsupported-browser guidance.
 * Never connects to the user's app, database, Bluetooth or ANT USB hardware.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalServer } from '../server/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'output/playwright/erg-smoke');
const temporary = await mkdtemp(resolve(tmpdir(), 'summit-erg-smoke-'));
const checks = [];
const pageErrors = [];
let backend, vite, browser, page;
const antStub = {
  getStatus: () => ({ status: 'disconnected', error: null, heartRate: null, power: null,
    cadence: null, bikeId: 47963, updatedAt: null, heartRateUpdatedAt: null, powerUpdatedAt: null }),
  disconnect() { return this.getStatus(); },
  connect() { throw new Error('ANT hardware must never be accessed by this smoke test'); },
};
const listen = (app) => new Promise((resolveListen, reject) => {
  app.server.once('error', reject);
  app.server.listen(0, '127.0.0.1', () => resolveListen(`http://127.0.0.1:${app.server.address().port}`));
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const writes = () => page.evaluate(() => window.__ergMock.writes.map(w => w.bytes));
const hex = list => list.map(bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
const u16 = value => [value & 255, (value >> 8) & 255];
const target = async () => {
  const s = await state();
  return Math.round(s.session.block.intensity * s.ftp);
};
async function waitForWrites(count, timeout = 6000) {
  await page.waitForFunction(n => window.__ergMock.writes.length >= n, count, { timeout });
  await page.waitForTimeout(150);
  return writes();
}
async function expectNewWrites(before, expected, label) {
  const all = await waitForWrites(before + expected.length);
  assert.deepEqual(hex(all.slice(before)), hex(expected), `${label}: unexpected opcode sequence`);
  return all.length;
}

/** Runs in the page before the app: simulated Web Bluetooth. */
function installBluetoothMock() {
  const SIG = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
  const norm = u => typeof u === 'number' ? SIG(u) : /^[0-9a-f]{4}$/i.test(u) ? SIG(parseInt(u, 16)) : u.toLowerCase();
  const u16 = v => [v & 255, (v >> 8) & 255];
  const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const text = s => [...new TextEncoder().encode(s)];
  const controls = { power: 120, cadence: 88, ergTarget: null, writes: [], requests: [], checkDevice: 'trainer', started: performance.now() };
  window.__ergMock = controls;
  class Char extends EventTarget {
    constructor(uuid, options = {}) {
      super();
      this.uuid = norm(uuid);
      this.options = options;
      this.properties = { read: !!options.read, notify: !!options.notify || !!options.emit, write: !!options.write, indicate: !!options.indicate };
    }
    async readValue() {
      if (!this.options.read) throw new DOMException('Not readable', 'NotSupportedError');
      return new DataView(Uint8Array.from(this.options.read()).buffer);
    }
    async startNotifications() {
      this.notifying = true;
      if (this.options.emit) {
        clearInterval(this.timer);
        this.timer = setInterval(() => this.push(this.options.emit()), this.options.interval ?? 250);
        setTimeout(() => this.push(this.options.emit()), 0);
      }
      return this;
    }
    push(bytes) {
      if (!bytes || !this.notifying) return;
      this.value = new DataView(Uint8Array.from(bytes).buffer);
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }
    async writeValueWithResponse(data) {
      if (!this.options.write) throw new DOMException('Not writable', 'NotSupportedError');
      const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
      this.options.write([...view], this);
    }
    stop() { clearInterval(this.timer); this.notifying = false; }
  }
  class Device extends EventTarget {
    constructor(id, name, services) {
      super();
      this.id = id;
      this.name = name;
      this.services = Object.fromEntries(Object.entries(services).map(([uuid, chars]) => [norm(isNaN(uuid) ? uuid : Number(uuid)), Object.fromEntries(chars.map(c => [c.uuid, c]))]));
      const device = this;
      this.gatt = {
        connected: false,
        async connect() { await new Promise(r => setTimeout(r, 30)); this.connected = true; return this; },
        disconnect() {
          if (!this.connected) return;
          this.connected = false;
          device.stopAll();
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
        async getPrimaryService(uuid) {
          if (!this.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
          if (!device.services[norm(uuid)]) throw new DOMException('No service', 'NotFoundError');
          return device.service(norm(uuid));
        },
        async getPrimaryServices() {
          if (!this.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
          return Object.keys(device.services).map(uuid => device.service(uuid));
        },
      };
    }
    service(uuid) {
      const chars = this.services[uuid];
      return {
        uuid,
        async getCharacteristic(c) {
          if (!chars[norm(c)]) throw new DOMException('No characteristic', 'NotFoundError');
          return chars[norm(c)];
        },
        async getCharacteristics() { return Object.values(chars); },
      };
    }
    stopAll() { for (const chars of Object.values(this.services)) for (const c of Object.values(chars)) c.stop(); }
    drop() { this.gatt.connected = false; this.stopAll(); this.dispatchEvent(new Event('gattserverdisconnected')); }
  }
  const pedal = () => {
    // 90 rpm crank events in 1/1024 s.
    const seconds = (performance.now() - controls.started) / 1000;
    const revolutions = Math.floor(seconds * 1.5);
    return [...u16(revolutions & 0xffff), ...u16(Math.round(revolutions / 1.5 * 1024) & 0xffff)];
  };
  const controlPoint = new Char(0x2ad9, {
    indicate: true,
    write(bytes, self) {
      controls.writes.push({ bytes, at: Math.round(performance.now()) });
      if (bytes[0] === 0x05) controls.ergTarget = new DataView(Uint8Array.from(bytes).buffer).getInt16(1, true);
      if (bytes[0] === 0x01 || bytes[0] === 0x08) controls.ergTarget = null;
      setTimeout(() => self.push([0x80, bytes[0], 0x01]), 15);
    },
  });
  const trainer = new Device('erg-smoke-trainer', 'SUMMIT simulert smarttrener', {
    0x1826: [
      new Char(0x2ad2, { emit: () => [...u16(4 | 64), ...u16(3000), ...u16(controls.cadence * 2), ...u16(controls.ergTarget ?? controls.power)] }),
      new Char(0x2acc, { read: () => [...u32((1 << 1) | (1 << 14)), ...u32((1 << 3) | (1 << 13))] }),
      new Char(0x2ad8, { read: () => [...u16(0), ...u16(1200), ...u16(1)] }),
      controlPoint,
      new Char(0x2ada, { notify: true }),
    ],
    0x180a: [
      new Char(0x2a29, { read: () => text('Simulert AS') }),
      new Char(0x2a24, { read: () => text('ERG-1') }),
      new Char(0x2a26, { read: () => text('1.0.0') }),
    ],
  });
  const tacx = new Device('erg-smoke-tacx', 'Tacx Neo simulert', {
    '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e': [
      new Char('6e40fec2-b5a3-f393-e0a9-e50e24dcca9e', { notify: true }),
      new Char('6e40fec3-b5a3-f393-e0a9-e50e24dcca9e', { write: () => {} }),
    ],
    0x1816: [new Char(0x2a5b, { emit: () => [2, ...pedal()] })],
  });
  const csc = new Device('erg-smoke-csc', 'Garmin simulert kadens', {
    0x1816: [new Char(0x2a5b, { emit: () => [2, ...pedal()] })],
  });
  const devices = { trainer, tacx, csc };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
    async getDevices() {
      const authorized = JSON.parse(localStorage.getItem('__erg-smoke-permissions') || '[]');
      return authorized.map(kind => devices[kind]);
    },
    async requestDevice(options) {
      const kind = options.acceptAllDevices ? controls.checkDevice
        : options.filters?.some(f => f.services?.includes(0x1816)) ? 'csc' : 'trainer';
      controls.requests.push(kind);
      const authorized = JSON.parse(localStorage.getItem('__erg-smoke-permissions') || '[]');
      localStorage.setItem('__erg-smoke-permissions', JSON.stringify([...new Set([...authorized, kind])]));
      return devices[kind];
    },
  } });
  window.__ergMock.drop = () => trainer.drop();
}

try {
  await mkdir(artifacts, { recursive: true });
  backend = createLocalServer({ dbPath: resolve(temporary, 'smoke.sqlite'), antBridge: antStub });
  const apiBase = await listen(backend);
  assert.notEqual(new URL(apiBase).port, '3001');
  vite = await createViteServer({
    root, configFile: false, plugins: [react()], logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, proxy: { '/api': apiBase } },
  });
  await vite.listen();
  const appBase = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.ok(!['5186', '3001'].includes(new URL(appBase).port));
  check('isolated temporary SQLite, ephemeral API and independent Vite server');

  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appBase });
  await context.addInitScript(installBluetoothMock);
  // The 3D scene is irrelevant here and can stall headless software GPUs.
  await context.route('**/src/WorldScene.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: 'export default function ErgTestScene() { return null; }',
  }));
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.port === '3001' || url.port === '5186') pageErrors.push(`Forbidden user runtime request: ${request.url()}`);
  });
  await page.goto(appBase, { waitUntil: 'networkidle' });

  // ---- Sensor dialog: connect trainer, ERG toggle, CSC sensor ----
  await page.getByRole('button', { name: 'Sensorinnstillinger', exact: true }).click();
  assert.equal(await page.locator('.erg-toggle').count(), 0, 'ERG toggle must stay hidden before a capable trainer connects');
  await page.getByRole('button', { name: 'Finn sykkelen min', exact: true }).click();
  await page.locator('.erg-toggle').waitFor();
  assert.match(await page.locator('.erg-toggle').innerText(), /Automatisk motstand \(ERG\)[\s\S]*Område 0–1200 W/);
  assert.equal(await page.getByRole('switch', { name: /Automatisk motstand/ }).isChecked(), false);
  assert.deepEqual(await writes(), [], 'Connecting must not write to the control point');
  check('capable FTMS trainer shows an unchecked ERG switch; connecting writes nothing');
  await page.locator('.erg-toggle label').click();
  assert.equal(await page.getByRole('switch', { name: /Automatisk motstand/ }).isChecked(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('summit-erg:erg-smoke-trainer')), 'on');
  await page.waitForTimeout(500);
  assert.deepEqual(await writes(), [], 'Enabling ERG outside a ride must not write');
  check('ERG preference is stored per device and enabling it outside a ride writes nothing');
  await page.locator('.erg-toggle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(artifacts, 'sensor-dialog-erg.png') });

  await page.getByRole('button', { name: 'Koble til kadenssensor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.csc-value')?.textContent === '90', null, { timeout: 8000 });
  assert.match(await page.locator('.sensor-panel').innerText(), /Garmin simulert kadens[\s\S]*gir ikke watt/);
  check('standalone CSC sensor connects and shows 90 rpm from crank revolutions without power');
  await page.screenshot({ path: resolve(artifacts, 'sensor-dialog-csc.png') });
  await page.getByRole('button', { name: 'Lukk', exact: true }).click();

  // ---- Real ride with ERG ----
  await page.locator('.quick-duration button').filter({ hasText: '4 × 10 min' }).click();
  await page.getByRole('button', { name: 'Start økten', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).session?.elapsed >= 0.5);
  const warmup = await target();
  let count = await expectNewWrites(0, [[0x00], [0x07], [0x05, ...u16(warmup)]], 'ride start');
  await page.locator('.erg-pill.on').waitFor();
  assert.equal(await page.locator('.erg-pill').innerText(), `ERG ${warmup} W`);
  check(`ride start requests control, starts and sets the first block target (${warmup} W)`);
  await page.waitForTimeout(3000);
  assert.equal((await writes()).length, count, 'ERG must not write on every tick');
  assert.ok((await state()).session.elapsed >= 3);
  check('no control point writes while the target is unchanged (3 s of ticks)');

  await page.getByRole('button', { name: 'Jeg er ferdig oppvarmet', exact: true }).click();
  const work = await target();
  assert.notEqual(work, warmup);
  count = await expectNewWrites(count, [[0x05, ...u16(work)]], 'warmup skip');
  await page.waitForFunction(w => document.querySelector('.erg-pill')?.textContent === `ERG ${w} W`, work);
  await page.getByRole('button', { name: 'Neste segment', exact: true }).click();
  const recovery = await target();
  count = await expectNewWrites(count, [[0x05, ...u16(recovery)]], 'segment skip');
  await page.waitForTimeout(1200);
  assert.equal((await writes()).length, count);
  check(`each block change writes exactly one new target (${work} W, then ${recovery} W)`);
  const cue = await page.locator('.cockpit-cue strong').innerText();
  assert.doesNotMatch(cue, /^(Øk|Senk)/, 'ERG cockpit must not instruct the rider to change power');
  check(`cockpit shows the ERG pill and a non-nagging cue ("${cue}")`);
  await page.screenshot({ path: resolve(artifacts, 'cockpit-erg.png') });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  count = await expectNewWrites(count, [[0x08, 0x02]], 'pause');
  await page.getByRole('button', { name: 'Fortsett økten', exact: true }).click();
  count = await expectNewWrites(count, [[0x07], [0x05, ...u16(recovery)]], 'resume');
  check('pause sends Stop/Pause(pause); resume sends Start/Resume and re-sends the target');

  await page.evaluate(() => window.__ergMock.drop());
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === 'paused');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).bluetooth === 'connected', null, { timeout: 10000 });
  await page.locator('.erg-pill').waitFor({ state: 'detached' });
  await page.waitForTimeout(1500);
  assert.equal((await writes()).length, count, 'ERG must stay off after an automatic reconnect until the rider resumes');
  check('disconnect pauses the ride; automatic reconnect does not re-engage ERG on its own');
  await page.getByRole('button', { name: 'Fortsett økten', exact: true }).click();
  count = await expectNewWrites(count, [[0x00], [0x07], [0x05, ...u16(recovery)]], 'resume after reconnect');
  check('resuming after reconnect re-requests control before setting the target');

  await page.locator('.sensor-chip').click();
  await page.locator('.erg-toggle label').click();
  count = await expectNewWrites(count, [[0x01]], 'ERG off mid-ride');
  assert.equal(await page.evaluate(() => localStorage.getItem('summit-erg:erg-smoke-trainer')), 'off');
  await page.locator('.erg-toggle label').click();
  count = await expectNewWrites(count, [[0x00], [0x07], [0x05, ...u16(recovery)]], 'ERG on mid-ride');
  await page.getByRole('button', { name: 'Lukk', exact: true }).click();
  check('switching ERG off mid-ride only resets (no Stop); switching it back on re-engages');

  await page.getByRole('button', { name: 'Avslutt økt', exact: true }).click();
  count = await expectNewWrites(count, [[0x08, 0x02]], 'end dialog pauses');
  await page.getByRole('button', { name: 'Lagre og avslutt', exact: true }).click();
  count = await expectNewWrites(count, [[0x08, 0x01], [0x01]], 'ride end');
  await page.locator('.ride-report').waitFor();
  await page.waitForTimeout(800);
  assert.equal((await writes()).length, count);
  check('ending the ride sends Stop then Reset and nothing afterwards');
  await page.locator('.report-close').click();

  // ---- Demo ride and ramp test never write ----
  await page.locator('.session-links').getByRole('button', { name: 'Ta en demotur', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).session?.elapsed >= 2);
  assert.equal((await state()).session.demo, true);
  assert.equal(await page.locator('.erg-pill').count(), 0);
  await page.getByRole('button', { name: 'Avslutt økt', exact: true }).click();
  await page.getByRole('button', { name: 'Lagre og avslutt', exact: true }).click();
  await page.locator('.ride-report').waitFor();
  await page.locator('.report-close').click();
  assert.equal((await writes()).length, count, 'Demo rides must never control the trainer');
  check('demo ride with ERG enabled writes nothing and shows no ERG pill');

  await page.getByRole('button', { name: 'Start FTP-test', exact: true }).first().click();
  await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).session; return s?.ramp && s.elapsed >= 2; });
  assert.equal((await state()).session.demo, false);
  assert.equal(await page.locator('.erg-pill').count(), 0);
  await page.getByRole('button', { name: 'Avbryt test', exact: true }).click();
  await page.getByRole('button', { name: 'Lagre og avslutt', exact: true }).click();
  await page.locator('.ride-report').waitFor();
  await page.locator('.report-close').click();
  assert.equal((await writes()).length, count, 'Ramp tests must never control the trainer');
  check('real FTP ramp test with ERG enabled writes nothing and shows no ERG pill');

  // ---- Test sykkelen din ----
  await page.locator('.session-links').getByRole('button', { name: 'Test sykkelen din', exact: true }).click();
  await page.getByRole('heading', { name: /Fungerer sykkelen/ }).waitFor();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).bluetooth === 'disconnected');
  check('home link opens the device check and hands the bike over from the app connection');
  await page.getByRole('button', { name: 'Velg enhet', exact: true }).click();
  await page.locator('.dc-verdict').waitFor();
  const services = await page.locator('.dc-services').innerText();
  assert.match(services, /Fitness Machine \(FTMS\)[\s\S]*Indoor Bike Data[\s\S]*Control Point[\s\S]*støttes/);
  assert.match(services, /Device Information/);
  assert.match(services, /wattmål \(ERG\) ja/);
  assert.match(await page.locator('.dc-device').innerText(), /Simulert AS · ERG-1 · fastvare 1\.0\.0/);
  await page.waitForFunction(() => document.querySelector('.dc-live b')?.textContent === '120');
  assert.equal(await page.locator('.dc-verdict h2').innerText(), 'Fungerer fullt');
  assert.match(await page.locator('.dc-verdict').innerText(), /Kjør ERG-testen/);
  check('device check lists FTMS characteristics and device information, shows live watt and a preliminary verdict');

  const before = (await writes()).length;
  await page.getByRole('button', { name: 'Start ERG-test (20 s)', exact: true }).click();
  await page.locator('.dc-erg-running').waitFor();
  await page.screenshot({ path: resolve(artifacts, 'device-check-erg-running.png') });
  await page.getByRole('button', { name: 'Kjør ERG-testen igjen', exact: true }).waitFor({ timeout: 30000 });
  const testWrites = (await waitForWrites(before + 6)).slice(before);
  assert.deepEqual(hex(testWrites), hex([[0x00], [0x07], [0x05, ...u16(100)], [0x05, ...u16(150)], [0x08, 0x01], [0x01]]));
  const result = await page.locator('.dc-erg-result').innerText();
  assert.match(result, /100 W godtatt · målt 100 W/);
  assert.match(result, /150 W godtatt · målt 150 W/);
  assert.match(await page.locator('.dc-verdict').innerText(), /godtok automatisk motstand/);
  check('ERG test writes control, start, 100 W, 150 W, stop, reset and confirms the measured power');

  await page.getByRole('button', { name: 'Kopier rapport', exact: true }).click();
  await page.getByText('Rapporten er kopiert.').waitFor();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /^SUMMIT – sykkeltest/);
  assert.match(report, /Enhet: SUMMIT simulert smarttrener/);
  assert.match(report, /Konklusjon: Fungerer fullt/);
  assert.match(report, /ERG-test: bestått · 100 W godtatt \(målt 100 W\) · 150 W godtatt \(målt 150 W\)/);
  assert.doesNotMatch(report, /erg-smoke-trainer/, 'Report must not contain the device identifier');
  check('Kopier rapport copies a plain-text report without identifiers');
  await page.screenshot({ path: resolve(artifacts, 'device-check-full.png'), fullPage: true });

  const beforeStop = (await writes()).length;
  await page.getByRole('button', { name: 'Kjør ERG-testen igjen', exact: true }).click();
  await page.locator('.dc-erg-running').waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stopp testen', exact: true }).click();
  await page.getByText(/Testen ble stoppet/).waitFor();
  assert.deepEqual(hex((await waitForWrites(beforeStop + 5)).slice(beforeStop)), hex([[0x00], [0x07], [0x05, ...u16(100)], [0x08, 0x01], [0x01]]));
  check('Stopp testen immediately stops and releases the trainer');

  await page.getByRole('button', { name: 'Koble fra', exact: true }).click();
  await page.getByRole('button', { name: 'Velg enhet', exact: true }).waitFor();
  await page.evaluate(() => { window.__ergMock.checkDevice = 'tacx'; });
  await page.getByRole('button', { name: 'Velg enhet', exact: true }).click();
  await page.locator('.dc-services li.proprietary').waitFor();
  assert.match(await page.locator('.dc-services').innerText(), /Tacx FE-C over Bluetooth[\s\S]*kjent, ikke støttet ennå/);
  assert.match(await page.locator('.dc-services').innerText(), /Cycling Speed and Cadence[\s\S]*støttes/);
  assert.equal(await page.locator('.dc-verdict h2').innerText(), 'Ikke støttet');
  assert.match(await page.locator('.dc-verdict').innerText(), /Tacx FE-C over Bluetooth ble funnet – kjent, men ikke støttet ennå/);
  await page.waitForFunction(() => document.querySelectorAll('.dc-live b')[1]?.textContent === '90');
  assert.equal(await page.getByRole('button', { name: /ERG-test/ }).count(), 0);
  check('a Tacx FE-C-only trainer is reported as known but unsupported, with CSC cadence shown');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Device check must not scroll horizontally at 390 px');
  await page.screenshot({ path: resolve(artifacts, 'device-check-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  check('device check fits a 390 px phone without horizontal scrolling');

  await page.getByRole('button', { name: 'Tilbake', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).bluetooth === 'connected', null, { timeout: 8000 });
  assert.equal((await state()).page, 'home');
  check('leaving the device check reconnects the remembered bike silently');

  // ---- Browsers without Web Bluetooth ----
  for (const [label, options, pattern] of [
    ['iPhone', { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, /Bluefy/],
    ['desktop', { viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' }, /Chrome eller Edge/],
  ]) {
    const plain = await browser.newContext(options);
    await plain.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: undefined }));
    await plain.route('**/src/WorldScene.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export default function S() { return null; }' }));
    const other = await plain.newPage();
    other.on('pageerror', error => pageErrors.push(error.message));
    await other.goto(appBase, { waitUntil: 'networkidle' });
    await other.locator('.session-links').getByRole('button', { name: 'Test sykkelen din', exact: true }).click();
    await other.locator('.dc-unsupported').waitFor();
    assert.match(await other.locator('.dc-unsupported').innerText(), pattern);
    if (label === 'iPhone') await other.screenshot({ path: resolve(artifacts, 'device-check-iphone.png'), fullPage: true });
    await plain.close();
    check(`${label} without Web Bluetooth gets ${pattern.source} guidance`);
  }

  assert.deepEqual(pageErrors, []);
  check('no browser exceptions or requests to the user runtime');
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ ok: true, checks, writes: hex(await writes()), pageErrors }, null, 2));
  console.log(`ERG smoke completed: ${checks.length} checks. Artifacts: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(resolve(artifacts, 'failure-state.json'), JSON.stringify({
      state: await state().catch(() => null), writes: await writes().then(hex).catch(() => null),
      text: await page.locator('body').innerText().catch(() => ''), pageErrors, checks,
    }, null, 2));
  }
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await backend?.close();
  await rm(temporary, { recursive: true, force: true });
}
