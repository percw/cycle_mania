/**
 * Privacy-first product telemetry.
 *
 * - Sends only in production builds on a real host (never localhost, LAN, tests or automation).
 * - No cookies, no user IDs, no device fingerprints. Respects Global Privacy Control,
 *   Do Not Track and a local opt-out (see the "Personvern" note).
 * - Every event has a fixed schema of keys and allowed values. Unknown keys are dropped and
 *   unknown values become "other", so watts, FTP, heart rate or free text can never leave.
 *
 * Provider: Vercel Web Analytics by default. Set VITE_ANALYTICS=plausible|umami|off at build
 * time to switch (plus VITE_ANALYTICS_SRC and VITE_ANALYTICS_SITE for Plausible/Umami).
 */
import type { RideRecord } from './storage';
import type { Workout } from './training';
import { worlds } from './worlds';

export type SensorKind = 'ftms' | 'power' | 'hr' | 'ant';
export type NthBucket = '0' | '1' | '2' | '3' | '4-5' | '6-10' | '11+';
export type MinutesBucket = '<10' | '10-19' | '20-29' | '30-44' | '45-59' | '60-89' | '90+';
export type SurveyQuestion = 'other_app' | 'switch';
export const otherAppAnswers = ['zwift', 'mywhoosh', 'rouvy', 'trainerroad', 'annet', 'ingen'] as const;
export const switchAnswers = ['ja', 'kanskje', 'nei'] as const;
export const workoutCategories = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2', 'anaerobic', 'sprint', 'ftp_test', 'custom', 'other'] as const;
export type WorkoutCategory = typeof workoutCategories[number];

export interface TelemetryEvents {
  app_open: { bluetooth: boolean; installed: boolean };
  sensor_connected: { kind: SensorKind };
  ride_started: { demo: boolean; world: string; workout_category: WorkoutCategory };
  ride_completed: { demo: boolean; nth: NthBucket; minutes: MinutesBucket; world: string; full: boolean };
  share_card: { method: 'share' | 'download' };
  survey_answer: { question: SurveyQuestion; answer: string };
  workout_page_cta: { category: WorkoutCategory };
}
export type TelemetryEvent = keyof TelemetryEvents;

const bool = ['true', 'false'] as const;
const worldIds = worlds.map(world => world.id as string);
const nthBuckets: NthBucket[] = ['0', '1', '2', '3', '4-5', '6-10', '11+'];
const minuteBuckets: MinutesBucket[] = ['<10', '10-19', '20-29', '30-44', '45-59', '60-89', '90+'];

/** The complete list of what may be sent. Anything else is dropped before it reaches an adapter. */
export const eventSchema: { [E in TelemetryEvent]: { [K in keyof TelemetryEvents[E]]-?: readonly string[] } } = {
  app_open: { bluetooth: bool, installed: bool },
  sensor_connected: { kind: ['ftms', 'power', 'hr', 'ant'] },
  ride_started: { demo: bool, world: worldIds, workout_category: workoutCategories },
  ride_completed: { demo: bool, nth: nthBuckets, minutes: minuteBuckets, world: worldIds, full: bool },
  share_card: { method: ['share', 'download'] },
  survey_answer: { question: ['other_app', 'switch'], answer: [...otherAppAnswers, ...switchAnswers] },
  workout_page_cta: { category: workoutCategories },
};

/** Drops keys outside the schema; values outside the allowed list become "other". */
export function sanitizeProps<E extends TelemetryEvent>(name: E, props: TelemetryEvents[E] | Record<string, unknown>): Record<string, string> {
  const schema = eventSchema[name] as Record<string, readonly string[]>;
  const out: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(schema)) {
    const value = (props as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const text = typeof value === 'boolean' ? String(value) : typeof value === 'string' ? value : '';
    out[key] = allowed.includes(text) ? text : 'other';
  }
  return out;
}

export function nthBucket(count: number): NthBucket {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n <= 3 ? String(n) as NthBucket : n <= 5 ? '4-5' : n <= 10 ? '6-10' : '11+';
}

export function minutesBucket(seconds: number): MinutesBucket {
  const m = Number.isFinite(seconds) ? Math.max(0, seconds) / 60 : 0;
  return m < 10 ? '<10' : m < 20 ? '10-19' : m < 30 ? '20-29' : m < 45 ? '30-44' : m < 60 ? '45-59' : m < 90 ? '60-89' : '90+';
}

const categorySlugs: Record<string, WorkoutCategory> = {
  'Restitusjon': 'recovery', 'Utholdenhet': 'endurance', 'Tempo': 'tempo', 'Sweet spot': 'sweetspot',
  'Terskel': 'threshold', 'VO₂ maks': 'vo2', 'Anaerob': 'anaerobic', 'Sprint': 'sprint',
};
export function workoutCategory(workout: Pick<Workout, 'category' | 'custom' | 'ramp'> | undefined): WorkoutCategory {
  if (!workout) return 'other';
  if (workout.ramp) return 'ftp_test';
  if (workout.custom) return 'custom';
  return categorySlugs[workout.category] ?? 'other';
}

/** A real ride that counts towards "nth": not a demo, and either the full plan or at least ten minutes. */
export function countsAsRealRide(ride: Pick<RideRecord, 'demo' | 'completed' | 'seconds'>): boolean {
  return !ride.demo && (ride.completed || ride.seconds >= 600);
}
export function realRideCount(history: Pick<RideRecord, 'demo' | 'completed' | 'seconds'>[]): number {
  return history.filter(countsAsRealRide).length;
}

const privateHost = /^(localhost|.*\.localhost|.*\.local|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;
export function isLocalHost(hostname: string): boolean {
  return !hostname || privateHost.test(hostname);
}

export const OPT_OUT_KEY = 'summit-telemetry-off';

export function telemetryAllowed(env: { prod: boolean; hostname: string; optedOut?: boolean; gpc?: boolean; dnt?: boolean; automated?: boolean }): boolean {
  return env.prod && !isLocalHost(env.hostname) && !env.optedOut && !env.gpc && !env.dnt && !env.automated;
}

export function telemetryOptedOut(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) === 'true'; } catch { return false; }
}
export function setTelemetryOptOut(off: boolean) {
  try { if (off) localStorage.setItem(OPT_OUT_KEY, 'true'); else localStorage.removeItem(OPT_OUT_KEY); } catch { /* storage blocked */ }
  if (off) adapter = null;
}

export interface TelemetryAdapter {
  start(): void;
  send(name: string, props: Record<string, string>): void;
}

let adapter: TelemetryAdapter | null = null;
/** Replace the active adapter (tests, or a custom provider). `null` turns sending off. */
export function setTelemetryAdapter(next: TelemetryAdapter | null) { adapter = next; }

export function track<E extends TelemetryEvent>(name: E, props: TelemetryEvents[E]): void {
  if (!adapter) return;
  try { adapter.send(name, sanitizeProps(name, props)); } catch { /* telemetry must never break the app */ }
}

const sentOnce = new Set<string>();
/** Tracks an event at most once per page load for the given key (e.g. reconnects). */
export function trackOnce<E extends TelemetryEvent>(key: string, name: E, props: TelemetryEvents[E]) {
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(name, props);
}

function stripQuery(url: string) { return url.split(/[?#]/)[0]; }

function vercelAdapter(): TelemetryAdapter {
  let ready: Promise<typeof import('@vercel/analytics')> | null = null;
  return {
    start() {
      ready = import('@vercel/analytics');
      void ready.then(va => va.inject({
        mode: 'production', framework: 'vite',
        beforeSend: event => ({ ...event, url: stripQuery(event.url) }),
      })).catch(() => {});
    },
    send(name, props) { void ready?.then(va => va.track(name, props)).catch(() => {}); },
  };
}

function scriptAdapter(kind: 'plausible' | 'umami', src: string, site: string): TelemetryAdapter {
  const pending: [string, Record<string, string>][] = [];
  type Win = { plausible?: (name: string, options?: { props: Record<string, string> }) => void; umami?: { track: (name: string, props: Record<string, string>) => void } };
  const win = window as unknown as Win;
  const flush = () => { while (pending.length && win.umami) { const [name, props] = pending.shift()!; win.umami.track(name, props); } };
  return {
    start() {
      if (!src) return;
      const script = document.createElement('script');
      script.defer = true;
      script.src = src;
      if (kind === 'plausible') script.dataset.domain = site;
      else { script.dataset.websiteId = site; script.dataset.excludeSearch = 'true'; script.addEventListener('load', flush); }
      document.head.appendChild(script);
    },
    send(name, props) {
      if (kind === 'plausible') {
        // Standard Plausible queue stub: the script drains `plausible.q` when it loads.
        if (!win.plausible) { const q: unknown[][] = []; win.plausible = Object.assign((...args: unknown[]) => { q.push(args); }, { q }); }
        win.plausible(name, { props });
      } else { pending.push([name, props]); flush(); }
    },
  };
}

/** Call once at startup. Chooses an adapter only when sending is allowed; otherwise stays a no-op. */
export function initTelemetry(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const allowed = telemetryAllowed({
    prod: import.meta.env.PROD, hostname: location.hostname, optedOut: telemetryOptedOut(),
    gpc: nav.globalPrivacyControl === true, dnt: nav.doNotTrack === '1', automated: nav.webdriver === true,
  });
  const provider = (import.meta.env.VITE_ANALYTICS ?? 'vercel') as string;
  if (!allowed || provider === 'off') return false;
  const next = provider === 'plausible' || provider === 'umami'
    ? scriptAdapter(provider, import.meta.env.VITE_ANALYTICS_SRC ?? '', import.meta.env.VITE_ANALYTICS_SITE ?? location.hostname)
    : vercelAdapter();
  next.start();
  adapter = next;
  return true;
}

/** Convenience wrappers so App.tsx stays one line per event. */
export function trackRideStarted(workout: Workout, world: string, demo: boolean) {
  track('ride_started', { demo, world, workout_category: workoutCategory(workout) });
}
export function trackRideSaved(record: RideRecord, history: RideRecord[]) {
  track('ride_completed', {
    demo: record.demo, nth: nthBucket(realRideCount(history)), minutes: minutesBucket(record.seconds),
    world: record.worldId ?? 'other', full: record.completed,
  });
}
