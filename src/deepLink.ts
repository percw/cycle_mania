/**
 * One-shot arrival parameters: `/?workout=<id>` preselects a workout on the home page and
 * `ref=okt` marks a click from the static workout pages (/okter/…). Both are removed from the
 * address bar after reading, so a reload or a bookmark does not repeat them.
 */
export interface Arrival { workoutId: string | null; fromWorkoutPage: boolean }

const ARRIVAL_PARAMS = ['workout', 'ref'];

export function parseArrival(search: string): Arrival {
  const params = new URLSearchParams(search);
  const id = params.get('workout');
  return {
    workoutId: id && /^[\w-]{1,100}$/.test(id) ? id : null,
    fromWorkoutPage: params.get('ref') === 'okt',
  };
}

/** The same URL without arrival parameters, or null when there is nothing to remove. */
export function withoutArrivalParams(href: string): string | null {
  const url = new URL(href);
  if (!ARRIVAL_PARAMS.some(key => url.searchParams.has(key))) return null;
  for (const key of ARRIVAL_PARAMS) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

export function readArrival(): Arrival {
  if (typeof window === 'undefined') return { workoutId: null, fromWorkoutPage: false };
  const arrival = parseArrival(window.location.search);
  const clean = withoutArrivalParams(window.location.href);
  if (clean !== null) {
    try { window.history.replaceState(window.history.state, '', clean); } catch { /* sandboxed frames */ }
  }
  return arrival;
}
