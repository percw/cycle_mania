import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AntBridge } from './ant.mjs';
import { createWorkoutStore } from './custom-workouts.mjs';
import { validateCustomRideMetadata } from './custom-ride.mjs';
import { validateRampTestMetadata } from './ramp-test.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_BODY = 24 * 1024 * 1024;
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
function validateRide(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Økten må være et objekt.');
  if (!text(value.id, 128) || !/^[a-zA-Z0-9_-]+$/.test(value.id)) throw new RequestError('Ugyldig økt-ID.');
  if (!text(value.name, 200) || !date(value.date)) throw new RequestError('Økten mangler gyldig navn eller dato.');
  for (const [key, max] of [['seconds', 172800], ['distance', 10000], ['avgPower', 5000], ['energy', 1000000]]) {
    if (!finite(value[key], 0, max)) throw new RequestError(`Ugyldig verdi: ${key}.`);
  }
  if (!finite(value.ftp, 50, 600) || typeof value.demo !== 'boolean' || typeof value.completed !== 'boolean') throw new RequestError('Ugyldig FTP eller øktstatus.');
  if (!Array.isArray(value.zoneSeconds) || value.zoneSeconds.length !== 7 || !value.zoneSeconds.every(n => finite(n, 0, value.seconds + 1))) throw new RequestError('Sonefordeling må ha syv gyldige tider.');
  if (value.zoneSeconds.reduce((a, b) => a + b, 0) > value.seconds + 2) throw new RequestError('Sonefordeling overskrider øktens varighet.');
  const result = Object.fromEntries(['id', 'name', 'date', 'seconds', 'distance', 'avgPower', 'energy', 'zoneSeconds', 'completed', 'demo', 'ftp'].map(key => [key, value[key]]));
  if (value.startedAt !== undefined) { if (!date(value.startedAt)) throw new RequestError('Ugyldig starttid.'); result.startedAt = value.startedAt; }
  if (value.workoutId !== undefined) { if (!text(value.workoutId, 128)) throw new RequestError('Ugyldig treningsøkt-ID.'); result.workoutId = value.workoutId; }
  if (value.distanceMeasured !== undefined) { if (typeof value.distanceMeasured !== 'boolean') throw new RequestError('Ugyldig distansekilde.'); result.distanceMeasured = value.distanceMeasured; }
  if (value.skippedSeconds !== undefined) { if (!finite(value.skippedSeconds, 0, 172800)) throw new RequestError('Ugyldig hoppet over-tid.'); result.skippedSeconds = value.skippedSeconds; }
  if (value.worldId !== undefined) {
    if (!['tron', 'neon', 'sky', 'vestland', 'fjord', 'alpine', 'midnight'].includes(value.worldId)) throw new RequestError('Ugyldig verden.');
    result.worldId = value.worldId;
  }
  if (value.game !== undefined) {
    const game = value.game;
    if (!game || typeof game !== 'object' || Array.isArray(game)) throw new RequestError('Ugyldig spillresultat.');
    // Counts remain bounded for the same maximum two-day ride accepted above.
    for (const [key, max] of [['score', 10000000], ['stars', 518400], ['pulses', 14401], ['bestCombo', 4], ['masteredBlocks', 172800]]) {
      if (!finite(game[key], 0, max) || !Number.isInteger(game[key])) throw new RequestError(`Ugyldig spillverdi: ${key}.`);
    }
    if (!finite(game.observed, 0, value.seconds + 1) || !finite(game.onTarget, 0, game.observed)) throw new RequestError('Ugyldig tid på måleffekt.');
    if (!Array.isArray(game.checkpoints) || game.checkpoints.length > 20000) throw new RequestError('Ugyldig antall spillmålinger.');
    let previousSecond = -1;
    let previousScore = -1;
    const checkpoints = game.checkpoints.map(point => {
      if (!point || typeof point !== 'object' || Array.isArray(point) || !finite(point.second, 0, value.seconds + 1)
        || point.second < previousSecond || !finite(point.score, 0, game.score) || !Number.isInteger(point.score)
        || point.score < previousScore) throw new RequestError('Ugyldige eller usorterte spillmålinger.');
      previousSecond = point.second;
      previousScore = point.score;
      return { second: point.second, score: point.score };
    });
    result.game = Object.fromEntries(['score', 'stars', 'pulses', 'bestCombo', 'onTarget', 'observed', 'masteredBlocks'].map(key => [key, game[key]]));
    result.game.checkpoints = checkpoints;
  }
  if (value.expedition !== undefined) {
    const expedition = value.expedition;
    if (!expedition || typeof expedition !== 'object' || Array.isArray(expedition) || expedition.version !== 1) throw new RequestError('Ugyldig ekspedisjon.');
    // At most 5760 thirty-second missions fit into the existing two-day limit.
    for (const key of ['restored', 'discovered', 'completed']) {
      if (!finite(expedition[key], 0, 5760) || !Number.isInteger(expedition[key])) throw new RequestError(`Ugyldig ekspedisjonsverdi: ${key}.`);
    }
    if (expedition.completed !== expedition.restored + expedition.discovered
      || expedition.restored * 30 + expedition.discovered * 40 > value.seconds + 1) throw new RequestError('Ekspedisjonen overskrider syklet tid.');
    if (!Array.isArray(expedition.discoveries) || expedition.discoveries.length !== expedition.discovered
      || !expedition.discoveries.every(name => text(name, 128))) throw new RequestError('Ugyldige ekspedisjonsfunn.');
    if (!Array.isArray(expedition.choices) || expedition.choices.length < Math.max(1, expedition.completed)
      || expedition.choices.length > expedition.completed + 1 || expedition.choices.length > 5761) throw new RequestError('Ugyldige veivalg.');
    let previousChoice;
    let restored = 0;
    const choices = expedition.choices.map((choice, index) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice) || choice.stage !== index + 1
        || !['restore', 'explore'].includes(choice.route) || !finite(choice.second, 0, value.seconds + 1)
        || (index === 0 && choice.second !== 0)
        || (previousChoice && choice.second + 1e-6 < previousChoice.second + (previousChoice.route === 'restore' ? 30 : 40))) throw new RequestError('Ugyldige eller usorterte veivalg.');
      previousChoice = choice;
      if (index < expedition.completed && choice.route === 'restore') restored++;
      if (index < expedition.completed && choice.second + (choice.route === 'restore' ? 30 : 40) > value.seconds + 1) throw new RequestError('Veivalget overskrider syklet tid.');
      return { stage: choice.stage, route: choice.route, second: choice.second };
    });
    if (restored !== expedition.restored) throw new RequestError('Veivalg stemmer ikke med resultatet.');
    result.expedition = { version: 1, restored: expedition.restored, discovered: expedition.discovered,
      completed: expedition.completed, discoveries: [...expedition.discoveries], choices };
  }
  if (value.timerEvents !== undefined) {
    if (!Array.isArray(value.timerEvents) || value.timerEvents.length > 172800) throw new RequestError('Ugyldig antall timerhendelser.');
    let previousWallSecond = -1;
    result.timerEvents = value.timerEvents.map(event => {
      if (!event || !finite(event.wallSecond, 0, 172800) || event.wallSecond < previousWallSecond || !['start', 'stop'].includes(event.type)) throw new RequestError('Ugyldige eller usorterte timerhendelser.');
      previousWallSecond = event.wallSecond;
      return { wallSecond: event.wallSecond, type: event.type };
    });
  }
  if (value.samples !== undefined) {
    if (!Array.isArray(value.samples) || value.samples.length > 172800) throw new RequestError('For mange målinger.');
    let previous = -1;
    let previousWorkoutSecond = -1;
    result.samples = value.samples.map(sample => {
      if (!sample || !finite(sample.second, 0, value.seconds + 1) || sample.second <= previous || !finite(sample.power, 0, 5000)) throw new RequestError('Ugyldige eller usorterte effektmålinger.');
      previous = sample.second;
      for (const [key, max] of [['cadence', 254], ['heartRate', 254]]) if (sample[key] !== null && sample[key] !== undefined && !finite(sample[key], 0, max)) throw new RequestError(`Ugyldig ${key}.`);
      const cleaned = { second: sample.second, power: sample.power, cadence: sample.cadence ?? null, heartRate: sample.heartRate ?? null };
      for (const [key, max] of [['targetPower', 5000], ['wallSecond', 172800], ['speed', 200], ['distance', 10000]]) {
        if (sample[key] !== undefined) { if (!finite(sample[key], 0, max)) throw new RequestError(`Ugyldig måling: ${key}.`); cleaned[key] = sample[key]; }
      }
      if (sample.workoutSecond !== undefined) {
        if (!finite(sample.workoutSecond, sample.second, value.seconds + (value.skippedSeconds || 0) + 1) || sample.workoutSecond <= previousWorkoutSecond) throw new RequestError('Ugyldig posisjon i øktplanen.');
        previousWorkoutSecond = sample.workoutSecond;
        cleaned.workoutSecond = sample.workoutSecond;
      }
      if (sample.measured !== undefined) { if (typeof sample.measured !== 'boolean') throw new RequestError('Ugyldig målekilde.'); cleaned.measured = sample.measured; }
      return cleaned;
    });
  }
  validateRampTestMetadata(value, result);
  return validateCustomRideMetadata(value, result);
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new RequestError('Bruk application/json.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RequestError('Økten er for stor.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError('Ugyldig JSON.'); }
}
export function createLocalServer({ dbPath = process.env.SUMMIT_DB || resolve(projectDir, 'data/summit.sqlite'), antBridge = new AntBridge(), distDir = resolve(projectDir, 'dist') } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rides (id TEXT PRIMARY KEY, date TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), ftp REAL NOT NULL, updated_at TEXT NOT NULL);');
  const workoutStore = createWorkoutStore(db);
  const allRides = db.prepare('SELECT data FROM rides ORDER BY date DESC, id DESC');
  const oneRide = db.prepare('SELECT data FROM rides WHERE id=?');
  const putRide = db.prepare('INSERT INTO rides(id,date,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,data=excluded.data');
  const deleteRide = db.prepare('DELETE FROM rides WHERE id=?');
  const readProfile = () => { const row = db.prepare('SELECT ftp, updated_at AS updatedAt FROM profile WHERE id=1').get(); return row || { ftp: 250, updatedAt: null }; };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const requestURL = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (!loopback.has(requestURL.hostname)) throw new RequestError('Kun lokale forespørsler er tillatt.', 403);
      const origin = req.headers.origin;
      if (origin) {
        let allowed = false;
        try { const parsed = new URL(origin); allowed = loopback.has(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol); } catch { /* invalid Origin */ }
        if (!allowed) throw new RequestError('Denne opprinnelsen er ikke tillatt.', 403);
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const path = requestURL.pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, storage: 'sqlite', rides: db.prepare('SELECT COUNT(*) AS total FROM rides').get().total });
      if (req.method === 'GET' && path === '/api/workouts') return json(res, 200, workoutStore.list());
      if (req.method === 'POST' && path === '/api/workouts') return json(res, 200, workoutStore.save(await readJson(req)));
      const workoutMatch = path.match(/^\/api\/workouts\/([a-zA-Z0-9_-]{1,80})$/);
      if (req.method === 'DELETE' && workoutMatch) {
        return json(res, 200, { ok: true, deleted: workoutStore.remove(workoutMatch[1]) });
      }
      if (req.method === 'GET' && path === '/api/rides') return json(res, 200, allRides.all().map(row => JSON.parse(row.data)));
      if (req.method === 'POST' && path === '/api/rides') {
        const ride = validateRide(await readJson(req));
        putRide.run(ride.id, new Date(ride.date).toISOString(), JSON.stringify(ride));
        return json(res, 200, ride);
      }
      // Idempotent: deleting an unknown ride is not an error, so queued deletes can be replayed.
      const rideMatch = path.match(/^\/api\/rides\/([a-zA-Z0-9_-]{1,128})$/);
      if (req.method === 'DELETE' && rideMatch) return json(res, 200, { ok: true, deleted: deleteRide.run(rideMatch[1]).changes > 0 });
      const fitMatch = path.match(/^\/api\/rides\/([a-zA-Z0-9_-]{1,128})\/fit$/);
      if (req.method === 'GET' && fitMatch) {
        const row = oneRide.get(fitMatch[1]);
        if (!row) throw new RequestError('Økten finnes ikke.', 404);
        const { encodeFit } = await import('./fit.mjs');
        const ride = JSON.parse(row.data);
        if (ride.demo || !ride.samples?.length) throw new RequestError('FIT-eksport krever en ekte økt med registrerte målinger. Demoturer kan ikke eksporteres som aktivitet.', 422);
        let encoded;
        try { encoded = encodeFit(ride); } catch (error) { throw new RequestError(error.message || 'Økten kunne ikke eksporteres til FIT.', 422); }
        res.writeHead(200, { 'Content-Type': 'application/vnd.ant.fit', 'Content-Disposition': `attachment; filename="summit-${fitMatch[1]}.fit"`, 'Content-Length': encoded.length, 'Cache-Control': 'no-store' });
        res.end(Buffer.from(encoded));
        return;
      }
      if (req.method === 'GET' && path === '/api/profile') return json(res, 200, readProfile());
      if (req.method === 'PUT' && path === '/api/profile') {
        const profile = await readJson(req);
        if (!profile || !finite(profile.ftp, 50, 600)) throw new RequestError('FTP må være mellom 50 og 600 watt.');
        db.prepare('INSERT INTO profile(id,ftp,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET ftp=excluded.ftp,updated_at=excluded.updated_at').run(profile.ftp, new Date().toISOString());
        return json(res, 200, readProfile());
      }
      if (req.method === 'GET' && path === '/api/ant/status') return json(res, 200, antBridge.getStatus());
      if (req.method === 'POST' && path === '/api/ant/connect') {
        const options = await readJson(req);
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new RequestError('Ugyldige ANT+-valg.');
        for (const key of ['bikeId', 'heartRateId']) if (options[key] != null && (!Number.isInteger(options[key]) || !finite(options[key], 1, 65535))) throw new RequestError('ANT+ ID må være mellom 1 og 65535.');
        return json(res, 200, await antBridge.connect({ bikeId: options.bikeId ?? 47963, heartRateId: options.heartRateId ?? null }));
      }
      if (req.method === 'POST' && path === '/api/ant/disconnect') { await readJson(req); return json(res, 200, antBridge.disconnect()); }
      if (path.startsWith('/api/')) throw new RequestError('Ukjent API-endepunkt.', 404);
      if (req.method === 'GET' && existsSync(distDir)) {
        const relative = decodeURIComponent(path).replace(/^\/+/, '');
        const candidate = resolve(distDir, relative || 'index.html');
        if (!candidate.startsWith(resolve(distDir) + sep)) throw new RequestError('Ugyldig filsti.', 403);
        const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(distDir, 'index.html');
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }
      throw new RequestError('Bygg appen eller start Vite for å åpne SUMMIT.', 404);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Lokal serverfeil. Se terminalen for detaljer.' });
      else res.destroy();
      if (!error.status) console.error('[SUMMIT]', error);
    }
  });
  let closed = false;
  const close = () => new Promise((resolveClose, reject) => {
    if (closed) return resolveClose();
    closed = true;
    antBridge.disconnect();
    server.close(error => { db.close(); if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolveClose(); });
    server.closeIdleConnections();
  });
  return { server, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createLocalServer();
  const port = Number(process.env.PORT || 3001);
  app.server.listen(port, '127.0.0.1', () => console.log(`SUMMIT lokal server: http://127.0.0.1:${port} · SQLite: ${process.env.SUMMIT_DB || 'data/summit.sqlite'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
