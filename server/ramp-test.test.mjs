import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';
import { validateRampTestMetadata } from './ramp-test.mjs';
import { createLocalServer } from './index.mjs';

function fixture() {
  return {
    id: 'ramp-roundtrip', name: 'FTP rampetest', workoutId: 'ramp-v1-100-20',
    date: '2026-10-05T10:13:00.000Z', startedAt: '2026-10-05T10:00:00.000Z',
    seconds: 780, distance: 4.2, avgPower: 160, energy: 124.8,
    zoneSeconds: [300, 180, 120, 120, 60, 0, 0], completed: true, demo: false, ftp: 250,
    rampTest: {
      version: 1,
      protocol: { version: 1, startWatts: 100, stepWatts: 20, stageSeconds: 60, warmupSeconds: 300, cooldownSeconds: 180, maxStages: 40 },
      referenceFtp: 250, endSecond: 600, reason: 'exhaustion', interrupted: false,
    },
    timerEvents: [{ wallSecond: 0, type: 'start' }],
    samples: Array.from({ length: 780 }, (_, index) => {
      const second = index + 1;
      const targetPower = second <= 300 || second > 600 ? 90 : 100 + 20 * Math.floor((second - 301) / 60);
      return { second, wallSecond: second, workoutSecond: second, targetPower, power: targetPower + index % 7 - 3,
        cadence: 85 + index % 5, heartRate: 120 + Math.floor(index / 30), measured: true };
    }),
  };
}

describe('ramp test metadata', () => {
  it('keeps the exact protocol and test endpoint without persisting a supplied FTP estimate', () => {
    const value = fixture();
    value.rampTest.estimatedFtp = 599;
    value.rampTest.protocol.untrusted = true;
    const result = validateRampTestMetadata(value, {});
    expect(result.rampTest).toEqual(fixture().rampTest);
    value.rampTest.protocol.startWatts = 200;
    expect(result.rampTest.protocol.startWatts).toBe(100);
  });

  it('leaves legacy and normal rides unchanged', () => {
    const result = { id: 'legacy' };
    expect(validateRampTestMetadata({}, result)).toBe(result);
    expect(result).toEqual({ id: 'legacy' });
  });

  it('accepts incomplete and interrupted attempts so they remain visible in history', () => {
    const value = fixture();
    value.seconds = 0;
    value.rampTest.endSecond = 0;
    value.rampTest.reason = 'aborted';
    value.rampTest.interrupted = true;
    expect(validateRampTestMetadata(value, {}).rampTest).toEqual(value.rampTest);
  });

  it('accepts the protocol boundaries and final ceiling stage', () => {
    for (const [startWatts, stepWatts] of [[25, 5], [250, 40]]) {
      const value = fixture();
      Object.assign(value.rampTest.protocol, { startWatts, stepWatts });
      value.workoutId = `ramp-v1-${startWatts}-${stepWatts}`;
      value.seconds = 2880;
      value.rampTest.endSecond = 2700;
      value.rampTest.reason = 'ceiling';
      expect(validateRampTestMetadata(value, {}).rampTest).toEqual(value.rampTest);
    }
  });

  it('rejects missing, malformed, nonfinite, mismatched or unsupported test metadata', () => {
    const changes = [
      value => { delete value.rampTest; },
      value => { value.rampTest = null; },
      value => { value.rampTest = []; },
      value => { value.rampTest.version = 2; },
      value => { value.rampTest.protocol = null; },
      value => { value.rampTest.protocol.version = 2; },
      value => { value.rampTest.protocol.startWatts = 24; },
      value => { value.rampTest.protocol.startWatts = 251; },
      value => { value.rampTest.protocol.startWatts = 100.5; },
      value => { value.rampTest.protocol.startWatts = NaN; },
      value => { value.rampTest.protocol.startWatts = '100'; },
      value => { value.rampTest.protocol.stepWatts = 4; },
      value => { value.rampTest.protocol.stepWatts = 41; },
      value => { value.rampTest.protocol.stepWatts = 5.5; },
      value => { value.rampTest.protocol.stageSeconds = 30; },
      value => { value.rampTest.protocol.warmupSeconds = 0; },
      value => { value.rampTest.protocol.cooldownSeconds = 999; },
      value => { value.rampTest.protocol.maxStages = 41; },
      value => { value.rampTest.referenceFtp = 251; },
      value => { value.rampTest.referenceFtp = value.ftp = 49; },
      value => { value.rampTest.referenceFtp = value.ftp = 601; },
      value => { value.rampTest.referenceFtp = Infinity; },
      value => { value.rampTest.endSecond = NaN; },
      value => { value.rampTest.endSecond = -1; },
      value => { value.rampTest.endSecond = 781; },
      value => { value.rampTest.endSecond = 599; value.seconds = 781; },
      value => { value.rampTest.endSecond = 2701; value.seconds = 2701; },
      value => { value.rampTest.reason = 'finished'; },
      value => { value.rampTest.reason = 'ceiling'; },
      value => { value.rampTest.interrupted = 1; },
      value => { value.workoutId = 'ramp-v1-100-25'; },
      value => { delete value.workoutId; },
      value => { value.workoutSnapshot = {}; },
      value => { value.blockSeconds = []; },
      value => { value.samples[0].blockIndex = 0; },
    ];
    for (const change of changes) {
      const value = fixture(); change(value);
      expect(() => validateRampTestMetadata(value, {})).toThrow();
      try { validateRampTestMetadata(value, {}); } catch (error) { expect(error.status).toBe(400); }
    }
  });
});

describe('ramp test local storage and FIT round trip', () => {
  it('retains repeat attempts, original timestamps, protocol and sensor samples after a server restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'summit-ramp-'));
    const dbPath = join(directory, 'test.sqlite');
    const antBridge = { disconnect() {}, getStatus() { return {}; } };
    let app;
    async function start() {
      app = createLocalServer({ dbPath, antBridge });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${app.server.address().port}`;
    }
    const post = (base, value) => fetch(`${base}/api/rides`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    try {
      let base = await start();
      const original = fixture();
      const second = fixture();
      second.id = 'ramp-repeat';
      second.date = '2026-10-06T10:13:00.000Z';
      second.startedAt = '2026-10-06T10:00:00.000Z';
      second.samples = second.samples.map(sample => ({ ...sample, power: sample.power + 10 }));
      for (const value of [original, second]) {
        const response = await post(base, value);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(value);
      }
      const invalid = fixture();
      invalid.id = 'invalid-ramp';
      invalid.rampTest.endSecond = 900;
      expect((await post(base, invalid)).status).toBe(400);
      await app.close();
      base = await start();
      const rides = await (await fetch(`${base}/api/rides`)).json();
      expect(rides).toEqual([second, original]);
      expect(await (await fetch(`${base}/api/profile`)).json()).toEqual({ ftp: 250, updatedAt: null });

      const response = await fetch(`${base}/api/rides/${original.id}/fit`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/vnd.ant.fit');
      const decoder = new Decoder(Stream.fromByteArray(new Uint8Array(await response.arrayBuffer())));
      expect(decoder.isFIT()).toBe(true);
      expect(decoder.checkIntegrity()).toBe(true);
      const decoded = decoder.read();
      expect(decoded.errors).toEqual([]);
      expect(decoded.messages.recordMesgs).toHaveLength(original.samples.length);
      decoded.messages.recordMesgs.forEach((record, index) => {
        const sample = original.samples[index];
        expect(record.power).toBe(sample.power);
        expect(record.cadence).toBe(sample.cadence);
        expect(record.heartRate).toBe(sample.heartRate);
        expect(record.timestamp.getTime()).toBe(Date.parse(original.startedAt) + sample.wallSecond * 1000);
      });
      expect(decoded.messages.sessionMesgs[0]).toMatchObject({ totalTimerTime: original.seconds, thresholdPower: original.ftp });
    } finally {
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
