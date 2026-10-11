import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeFit as encodeOnServer } from './fit.mjs';
import { encodeFit as encodeInBrowser } from '../src/fitExport.ts';

// The app encodes FIT in the browser; the local backend keeps its own
// endpoint. Both must produce the same file for the same ride.
const base = {
  id: 'parity-ride', name: 'Sweet spot 3 × 12', startedAt: '2026-10-01T17:00:00Z', date: '2026-10-01T17:02:10Z',
  seconds: 100, distance: 1.2, avgPower: 230, energy: 23, zoneSeconds: [0, 0, 20, 80, 0, 0, 0],
  completed: true, demo: false, ftp: 255, distanceMeasured: false,
  timerEvents: [{ wallSecond: 0, type: 'start' }, { wallSecond: 50, type: 'stop' }, { wallSecond: 80, type: 'start' }],
  samples: Array.from({ length: 100 }, (_, index) => ({
    second: index + 1, wallSecond: index < 50 ? index + 1 : index + 31, power: 180 + (index % 17) * 5,
    cadence: index % 9 === 0 ? null : 85 + (index % 5), heartRate: index < 10 ? null : 120 + (index % 20),
    measured: index !== 42, targetPower: 230,
  })),
};
const decode = bytes => new Decoder(Stream.fromByteArray(bytes)).read().messages;

describe('browser and server FIT encoders', () => {
  for (const [name, ride] of [
    ['ride with pause, gaps and partial sensors', base],
    ['ride without startedAt or timer events', { ...base, startedAt: undefined, timerEvents: undefined }],
    ['ride with measured distance', { ...base, distanceMeasured: true }],
  ]) {
    it(`produce identical bytes: ${name}`, () => {
      const server = encodeOnServer(ride);
      const browser = encodeInBrowser(ride);
      expect(browser.length).toBe(server.length);
      expect(Buffer.from(browser).equals(Buffer.from(server))).toBe(true);
    });
  }
  it('agree on key decoded fields', () => {
    const server = decode(encodeOnServer(base));
    const browser = decode(encodeInBrowser(base));
    expect(browser.recordMesgs).toHaveLength(99);
    expect(browser.recordMesgs.map(r => [r.timestamp.toISOString(), r.power, r.cadence, r.heartRate]))
      .toEqual(server.recordMesgs.map(r => [r.timestamp.toISOString(), r.power, r.cadence, r.heartRate]));
    for (const key of ['sport', 'subSport', 'totalTimerTime', 'totalElapsedTime', 'avgPower', 'maxPower', 'totalWork', 'avgHeartRate', 'avgCadence', 'thresholdPower']) {
      expect(browser.sessionMesgs[0][key]).toEqual(server.sessionMesgs[0][key]);
    }
    expect(browser.eventMesgs.map(e => e.eventType)).toEqual(server.eventMesgs.map(e => e.eventType));
  });
  it('share the demo and no-data rules', () => {
    expect(() => encodeInBrowser({ ...base, demo: true })).toThrow(/Demoturer/);
    expect(() => encodeOnServer({ ...base, demo: true })).toThrow(/Demoturer/);
    expect(() => encodeInBrowser({ ...base, samples: [] })).toThrow(/wattmålinger/);
  });
});
