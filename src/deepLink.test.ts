import { describe, expect, it } from 'vitest';
import { parseArrival, withoutArrivalParams } from './deepLink';

describe('deep links', () => {
  it('reads the workout id and the workout-page referral', () => {
    expect(parseArrival('?workout=threshold-4x10&ref=okt')).toEqual({ workoutId: 'threshold-4x10', fromWorkoutPage: true });
    expect(parseArrival('?workout=vo2-4x4')).toEqual({ workoutId: 'vo2-4x4', fromWorkoutPage: false });
    expect(parseArrival('')).toEqual({ workoutId: null, fromWorkoutPage: false });
  });
  it('ignores malformed ids instead of passing them on', () => {
    expect(parseArrival('?workout=<script>').workoutId).toBeNull();
    expect(parseArrival(`?workout=${'a'.repeat(101)}`).workoutId).toBeNull();
    expect(parseArrival('?ref=other').fromWorkoutPage).toBe(false);
  });
  it('removes only the arrival parameters from the address', () => {
    expect(withoutArrivalParams('https://summit-sykkel.vercel.app/?workout=vo2-4x4&ref=okt')).toBe('/');
    expect(withoutArrivalParams('https://x.app/?debug=1&workout=a#top')).toBe('/?debug=1#top');
    expect(withoutArrivalParams('https://x.app/?debug=1')).toBeNull();
  });
});
