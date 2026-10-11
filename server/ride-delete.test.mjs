import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createLocalServer } from './index.mjs';

const ride = id => ({ id, name: 'Slett meg', date: '2026-10-01T18:30:00.000Z', seconds: 2, distance: 0.01, avgPower: 200, energy: 0.4,
  zoneSeconds: [0, 0, 2, 0, 0, 0, 0], completed: true, demo: false, ftp: 250, samples: [{ second: 1, power: 200, cadence: null, heartRate: null }] });
async function listen(app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return `http://127.0.0.1:${app.server.address().port}`;
}
const post = (base, body) => fetch(base + '/api/rides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('DELETE /api/rides/:id removes one ride permanently and is idempotent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'summit-delete-test-'));
  const dbPath = join(directory, 'rides.sqlite');
  let app = createLocalServer({ dbPath });
  try {
    let base = await listen(app);
    assert.equal((await post(base, ride('keep'))).status, 200);
    assert.equal((await post(base, ride('gone'))).status, 200);
    const deleted = await fetch(base + '/api/rides/gone', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, deleted: true });
    assert.deepEqual(await (await fetch(base + '/api/rides/gone', { method: 'DELETE' })).json(), { ok: true, deleted: false });
    assert.equal((await fetch(base + '/api/rides/gone/fit')).status, 404);
    await app.close();
    app = createLocalServer({ dbPath });
    base = await listen(app);
    assert.deepEqual((await (await fetch(base + '/api/rides')).json()).map(r => r.id), ['keep']);
    assert.equal((await (await fetch(base + '/api/health')).json()).rides, 1);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('ride deletion is limited to local origins and valid IDs', async () => {
  const app = createLocalServer({ dbPath: ':memory:' });
  const base = await listen(app);
  try {
    await post(base, ride('protected'));
    assert.equal((await fetch(base + '/api/rides/protected', { method: 'DELETE', headers: { Origin: 'https://foreign.example' } })).status, 403);
    const preflight = await fetch(base + '/api/rides/protected', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5186', 'Access-Control-Request-Method': 'DELETE' } });
    assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
    assert.equal((await fetch(base + '/api/rides/bad%20id', { method: 'DELETE' })).status, 404);
    assert.deepEqual((await (await fetch(base + '/api/rides')).json()).map(r => r.id), ['protected']);
  } finally { await app.close(); }
});
