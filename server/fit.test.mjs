import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeFit } from './fit.mjs';

const ride = {
  id: 'fit-test', name: '3 × 10 min', date: '2026-09-30T12:01:00Z', seconds: 60,
  distance: 0.5, avgPower: 250, energy: 15, zoneSeconds: [0, 0, 0, 60, 0, 0, 0],
  completed: false, demo: false, ftp: 240,
  samples: Array.from({ length: 60 }, (_, index) => ({ second: index + 1, power: 250, cadence: 90, heartRate: index > 29 ? 140 : null })),
};

function decode(bytes) {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const result = decoder.read();
  expect(result.errors).toEqual([]);
  return result.messages;
}

// Separate bitwise CRC implementation, independent of Garmin's encoder.
function crc(bytes) {
  let value = 0;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xa001 : value >>> 1;
  }
  return value;
}

describe('FIT activity encoding', () => {
  it('exports binary FIT with correct header length, size and independent CRC checks', () => {
    const bytes = encodeFit(ride);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('.FIT');
    expect(bytes[0]).toBe(14);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(bytes.length - 16);
    expect(crc(bytes.slice(0, 14))).toBe(0);
    expect(crc(bytes)).toBe(0);
  });
  it('round-trips all required message types and actual sensor fields through Garmin decoder', () => {
    const messages = decode(encodeFit(ride));
    expect(messages.fileIdMesgs[0].type).toBe('activity');
    expect(messages.recordMesgs).toHaveLength(60);
    expect(messages.recordMesgs[0]).toMatchObject({ power: 250, cadence: 90 });
    expect(messages.recordMesgs[0].heartRate).toBeUndefined();
    expect(messages.recordMesgs[59].heartRate).toBe(140);
    expect(messages.recordMesgs[0].timestamp.toISOString()).toBe('2026-09-30T12:00:01.000Z');
    expect(messages.recordMesgs[59].timestamp.toISOString()).toBe(ride.date.replace('Z', '.000Z'));
    expect(messages.sessionMesgs[0]).toMatchObject({ sport: 'cycling', subSport: 'indoorCycling', totalTimerTime: 60, avgPower: 250, totalWork: 15000, numLaps: 1, thresholdPower: 240 });
    expect(messages.lapMesgs[0]).toMatchObject({ totalTimerTime: 60, avgPower: 250 });
    expect(messages.activityMesgs[0]).toMatchObject({ totalTimerTime: 60, numSessions: 1 });
    expect(messages.eventMesgs.map(event => event.eventType)).toEqual(['start', 'stopAll']);
  });
  it('omits virtual distance and all unavailable sensor data rather than inventing records', () => {
    const messages = decode(encodeFit({ ...ride, samples: [{ second: 20, power: 100, cadence: null, heartRate: null }] }));
    expect(messages.recordMesgs).toHaveLength(1);
    expect(messages.sessionMesgs[0].totalDistance).toBeUndefined();
    expect(messages.recordMesgs[0].cadence).toBeUndefined();
    expect(messages.recordMesgs[0].heartRate).toBeUndefined();
    expect(messages.recordMesgs[0].speed).toBeUndefined();
    expect(messages.recordMesgs[0].positionLat).toBeUndefined();
    expect(decode(encodeFit({ ...ride, distanceMeasured: true })).sessionMesgs[0].totalDistance).toBe(500);
  });
  it('rejects demo and legacy rides without observations', () => {
    expect(() => encodeFit({ ...ride, demo: true })).toThrow(/Demoturer/);
    expect(() => encodeFit({ ...ride, samples: [] })).toThrow(/wattmålinger/);
  });
  it('preserves measurement gaps and excludes explicitly unmeasured samples', () => {
    const samples = [{ second: 1, power: 100 }, { second: 2, power: 900, measured: false }, { second: 30, power: 200 }];
    const records = decode(encodeFit({ ...ride, samples })).recordMesgs;
    expect(records.map(record => record.power)).toEqual([100, 200]);
    expect((records[1].timestamp - records[0].timestamp) / 1000).toBe(29);
  });
  it('preserves wall-clock timestamps and timer events across a pause', () => {
    const messages = decode(encodeFit({
      ...ride, startedAt: '2026-09-30T12:00:00Z', date: '2026-09-30T12:01:30Z',
      timerEvents: [{ wallSecond: 0, type: 'start' }, { wallSecond: 30, type: 'stop' }, { wallSecond: 60, type: 'start' }],
      samples: [
        { second: 30, wallSecond: 30, power: 250 },
        { second: 31, wallSecond: 61, power: 250, measured: false },
        { second: 32, wallSecond: 62, power: 260 },
        { second: 60, wallSecond: 90, power: 250 },
      ],
    }));
    expect(messages.recordMesgs.map(record => record.timestamp.toISOString())).toEqual([
      '2026-09-30T12:00:30.000Z', '2026-09-30T12:01:02.000Z', '2026-09-30T12:01:30.000Z',
    ]);
    expect(messages.eventMesgs.map(event => event.eventType)).toEqual(['start', 'stop', 'start', 'stopAll']);
    expect(messages.eventMesgs.map(event => event.timestamp.toISOString())).toEqual([
      '2026-09-30T12:00:00.000Z', '2026-09-30T12:00:30.000Z', '2026-09-30T12:01:00.000Z', '2026-09-30T12:01:30.000Z',
    ]);
    expect(messages.sessionMesgs[0]).toMatchObject({ totalTimerTime: 60, totalElapsedTime: 90 });
  });
});
