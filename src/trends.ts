import { bestRollingPower, measuredSamples } from './analytics';
import { normalizedPower, trainingLoad } from './reportInsights';
import type { RideRecord } from './storage';

/** Durations on the power curve, in seconds. */
export const CURVE_DURATIONS = [5, 15, 30, 60, 120, 180, 300, 480, 600, 1200, 1800, 3600];

const DAY = 86400000;

/** Monday 00:00 local time of the week containing `date` (Norwegian week). */
export function weekStart(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

/** Measured load for one ride; null when there is no usable power data. */
export function rideLoad(ride: RideRecord) {
  if (ride.demo) return null;
  const measured = measuredSamples(ride.samples, ride.seconds);
  const np = normalizedPower(ride.samples ?? [], ride.seconds);
  return trainingLoad(np, measured.length, ride.ftp)?.tss ?? null;
}

export function weeklyLoad(rides: RideRecord[], weeks = 8, now = new Date()) {
  const thisWeek = weekStart(now);
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(thisWeek); start.setDate(start.getDate() - (weeks - 1 - i) * 7);
    return { start, minutes: 0, tss: 0, rides: 0, unknownLoad: 0, current: i === weeks - 1 };
  });
  for (const ride of rides) {
    if (ride.demo) continue;
    const when = new Date(ride.date);
    const index = buckets.findIndex((b, i) => when >= b.start && (i === buckets.length - 1 || when < buckets[i + 1].start));
    if (index < 0 || when.getTime() - buckets[index].start.getTime() >= 7 * DAY) continue;
    const bucket = buckets[index];
    bucket.rides++;
    bucket.minutes += ride.seconds / 60;
    const tss = rideLoad(ride);
    if (tss === null) bucket.unknownLoad++; else bucket.tss += tss;
  }
  return buckets.map(b => ({ ...b, minutes: Math.round(b.minutes), tss: Math.round(b.tss) }));
}

/** Rolling load: the last `days` days against the `days` before, by ride timestamp (no partial-week bias). */
export function rollingLoad(rides: RideRecord[], days = 28, now = new Date()) {
  const end = now.getTime(), mid = end - days * DAY, start = mid - days * DAY;
  let recent = 0, previous = 0, recentMinutes = 0;
  for (const ride of rides) {
    if (ride.demo) continue;
    const at = Date.parse(ride.date);
    if (at > end || at < start) continue;
    const tss = rideLoad(ride) ?? 0;
    if (at >= mid) { recent += tss; recentMinutes += ride.seconds / 60; } else previous += tss;
  }
  return { recent: Math.round(recent), previous: Math.round(previous), recentMinutes: Math.round(recentMinutes),
    change: previous > 0 ? Math.round((recent / previous - 1) * 100) : null };
}

/**
 * Mean-maximal power for each duration, from fully observed contiguous windows
 * in measured rides only. `sinceDays` limits the window (e.g. last six weeks).
 */
export function powerCurve(rides: RideRecord[], { sinceDays, now = new Date() }: { sinceDays?: number; now?: Date } = {}) {
  const from = sinceDays === undefined ? -Infinity : now.getTime() - sinceDays * DAY;
  const eligible = rides.filter(r => !r.demo && Date.parse(r.date) >= from && (r.samples?.length ?? 0) > 0);
  return CURVE_DURATIONS.map(seconds => {
    let best: { watts: number; rideId: string; date: string } | null = null;
    for (const ride of eligible) {
      const watts = bestRollingPower(measuredSamples(ride.samples, ride.seconds), seconds);
      if (watts !== null && (!best || watts > best.watts)) best = { watts, rideId: ride.id, date: ride.date };
    }
    return { seconds, ...(best ?? { watts: null, rideId: null, date: null }) };
  });
}

export function durationLabel(seconds: number) {
  return seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${seconds / 60} min` : `${seconds / 3600} t`;
}
