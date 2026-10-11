import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeFit, fitFileName } from './fitExport';
import type { RideRecord } from './storage';

const ride: RideRecord = {
  id: 'fit-browser', name: '3 × 10 min', date: '2026-09-30T12:01:00Z', seconds: 60,
  distance: 0.5, avgPower: 250, energy: 15, zoneSeconds: [0, 0, 0, 60, 0, 0, 0],
  completed: false, demo: false, ftp: 240,
  samples: Array.from({ length: 60 }, (_, index) => ({ second: index + 1, power: 250, cadence: 90, heartRate: index > 29 ? 140 : null })),
};
function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const result = decoder.read();
  expect(result.errors).toEqual([]);
  return result.messages;
}

describe('FIT export in the browser', () => {
  it('round-trips an indoor cycling activity through the Garmin decoder', () => {
    const messages = decode(encodeFit(ride));
    expect(messages.fileIdMesgs?.[0].type).toBe('activity');
    expect(messages.recordMesgs).toHaveLength(60);
    expect(messages.recordMesgs?.[0]).toMatchObject({ power: 250, cadence: 90 });
    expect(messages.recordMesgs?.[0].heartRate).toBeUndefined();
    expect(messages.recordMesgs?.[59].heartRate).toBe(140);
    expect(new Date(messages.recordMesgs?.[0].timestamp as Date).toISOString()).toBe('2026-09-30T12:00:01.000Z');
    expect(messages.sessionMesgs?.[0]).toMatchObject({ sport: 'cycling', subSport: 'indoorCycling', totalTimerTime: 60, avgPower: 250, totalWork: 15000, numLaps: 1, thresholdPower: 240 });
    expect(messages.activityMesgs?.[0]).toMatchObject({ totalTimerTime: 60, numSessions: 1 });
    expect(messages.eventMesgs?.map(event => event.eventType)).toEqual(['start', 'stopAll']);
  });
  it('never invents GPS, speed, distance or missing sensor values', () => {
    const messages = decode(encodeFit({ ...ride, samples: [{ second: 20, power: 100, cadence: null, heartRate: null }] }));
    const record = messages.recordMesgs?.[0];
    expect(messages.recordMesgs).toHaveLength(1);
    expect(record?.cadence).toBeUndefined();
    expect(record?.heartRate).toBeUndefined();
    expect(record?.speed).toBeUndefined();
    expect(record?.distance).toBeUndefined();
    expect(record?.positionLat).toBeUndefined();
    expect(messages.sessionMesgs?.[0].totalDistance).toBeUndefined();
  });
  it('keeps data gaps as gaps and drops unmeasured samples', () => {
    const samples = [
      { second: 1, power: 100, cadence: null, heartRate: null },
      { second: 2, power: 900, cadence: null, heartRate: null, measured: false },
      { second: 30, power: 200, cadence: null, heartRate: null },
    ];
    const records = decode(encodeFit({ ...ride, samples })).recordMesgs ?? [];
    expect(records.map(record => record.power)).toEqual([100, 200]);
    expect((Number(records[1].timestamp as Date) - Number(records[0].timestamp as Date)) / 1000).toBe(29);
  });
  it('writes pauses as timer stop/start events on the wall clock', () => {
    const messages = decode(encodeFit({
      ...ride, startedAt: '2026-09-30T12:00:00Z', date: '2026-09-30T12:01:30Z',
      timerEvents: [{ wallSecond: 0, type: 'start' }, { wallSecond: 30, type: 'stop' }, { wallSecond: 60, type: 'start' }],
      samples: [
        { second: 30, wallSecond: 30, power: 250, cadence: 90, heartRate: null },
        { second: 32, wallSecond: 62, power: 260, cadence: 90, heartRate: null },
        { second: 60, wallSecond: 90, power: 250, cadence: 90, heartRate: null },
      ],
    }));
    expect(messages.eventMesgs?.map(event => event.eventType)).toEqual(['start', 'stop', 'start', 'stopAll']);
    expect(messages.sessionMesgs?.[0]).toMatchObject({ totalTimerTime: 60, totalElapsedTime: 90 });
  });
  it('refuses demo rides and rides without measured watts', () => {
    expect(() => encodeFit({ ...ride, demo: true })).toThrow(/Demoturer/);
    expect(() => encodeFit({ ...ride, samples: [] })).toThrow(/wattmålinger/);
    expect(() => encodeFit({ ...ride, samples: ride.samples?.map(sample => ({ ...sample, measured: false })) })).toThrow(/wattmålinger/);
    expect(fitFileName(ride)).toBe('summit-fit-browser.fit');
  });
});
