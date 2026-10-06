import { describe, expect, test } from 'vitest';
import { campaignFor, chooseExpeditionRoute, createExpedition, finishExpedition, stepExpedition } from './expedition';
import type { ExpeditionRoute, ExpeditionState } from './expedition';
import type { RideRecord } from './storage';
import { journeyFor, journeyForRide } from './journey';

const advance = (start: ExpeditionState, seconds: number) => {
  let state = start;
  for (let i = 0; i < seconds; i++) state = stepExpedition(state, { seconds: 1, power: 100, target: 100, phase: 'recovery', elapsed: state.elapsed });
  return state;
};
function expedition(routes: ExpeditionRoute[]) {
  let state = createExpedition('tron', campaignFor([], 'tron'), routes[0] || 'restore');
  routes.forEach((route, index) => {
    if (index) state = chooseExpeditionRoute(state, route);
    state = advance(state, route === 'restore' ? 30 : 40);
  });
  return state;
}
const ride = (routes: ExpeditionRoute[], extra: Partial<RideRecord> = {}): RideRecord => {
  const state = expedition(routes);
  return { id: 'a', name: 'Test', date: '2026-10-01T09:00:00Z', seconds: state.elapsed, distance: 1,
    avgPower: 100, energy: 10, zoneSeconds: [0, 0, 0, 0, 0, 0, 0], completed: true,
    demo: false, ftp: 200, worldId: 'tron', expedition: finishExpedition(state), ...extra };
};

describe('ordered performance journey', () => {
  test('same route counts in a different order create different destinations and final choices', () => {
    const bridgeFirst = journeyFor([ride(['restore', 'explore'])], 'tron');
    const vaultFirst = journeyFor([ride(['explore', 'restore'])], 'tron');
    expect(bridgeFirst.completed).toBe(vaultFirst.completed);
    expect(bridgeFirst.choices.explore.variant).toBe('vault');
    expect(vaultFirst.choices.explore.variant).toBe('bridge');
    expect(bridgeFirst.choices.restore.destination).not.toBe(vaultFirst.choices.restore.destination);
    expect(bridgeFirst.log.map(item => item.variant)).toEqual(['bridge', 'garden']);
    expect(vaultFirst.log.map(item => item.variant)).toEqual(['vault', 'garden']);
  });

  test('chronological replay crosses ride boundaries and is independent of history ordering', () => {
    const first = ride(['explore']);
    const second = ride(['restore', 'explore'], { id: 'b', date: '2026-10-02T09:00:00Z' });
    const across = journeyFor([second, first], 'tron');
    expect(across).toEqual(journeyFor([first, second], 'tron'));
    expect(across.log).toEqual(journeyFor([ride(['explore', 'restore', 'explore'])], 'tron').log);
    expect(across).toMatchObject({ chapter: 2, step: 1, completed: 3 });
    expect(across.log.at(-1)?.variant).toBe('bridge');
  });

  test('saved demos, wrong worlds, duplicate rides and invalid dates do not grant credit', () => {
    const valid = ride(['restore']);
    expect(journeyFor([valid, valid, ride(['explore'], { id: 'demo', demo: true }),
      ride(['explore'], { id: 'sky', worldId: 'sky' }), ride(['restore'], { id: 'bad', date: 'invalid' })], 'tron').completed).toBe(1);
  });

  test('rejects forged counts, impossible or unordered times, route mismatches and extra choices', () => {
    const valid = ride(['restore', 'explore']);
    const invalid = [
      { ...valid.expedition!, restored: 2 },
      { ...valid.expedition!, choices: [{ stage: 1, route: 'restore' as const, second: 0 }, { stage: 2, route: 'explore' as const, second: 29 }] },
      { ...valid.expedition!, choices: [{ stage: 1, route: 'restore' as const, second: 0 }, { stage: 2, route: 'explore' as const, second: NaN }] },
      { ...valid.expedition!, choices: [{ stage: 1, route: 'explore' as const, second: 0 }, { stage: 2, route: 'explore' as const, second: 40 }] },
      { ...valid.expedition!, choices: [...valid.expedition!.choices, { stage: 3, route: 'restore' as const, second: 70 }, { stage: 4, route: 'restore' as const, second: 100 }] },
    ];
    invalid.forEach(result => expect(journeyFor([{ ...valid, expedition: result }], 'tron').completed).toBe(0));
    expect(journeyFor([{ ...valid, seconds: 60 }], 'tron').completed).toBe(0);
  });

  test('unfinished selection changes upcoming destination but never grants completion', () => {
    const complete = expedition(['explore']);
    const selected = chooseExpeditionRoute(complete, 'restore');
    const live = advance(selected, 15);
    const journey = journeyFor([], 'tron', live);
    expect(journey).toMatchObject({ completed: 1, step: 2, variant: 'garden', route: 'restore' });
    expect(journey.progress).toBeCloseTo(0.5);
    expect(journey.log).toHaveLength(1);
    expect(journeyFor([ride(['explore'], { expedition: finishExpedition(live), seconds: live.elapsed })], 'tron').completed).toBe(1);
    expect(journeyFor([], 'tron', complete)).toMatchObject({ completed: 1, progress: 0 });
  });

  test('fresh preview and invalid live state give no credit; checkpoints replay deterministically', () => {
    const start = expedition([]);
    expect(journeyFor([], 'tron', start)).toMatchObject({ completed: 0, progress: 0, chapter: 1, step: 1 });
    const live = advance(chooseExpeditionRoute(expedition(['restore']), 'explore'), 7);
    expect(journeyFor([], 'tron', JSON.parse(JSON.stringify(live)))).toEqual(journeyFor([], 'tron', live));
    expect(journeyFor([], 'tron', { ...live, completed: 20 }).completed).toBe(0);
    expect(journeyFor([], 'sky', live).completed).toBe(0);
  });

  test('saved unfinished route restores the next destination without restoring charge or granting credit', () => {
    const live = advance(chooseExpeditionRoute(expedition(['restore']), 'explore'), 15);
    const saved = ride(['restore'], { expedition: finishExpedition(live), seconds: live.elapsed });
    const restored = journeyFor([saved], 'tron');
    expect(restored).toMatchObject({ completed: 1, step: 2, route: 'explore', variant: 'garden', progress: 0 });
    expect(restored.log).toHaveLength(1);
    expect(journeyForRide([saved], saved)).toEqual(restored);
    expect(journeyFor([saved], 'tron', expedition([]))).toMatchObject({ route: 'restore', variant: 'beacon', completed: 1 });
  });

  test('demo preview is isolated from permanent history', () => {
    const saved = ride(['restore', 'restore', 'restore']);
    const preview = journeyFor([saved], 'tron', expedition(['explore']), true);
    expect(preview).toMatchObject({ demo: true, completed: 1, chapter: 1 });
    expect(journeyFor([saved], 'tron').completed).toBe(3);
  });

  test('four chapter themes repeat deterministically while receipt log stays bounded', () => {
    const routes: ExpeditionRoute[] = Array.from({ length: 15 }, () => 'restore');
    const journey = journeyFor([ride(routes)], 'tron');
    expect(journey).toMatchObject({ chapter: 6, step: 1, completed: 15 });
    expect(journey.log).toHaveLength(12);
    expect(journey.log[0].chapter).toBe(2);
    expect(journey.log.at(-1)?.chapter).toBe(5);
    expect(journey.chapterName).toBe(journeyFor([ride(routes.slice(0, 3))], 'tron').chapterName);
  });

  test('historical receipts exclude later history and duplicate self; demo receipt remains ephemeral', () => {
    const first = ride(['restore']);
    const second = ride(['explore'], { id: 'b', date: '2026-10-02T09:00:00Z' });
    const future = ride(['restore', 'restore', 'restore'], { id: 'c', date: '2026-10-03T09:00:00Z' });
    expect(journeyForRide([future, second, first], second)).toEqual(journeyFor([first, second], 'tron'));
    expect(journeyForRide([first, second, future], { ...second, demo: true })).toMatchObject({ demo: true, completed: 1 });
  });
});
