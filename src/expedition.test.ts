import { describe, expect, test } from 'vitest';
import { campaignFor, chooseExpeditionRoute, createExpedition, finishExpedition, stepExpedition } from './expedition';
import type { ExpeditionState } from './expedition';
import type { RideRecord } from './storage';

const fresh = (route: 'restore' | 'explore' = 'restore') => createExpedition('sky', campaignFor([], 'sky'), route);
function advance(state: ExpeditionState, seconds: number, power?: number, target = 100, phase = 'work') {
  const measured = arguments.length >= 3 ? power : 100;
  let next = state;
  for (let n = 0; n < seconds; n++) next = stepExpedition(next, { seconds: 1, power: measured, target, phase, elapsed: next.elapsed });
  return next;
}
const ride = (state: ExpeditionState, extra: Partial<RideRecord> = {}): RideRecord => ({
  id: 'real', name: 'Tur', date: '2026-09-30', seconds: state.elapsed, distance: 1, avgPower: 100,
  energy: 5, zoneSeconds: [0, 0, 0, 0, 0, 0, 0], completed: true, demo: false, ftp: 200,
  worldId: state.worldId, expedition: finishExpedition(state), ...extra,
});

describe('expedition pacing and choices', () => {
  test('restoration rewards in 30 observed seconds, then grants a bounded route decision', () => {
    const start = fresh();
    expect(chooseExpeditionRoute(start, 'explore')).toBe(start);
    const almost = advance(start, 29);
    expect(almost.completed).toBe(0);
    expect(almost.charge).toBeCloseTo(29 / 30);
    const complete = advance(almost, 1);
    expect(complete).toMatchObject({ restored: 1, worldRestored: 1, completed: 1, choiceOpen: true, choiceRemaining: 12 });
    expect(complete.event).toContain('Vindfyret');
    expect(start.charge).toBe(0);
    const selected = chooseExpeditionRoute(complete, 'explore');
    expect(selected).toMatchObject({ route: 'explore', branch: 1, stage: 2, choiceOpen: false, charge: 0, targetSeconds: 40 });
    expect(selected.choices).toEqual([{ stage: 1, route: 'restore', second: 0 }, { stage: 2, route: 'explore', second: 30 }]);
    expect(complete.choices).toHaveLength(1);
    expect(chooseExpeditionRoute(selected, 'restore')).toBe(selected);
    const found = advance(selected, 40);
    expect(found).toMatchObject({ restored: 1, discovered: 1, worldDiscovered: 1, completed: 2 });
    expect(found.discoveries).toEqual(['Vindfrøet']);
  });

  test('automatic fallback keeps current route after 12 actual seconds and earns no decision-window credit', () => {
    const complete = advance(fresh('explore'), 40);
    const waiting = advance(complete, 11, undefined);
    expect(waiting.choiceOpen).toBe(true);
    expect(waiting.choiceRemaining).toBe(1);
    const resumed = advance(waiting, 1);
    expect(resumed).toMatchObject({ route: 'explore', choiceOpen: false, charge: 0, stage: 2 });
    expect(resumed.choices[1]).toEqual({ stage: 2, route: 'explore', second: 52 });
    expect(advance(resumed, 39).completed).toBe(1);
    expect(advance(resumed, 40).completed).toBe(2);
  });

  test('brief deviations retain progress and recovery counts identically to effort', () => {
    let state = advance(fresh(), 10, 90);
    state = advance(state, 3, 89);
    state = advance(state, 2, 111);
    expect(state.charge).toBeCloseTo(1 / 3);
    state = advance(state, 10, 55, 50, 'recovery');
    state = advance(state, 10, 220, 200, 'work');
    expect(state.restored).toBe(1);
    expect(state.elapsed).toBe(35);
  });

  test('missing telemetry, excessive watts, invalid targets and elapsed jumps cannot complete a mission', () => {
    let state = fresh();
    for (const power of [undefined, NaN, Infinity, -1, 0, 500, 5001]) state = advance(state, 60, power);
    for (const target of [0, NaN, Infinity, -1, 6000]) state = advance(state, 60, 100, target);
    expect(state.charge).toBe(0);
    const jumped = stepExpedition(state, { seconds: 3600, power: 100, target: 100, phase: 'work', elapsed: 999999 });
    expect(jumped.charge).toBeCloseTo(1 / 30);
    expect(jumped.elapsed).toBe(state.elapsed + 1);
    expect(jumped.completed).toBe(0);
    for (const seconds of [NaN, Infinity, -1, 0]) expect(stepExpedition(jumped, { seconds, power: 100, target: 100, phase: 'work', elapsed: 999999 })).toBe(jumped);
    expect(finishExpedition(state).completed).toBe(0); // A skip calls no step.
  });

  test('fractional telemetry accumulates and results do not expose mutable state arrays', () => {
    let state = fresh('explore');
    for (let n = 0; n < 160; n++) state = stepExpedition(state, { seconds: 0.25, power: 100, target: 100, phase: 'recovery', elapsed: n / 4 });
    expect(state.completed).toBe(1);
    const result = finishExpedition(state);
    result.discoveries.push('changed');
    result.choices[0].route = 'restore';
    expect(state.discoveries).toEqual(['Vindfrøet']);
    expect(state.choices[0].route).toBe('explore');
  });

  test('two-day sessions and corrupted campaign counters stay finite and bounded', () => {
    const campaign = { ...campaignFor([], 'sky'), restored: Infinity, discovered: NaN };
    const state = createExpedition('sky', campaign);
    expect(state.worldRestored).toBe(0);
    expect(state.worldDiscovered).toBe(0);
    const last = { ...state, elapsed: 172799.5 };
    const ended = advance(last, 1);
    expect(ended.elapsed).toBe(172800);
    expect(ended.charge).toBeCloseTo(0.5 / 30);
    expect(advance(ended, 100)).toBe(ended);
  });
});

describe('persistent campaign', () => {
  test('counts only distinct real results in the selected world and tolerates legacy data', () => {
    const first = advance(fresh(), 30);
    const explore = advance(fresh('explore'), 40);
    const real = ride(first);
    const history = [real, real, ride(first, { id: 'demo', demo: true }), ride(first, { id: 'neon', worldId: 'neon' }), ride(first, { id: 'legacy', expedition: undefined }), ride(explore, { id: 'explored', completed: false })];
    const campaign = campaignFor(history, 'sky');
    expect(campaign).toMatchObject({ restored: 1, discovered: 1, chapter: 2 });
    expect(campaign.structures.filter(s => s.unlocked).map(s => s.name)).toEqual(['Vindfyret']);
    expect(campaign.relics.filter(s => s.unlocked).map(s => s.name)).toEqual(['Vindfrøet']);
    expect(campaign.structures.map(s => s.cost)).toEqual([1, 5, 15, 35, 70, 120]);
    expect(campaign.relics.map(s => s.cost)).toEqual([1, 4, 10, 24, 48, 80]);
    const next = advance(createExpedition('sky', campaign, 'explore'), 40);
    expect(next.worldRestored).toBe(1);
    expect(next.worldDiscovered).toBe(2);
    expect(next.discoveries).toEqual(['Skykrystallen · fragment 1/3']);
    expect(campaignFor([ride(next)], 'sky').discovered).toBe(1); // Result contains only this ride.
  });

  test('discovery fragments and full relic announcements follow the same campaign thresholds', () => {
    let state = fresh('explore');
    for (let n = 0; n < 4; n++) {
      state = advance(state, 40);
      if (n < 3) state = chooseExpeditionRoute(state, 'explore');
    }
    expect(state.discoveries).toEqual(['Vindfrøet', 'Skykrystallen · fragment 1/3', 'Skykrystallen · fragment 2/3', 'Skykrystallen']);
    expect(state.event).toBe('Relikvie fullført: Skykrystallen!');
    const campaign = campaignFor([ride(state)], 'sky');
    expect(campaign.relics.filter(relic => relic.unlocked).map(relic => relic.name)).toEqual(['Vindfrøet', 'Skykrystallen']);
    const next = advance(createExpedition('sky', campaign, 'explore'), 40);
    expect(next.discoveries).toEqual(['Solkompasset · fragment 1/6']);
  });

  test('invalid imported results cannot inject campaign rewards', () => {
    const complete = advance(fresh(), 30);
    const result = finishExpedition(complete);
    for (const expedition of [
      { ...result, restored: Infinity }, { ...result, completed: 10 },
      { ...result, restored: -1 }, { ...result, restored: 1.5 },
      { ...result, discovered: 1, completed: 2 },
    ]) expect(campaignFor([ride(complete, { expedition })], 'sky').restored).toBe(0);
    expect(campaignFor([ride(complete, { seconds: 1 })], 'sky').restored).toBe(0);
  });
});
