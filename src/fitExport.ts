import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import type { RideRecord, RideSample } from './storage';

// Browser port of server/fit.mjs with identical rules and identical output
// (server/fit-parity.test.mjs compares the bytes). Garmin's encoder writes
// definitions, scaled fields, FIT epoch timestamps, header and both CRCs.
// https://developer.garmin.com/fit/cookbook/encoding-activity-files/

type FitRide = Pick<RideRecord, 'id' | 'name' | 'date' | 'seconds' | 'distance' | 'demo' | 'ftp'>
  & Partial<Pick<RideRecord, 'startedAt' | 'samples' | 'timerEvents' | 'distanceMeasured'>>;
type FitMessage = Record<string, string | number | Date>;
type TimelineItem = { offset: number; order: number; type: 'RECORD' | 'EVENT'; message: FitMessage };

const valid = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < max;
const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
const maximum = (values: number[]) => Math.round(values.reduce((max, value) => Math.max(max, value), 0));

/** Export a measured indoor ride. date is its finish time; startedAt is optional. */
export function encodeFit(ride: FitRide): Uint8Array {
  if (ride.demo) throw new Error('Demoturer kan ikke eksporteres som målte FIT-aktiviteter.');
  if (!valid(ride.seconds, 86401) || ride.seconds <= 0) throw new Error('Ugyldig øktvarighet.');
  const finish = new Date(ride.date);
  const start = ride.startedAt ? new Date(ride.startedAt) : new Date(finish.getTime() - ride.seconds * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(finish.getTime()) || finish < start
    || start.getTime() < 631065600000) throw new Error('Ugyldig dato for FIT-eksport.');
  const unique = new Map<number, RideSample>();
  for (const sample of ride.samples ?? []) {
    if (sample.measured === false || !Number.isInteger(sample.second) || sample.second < 1
      || sample.second > ride.seconds || !valid(sample.power, 65535)) continue;
    unique.set(sample.second, sample);
  }
  const samples = [...unique.values()].sort((a, b) => a.second - b.second);
  if (!samples.length) throw new Error('Økten har ingen lagrede wattmålinger å eksportere.');

  const encoder = new Encoder();
  const write = (type: string, message: FitMessage) => encoder.onMesg(Profile.MesgNum[type], message as Mesg);
  let serial = 2166136261;
  for (const character of String(ride.id)) serial = Math.imul(serial ^ character.charCodeAt(0), 16777619) >>> 0;
  write('FILE_ID', {
    type: 'activity', manufacturer: 'development', product: 1,
    serialNumber: serial || 1, timeCreated: start, productName: 'SUMMIT Xebex',
  });
  write('DEVICE_INFO', {
    timestamp: start, deviceIndex: 0, manufacturer: 'development', product: 1,
    productName: 'SUMMIT', softwareVersion: 1,
  });
  write('EVENT', { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });
  const elapsedSeconds = (finish.getTime() - start.getTime()) / 1000;
  const timeline: TimelineItem[] = [];
  for (const sample of samples) {
    const offset = valid(sample.wallSecond, 172801) ? sample.wallSecond : sample.second;
    const timestamp = new Date(Math.min(finish.getTime(), start.getTime() + offset * 1000));
    const record: FitMessage = { timestamp, power: Math.min(65534, Math.round(sample.power)) };
    if (valid(sample.cadence, 255)) record.cadence = Math.min(254, Math.round(sample.cadence));
    if (valid(sample.heartRate, 255)) record.heartRate = Math.min(254, Math.round(sample.heartRate));
    // Never invent GPS, speed, distance, cadence, or heart rate from watts.
    timeline.push({ offset, order: 1, type: 'RECORD', message: record });
  }
  for (const event of ride.timerEvents ?? []) {
    if (!valid(event.wallSecond, 172801) || event.wallSecond > elapsedSeconds
      || (event.type !== 'start' && event.type !== 'stop')) continue;
    timeline.push({
      offset: event.wallSecond, order: event.type === 'start' ? 0 : 2, type: 'EVENT',
      message: { timestamp: new Date(start.getTime() + event.wallSecond * 1000), event: 'timer', eventType: event.type, eventGroup: 0 },
    });
  }
  timeline.sort((a, b) => a.offset - b.offset || a.order - b.order);
  let timerRunning = true;
  for (const item of timeline) {
    if (item.type === 'EVENT') {
      const running = item.message.eventType === 'start';
      if (running === timerRunning) continue;
      timerRunning = running;
    }
    write(item.type, item.message);
  }
  write('EVENT', { timestamp: finish, event: 'timer', eventType: 'stopAll', eventGroup: 0 });

  const powers = samples.map(sample => sample.power);
  const heartRates = samples.map(sample => sample.heartRate).filter((value): value is number => valid(value, 255));
  const cadences = samples.map(sample => sample.cadence).filter((value): value is number => valid(value, 255));
  const summary: FitMessage = {
    timestamp: finish, startTime: start, sport: 'cycling', subSport: 'indoorCycling',
    totalElapsedTime: elapsedSeconds, totalTimerTime: ride.seconds,
    avgPower: average(powers), maxPower: maximum(powers),
    totalWork: Math.round(powers.reduce((sum, power) => sum + power, 0)),
  };
  if (heartRates.length) { summary.avgHeartRate = average(heartRates); summary.maxHeartRate = maximum(heartRates); }
  if (cadences.length) { summary.avgCadence = average(cadences); summary.maxCadence = maximum(cadences); }
  if (ride.distanceMeasured === true && valid(ride.distance, 40000)) summary.totalDistance = ride.distance * 1000;
  write('LAP', { ...summary, messageIndex: 0, event: 'lap', eventType: 'stop', lapTrigger: 'sessionEnd' });
  write('SESSION', {
    ...summary, messageIndex: 0, event: 'session', eventType: 'stop',
    firstLapIndex: 0, numLaps: 1, trigger: 'activityEnd',
    sportProfileName: String(ride.name || 'SUMMIT').slice(0, 60),
    ...(valid(ride.ftp, 65535) ? { thresholdPower: Math.round(ride.ftp) } : {}),
  });
  write('ACTIVITY', {
    timestamp: finish, totalTimerTime: ride.seconds, numSessions: 1,
    type: 'manual', event: 'activity', eventType: 'stop',
  });
  return encoder.close();
}

export const fitFileName = (ride: Pick<RideRecord, 'id'>) => `summit-${ride.id}.fit`;

/** Encodes in the browser and starts the download. Throws with a Norwegian message. */
export function downloadFit(ride: RideRecord) {
  if (ride.demo || !ride.samples?.length) throw new Error('FIT-eksport krever en ekte økt med registrerte målinger. Demoturer kan ikke eksporteres som aktivitet.');
  const bytes = encodeFit(ride);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.ant.fit' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fitFileName(ride);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
