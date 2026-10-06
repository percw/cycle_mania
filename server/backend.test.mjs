import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createLocalServer } from './index.mjs';
import { AntBridge } from './ant.mjs';

const fixture = () => ({ id: 'test-ride', name: '4 × 4 min', date: '2026-09-30T18:30:00.000Z', startedAt: '2026-09-30T18:29:57.000Z', seconds: 3, distance: 0.021, distanceMeasured: false, avgPower: 251, energy: 0.753, zoneSeconds: [0, 0, 0, 3, 0, 0, 0], completed: false, demo: false, ftp: 250, skippedSeconds: 120, workoutId: 'vo2-4x4', samples: [{ second: 1, power: 250, cadence: 90, heartRate: 135, targetPower: 280 }, { second: 2, power: 252, cadence: 92, heartRate: 136, targetPower: 280 }, { second: 3, power: 251, cadence: null, heartRate: null, targetPower: 280 }] });
async function listen(app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return `http://127.0.0.1:${app.server.address().port}`;
}
const put = (base, path, body, method = 'POST', headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('SQLite survives server restart, stores samples/profile and upserts by ID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-db-test-'));
  const dbPath = join(directory, 'ride.sqlite');
  let app = createLocalServer({ dbPath });
  try {
    let base = await listen(app);
    assert.equal((await put(base, '/api/rides', fixture())).status, 200);
    assert.equal((await put(base, '/api/profile', { ftp: 275 }, 'PUT')).status, 200);
    await app.close();
    app = createLocalServer({ dbPath });
    base = await listen(app);
    const rides = await (await fetch(base + '/api/rides')).json();
    assert.deepEqual(rides, [fixture()]);
    assert.equal((await (await fetch(base + '/api/profile')).json()).ftp, 275);
    const edited = { ...fixture(), name: 'Oppdatert økt' };
    await put(base, '/api/rides', edited);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [edited]);
    assert.equal((await (await fetch(base + '/api/health')).json()).rides, 1);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rejects malformed data, foreign origins, DNS rebinding and form writes', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    assert.equal((await put(base, '/api/rides', { ...fixture(), samples: [{ second: 10, power: 250 }] })).status, 400);
    assert.equal((await put(base, '/api/rides', fixture(), 'POST', { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await put(base, '/api/profile', { ftp: 10000 }, 'PUT')).status, 400);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(base + '/api/health', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      request.end();
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(base + '/api/rides', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await put(base, '/api/rides', fixture(), 'POST', { Origin: 'http://localhost:5186' })).status, 200);
    assert.equal((await fetch(base + '/api/rides/missing/fit')).status, 404);
    assert.equal((await put(base, '/api/ant/connect', { bikeId: 70000 })).status, 400);
  } finally { await app.close(); }
});

test('preserves paused wall chronology and validates timer events', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    const ride = {
      ...fixture(),
      startedAt: '2026-09-30T18:29:47.000Z',
      timerEvents: [{ wallSecond: 0, type: 'start' }, { wallSecond: 1, type: 'stop' }, { wallSecond: 11, type: 'start' }, { wallSecond: 13, type: 'stop' }],
      samples: fixture().samples.map((sample, index) => ({ ...sample, wallSecond: [1, 12, 13][index] })),
    };
    assert.equal((await put(base, '/api/rides', ride)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    for (const timerEvents of [null, [{ wallSecond: -1, type: 'start' }], [{ wallSecond: 172801, type: 'stop' }], [{ wallSecond: 1, type: 'pause' }], [{ wallSecond: 2, type: 'stop' }, { wallSecond: 1, type: 'start' }]]) {
      assert.equal((await put(base, '/api/rides', { ...ride, timerEvents })).status, 400);
    }
    assert.equal((await put(base, '/api/rides', { ...ride, samples: [{ ...ride.samples[0], wallSecond: 172801 }] })).status, 400);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
  } finally { await app.close(); }
});

test('FIT endpoint returns a real downloadable FIT file', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    await put(base, '/api/rides', fixture());
    const response = await fetch(base + '/api/rides/test-ride/fit');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /\.fit/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('ascii', 8, 12), '.FIT');
    assert.ok(bytes.length > 100);
    const { Decoder, Stream } = await import('@garmin/fitsdk');
    const decoded = new Decoder(Stream.fromByteArray(bytes)).read();
    assert.equal(decoded.errors.length, 0);
    assert.equal(decoded.messages.recordMesgs.length, 3);
    assert.equal(decoded.messages.recordMesgs[0].power, 250);
  } finally { await app.close(); }
});

test('ANT scanner selects HR, filters bike IDs and expires stale telemetry', async () => {
  let now = 10000;
  const scanners = {};
  class Stick extends EventEmitter {
    is_present() { return true; }
    open() { queueMicrotask(() => this.emit('startup')); return true; }
    close() { this.emit('shutdown'); }
  }
  const makeScanner = name => class extends EventEmitter {
    constructor() { super(); scanners[name] = this; }
    scan() { queueMicrotask(() => this.emit('attached')); }
  };
  const bridge = new AntBridge({ now: () => now, loadDriver: async () => ({ GarminStick3: Stick, HeartRateScanner: makeScanner('hr'), BicyclePowerScanner: makeScanner('power'), FitnessEquipmentScanner: makeScanner('fitness') }) });
  await bridge.connect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bridge.getStatus().status, 'scanning');
  scanners.hr.emit('hbData', { DeviceID: 120, ComputedHeartRate: 140 });
  scanners.hr.emit('hbData', { DeviceID: 999, ComputedHeartRate: 190 });
  scanners.power.emit('powerData', { DeviceID: 111, Power: 500 });
  assert.equal(bridge.getStatus().heartRate, 140);
  assert.equal(bridge.getStatus().power, null);
  scanners.power.emit('powerData', { DeviceID: 47963, Power: 260, Cadence: 87 });
  assert.equal(bridge.getStatus().power, 260);
  now += 11000;
  scanners.hr.emit('hbData', { DeviceID: 120, ComputedHeartRate: 145 });
  assert.equal(bridge.getStatus().power, null);
  assert.equal(bridge.getStatus().heartRate, 145);
  bridge.disconnect();
  scanners.power.emit('powerData', { DeviceID: 47963, Power: 300 });
  assert.equal(bridge.getStatus().status, 'disconnected');
  assert.equal(bridge.getStatus().power, null);
});

test('missing ANT native driver is a recoverable status', async () => {
  const bridge = new AntBridge({ loadDriver: async () => { const error = new Error('absent'); error.code = 'ERR_MODULE_NOT_FOUND'; throw error; } });
  const state = await bridge.connect();
  assert.equal(state.status, 'error');
  assert.match(state.error, /valgfrie avhengigheten/);
  assert.equal(bridge.disconnect().status, 'disconnected');
});


const gameFixture = () => ({ score: 165, stars: 3, pulses: 1, bestCombo: 2, onTarget: 2.25, observed: 3, masteredBlocks: 1, checkpoints: [{ second: 1, score: 1 }, { second: 3, score: 165 }, { second: 3, score: 165 }] });

test('game and world persist across SQLite restart, including demo records and legacy rides', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-game-test-'));
  const dbPath = join(directory, 'ride.sqlite');
  let app = createLocalServer({ dbPath });
  try {
    let base = await listen(app);
    const legacy = { ...fixture(), id: 'legacy-ride' };
    const ride = { ...fixture(), worldId: 'neon', game: gameFixture() };
    const demo = { ...ride, id: 'demo-ride', demo: true, worldId: 'sky' };
    for (const record of [legacy, ride, demo]) {
      const response = await put(base, '/api/rides', record);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), record);
    }
    await app.close();
    app = createLocalServer({ dbPath });
    base = await listen(app);
    const records = await (await fetch(base + '/api/rides')).json();
    for (const record of [legacy, ride, demo]) assert.deepEqual(records.find(saved => saved.id === record.id), record);
    assert.equal(records.length, 3);
    // Updating ordinary ride metadata keeps the complete ghost timeline.
    const edited = { ...ride, name: 'Neon rekord' };
    const response = await put(base, '/api/rides', edited);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), edited);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Vestlandsveien preserves ride measurements across restart and FIT export', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-vestland-test-'));
  const dbPath = join(directory, 'ride.sqlite');
  let app = createLocalServer({ dbPath });
  const ride = { ...fixture(), worldId: 'vestland', game: gameFixture() };
  try {
    let base = await listen(app);
    assert.equal((await put(base, '/api/rides', ride)).status, 200);
    await app.close();
    app = createLocalServer({ dbPath });
    base = await listen(app);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    const response = await fetch(base + '/api/rides/test-ride/fit');
    assert.equal(response.status, 200);
    const { Decoder, Stream } = await import('@garmin/fitsdk');
    const decoded = new Decoder(Stream.fromByteArray(Buffer.from(await response.arrayBuffer()))).read();
    assert.deepEqual(decoded.errors, []);
    assert.deepEqual(decoded.messages.recordMesgs.map(s => s.power), [250, 252, 251]);
    assert.equal(decoded.messages.recordMesgs[0].heartRate, 135);
    assert.equal(decoded.messages.recordMesgs[0].cadence, 90);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rejects corrupt game fields and timelines without replacing the saved ride', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    const valid = { ...fixture(), worldId: 'fjord', game: gameFixture() };
    assert.equal((await put(base, '/api/rides', valid)).status, 200);
    const invalidGames = [null, [], 'game', {},
      ...['score', 'stars', 'pulses', 'bestCombo', 'masteredBlocks', 'observed', 'onTarget'].flatMap(key => [
        { ...gameFixture(), [key]: -1 }, { ...gameFixture(), [key]: '1' },
        { ...gameFixture(), [key]: null }, { ...gameFixture(), [key]: undefined },
      ]),
      ...['score', 'stars', 'pulses', 'bestCombo', 'masteredBlocks'].map(key => ({ ...gameFixture(), [key]: 1.5 })),
      { ...gameFixture(), score: 10000001 }, { ...gameFixture(), stars: 518401 },
      { ...gameFixture(), pulses: 14402 }, { ...gameFixture(), masteredBlocks: 172801 },
      { ...gameFixture(), bestCombo: 5 }, { ...gameFixture(), observed: 4.01 },
      { ...gameFixture(), onTarget: 3.01 }, { ...gameFixture(), checkpoints: null },
      { ...gameFixture(), checkpoints: Array.from({ length: 20001 }, () => ({ second: 1, score: 1 })) },
      ...[null, [], {}, { second: -1, score: 1 }, { second: 4.01, score: 1 },
        { second: 1, score: -1 }, { second: 1, score: 166 }, { second: 1, score: 1.5 },
        { second: '1', score: 1 }, { second: 1, score: '1' }].map(point => ({ ...gameFixture(), checkpoints: [point] })),
      { ...gameFixture(), checkpoints: [{ second: 2, score: 1 }, { second: 1, score: 2 }] },
      { ...gameFixture(), checkpoints: [{ second: 1, score: 2 }, { second: 2, score: 1 }] },
    ];
    for (const game of invalidGames) assert.equal((await put(base, '/api/rides', { ...valid, game })).status, 400, JSON.stringify(game).slice(0, 200));
    for (const worldId of [null, 'unknown', 1, [], {}]) assert.equal((await put(base, '/api/rides', { ...valid, worldId })).status, 400);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [valid]);
    for (const worldId of ['tron', 'neon', 'sky', 'vestland', 'fjord', 'alpine', 'midnight']) assert.equal((await put(base, '/api/rides', { ...valid, worldId })).status, 200);
  } finally { await app.close(); }
});

test('accepts zero-observation games, empty ghosts and fractional measurement time', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    const empty = { ...fixture(), game: { score: 0, stars: 0, pulses: 0, bestCombo: 0, onTarget: 0, observed: 0, masteredBlocks: 0, checkpoints: [] } };
    assert.equal((await put(base, '/api/rides', empty)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [empty]);
    const fractional = { ...fixture(), game: { ...gameFixture(), observed: 3.25, onTarget: 3.25, checkpoints: [{ second: 3.25, score: 165 }] } };
    assert.equal((await put(base, '/api/rides', fractional)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [fractional]);
  } finally { await app.close(); }
});

const expeditionFixture = () => ({ version: 1, restored: 1, discovered: 1, completed: 2,
  discoveries: ['Vindfrøet'], choices: [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'explore', second: 30 }] });

test('expedition results survive SQLite restart and preserve legacy rides', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-expedition-test-'));
  const dbPath = join(directory, 'ride.sqlite');
  let app = createLocalServer({ dbPath });
  try {
    let base = await listen(app);
    const ride = { ...fixture(), seconds: 70, worldId: 'sky', expedition: expeditionFixture() };
    const legacy = { ...fixture(), id: 'legacy' };
    for (const record of [ride, legacy]) {
      const response = await put(base, '/api/rides', record);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), record);
    }
    await app.close();
    app = createLocalServer({ dbPath });
    base = await listen(app);
    const records = await (await fetch(base + '/api/rides')).json();
    for (const record of [ride, legacy]) assert.deepEqual(records.find(saved => saved.id === record.id), record);
    const demo = { ...ride, demo: true };
    assert.equal((await put(base, '/api/rides', demo)).status, 200);
    const empty = { ...fixture(), expedition: { version: 1, restored: 0, discovered: 0, completed: 0, discoveries: [], choices: [{ stage: 1, route: 'restore', second: 0 }] } };
    assert.equal((await put(base, '/api/rides', empty)).status, 200);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rejects malformed expedition results and impossible route timelines without overwriting data', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    const valid = { ...fixture(), seconds: 70, worldId: 'sky', expedition: expeditionFixture() };
    assert.equal((await put(base, '/api/rides', valid)).status, 200);
    const invalid = [null, [], 'expedition', {},
      ...['restored', 'discovered', 'completed'].flatMap(key => [-1, 1.5, '1', null, undefined, 5761].map(value => ({ ...expeditionFixture(), [key]: value }))),
      { ...expeditionFixture(), version: 2 }, { ...expeditionFixture(), completed: 3 },
      { ...expeditionFixture(), discoveries: [] }, { ...expeditionFixture(), discoveries: [null] },
      { ...expeditionFixture(), discoveries: [''] }, { ...expeditionFixture(), discoveries: ['x'.repeat(129)] },
      ...[null, [], [null], [[], []], [{ stage: 1, route: 'restore', second: 0 }],
        [{ stage: 1, route: 'restore', second: 1 }, { stage: 2, route: 'explore', second: 30 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'explore', second: 29 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'explore', second: 32 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 3, route: 'explore', second: 30 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'restore', second: 30 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'unknown', second: 30 }],
        [{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'explore', second: null }],
      ].map(choices => ({ ...expeditionFixture(), choices })),
    ];
    for (const expedition of invalid) assert.equal((await put(base, '/api/rides', { ...valid, expedition })).status, 400, JSON.stringify(expedition).slice(0, 200));
    assert.equal((await put(base, '/api/rides', { ...valid, seconds: 60 })).status, 400);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [valid]);
    const twoDay = { ...fixture(), seconds: 172800, expedition: { version: 1, restored: 5760, discovered: 0, completed: 5760, discoveries: [],
      choices: Array.from({ length: 5760 }, (_, i) => ({ stage: i + 1, route: 'restore', second: i * 30 })) } };
    assert.equal((await put(base, '/api/rides', twoDay)).status, 200);
  } finally { await app.close(); }
});


test('Tron and skipped-plan sample positions persist and malformed chronology is rejected', async () => {
  const app = createLocalServer({dbPath: ':memory:'});
  const base = await listen(app);
  try {
    const ride = {...fixture(),worldId:'tron',samples:fixture().samples.map(s=>({...s,workoutSecond:s.second+120}))};
    assert.equal((await put(base,'/api/rides',ride)).status,200);
    assert.deepEqual(await (await fetch(base+'/api/rides')).json(),[ride]);
    for(const positions of [[0,122,123],[121,121,123],[121,122,200],[NaN,122,123]]) {
      assert.equal((await put(base,'/api/rides',{...ride,samples:ride.samples.map((s,i)=>({...s,workoutSecond:positions[i]}))})).status,400);
    }
  } finally {await app.close()}
});

const customDraft = () => ({ version: 1, id: 'interval-test', name: 'Egen 2 × 4 min', description: 'En lagret mal', warmup: null, cooldown: null,
  groups: [{ id: 'group-1', name: 'Hoveddel', sets: 1, reps: 2, work: { value: 4, unit: 'minutes', intensity: 1 }, recovery: { value: 500, unit: 'meters', intensity: 0.5 }, setRecovery: null }] });
const customRide = () => ({ ...fixture(), skippedSeconds: 0, workoutId: 'custom-interval-test-revision-a',
  workoutSnapshot: { id: 'custom-interval-test-revision-a', name: 'Egen 2 × 4 min', subtitle: '2 drag · Egen økt', category: 'Egne økter', description: 'En lagret mal', difficulty: 2, custom: true,
    blocks: [{ label: 'Drag 1', seconds: 240, intensity: 1, kind: 'work' }, { label: 'Pause', seconds: 60, distanceMeters: 500, intensity: 0.5, kind: 'recovery' }, { label: 'Drag 2', seconds: 240, intensity: 1, kind: 'work' }] },
  blockSeconds: [1, 1, 1], blockMeters: [7, 7, 7], skippedBlocks: [0, 1],
  samples: fixture().samples.map((sample, blockIndex) => ({ ...sample, blockIndex })),
});

test('custom template CRUD persists across restart and preserves saved ride snapshots after edits and deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-custom-api-'));
  const dbPath = join(directory, 'custom.sqlite');
  let app = createLocalServer({ dbPath });
  try {
    let base = await listen(app);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), []);
    const draft = customDraft(), ride = customRide();
    const saved = await put(base, '/api/workouts', draft);
    assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), draft);
    const response = await put(base, '/api/rides', ride);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), ride);
    await app.close(); app = createLocalServer({ dbPath }); base = await listen(app);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), [draft]);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    const edited = { ...draft, name: 'Endret økt', groups: draft.groups.map(group => ({ ...group, reps: 8 })) };
    assert.equal((await put(base, '/api/workouts', edited)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), [edited]);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    const preflight = await fetch(base + '/api/workouts/' + draft.id, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5186', 'Access-Control-Request-Method': 'DELETE' } });
    assert.equal(preflight.status, 204); assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
    const deleted = await fetch(base + '/api/workouts/' + draft.id, { method: 'DELETE' });
    assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { ok: true, deleted: true });
    const replayed = await fetch(base + '/api/workouts/' + draft.id, { method: 'DELETE' });
    assert.equal(replayed.status, 200); assert.deepEqual(await replayed.json(), { ok: true, deleted: false });
    await app.close(); app = createLocalServer({ dbPath }); base = await listen(app);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), []);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    const fit = await fetch(base + '/api/rides/' + ride.id + '/fit');
    assert.equal(fit.status, 200);
    const { Decoder, Stream } = await import('@garmin/fitsdk');
    const decoded = new Decoder(Stream.fromByteArray(Buffer.from(await fit.arrayBuffer()))).read();
    assert.equal(decoded.errors.length, 0); assert.equal(decoded.messages.recordMesgs.length, 3);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('custom APIs reject malformed templates and execution metadata without replacing saved data', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    const draft = customDraft(), ride = customRide();
    assert.equal((await put(base, '/api/workouts', draft)).status, 200);
    assert.equal((await put(base, '/api/rides', ride)).status, 200);
    for (const invalid of [null, {}, { ...draft, groups: [] }, { ...draft, groups: [{ ...draft.groups[0], reps: 101 }] }, { ...draft, id: '../bad' }]) {
      assert.equal((await put(base, '/api/workouts', invalid)).status, 400);
    }
    for (const invalid of [
      { ...ride, workoutSnapshot: undefined },
      { ...ride, workoutSnapshot: { ...ride.workoutSnapshot, id: 'different' } },
      { ...ride, blockSeconds: [3, 3, 3] },
      { ...ride, blockMeters: [7, 7] },
      { ...ride, skippedBlocks: [1, 1] },
      { ...ride, skippedBlocks: [3] },
      { ...ride, samples: ride.samples.map(sample => ({ ...sample, blockIndex: 5 })) },
      { ...ride, workoutSnapshot: { ...ride.workoutSnapshot, blocks: [{ ...ride.workoutSnapshot.blocks[0], distanceMeters: 0 }] } },
    ]) assert.equal((await put(base, '/api/rides', invalid)).status, 400);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), [draft]);
    assert.deepEqual(await (await fetch(base + '/api/rides')).json(), [ride]);
    assert.equal((await fetch(base + '/api/workouts/' + draft.id, { method: 'DELETE', headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.deepEqual(await (await fetch(base + '/api/workouts')).json(), [draft]);
  } finally { await app.close(); }
});

test('custom ride snapshots accept the same distance range as the builder', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    for (const distanceMeters of [1, 75000, 1440000]) {
      const ride = customRide();
      ride.workoutSnapshot.blocks = [{ label: 'Distanse', kind: 'work', intensity: 1, seconds: Math.max(1, Math.round(distanceMeters * 0.12)), distanceMeters }];
      ride.blockSeconds = [3]; ride.blockMeters = [21]; ride.skippedBlocks = [];
      ride.samples = ride.samples.map(sample => ({ ...sample, blockIndex: 0 }));
      const response = await put(base, '/api/rides', ride);
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).workoutSnapshot, ride.workoutSnapshot);
    }
  } finally { await app.close(); }
});
