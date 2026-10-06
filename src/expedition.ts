import type { WorldId } from './worlds';
import type { RideRecord } from './storage';
export type ExpeditionRoute = 'restore' | 'explore';
export interface ExpeditionVisual {
  route: ExpeditionRoute;
  charge: number;
  completed: number;
  restored: number;
  discovered: number;
  worldRestored: number;
  worldDiscovered: number;
  branch: -1 | 1;
  choiceOpen: boolean;
  eventSerial: number;
  stage: number;
  label: string;
}
export interface ExpeditionState extends ExpeditionVisual {
  version: 1;
  worldId: WorldId;
  targetSeconds: number;
  choiceRemaining: number;
  elapsed: number;
  event: string;
  eventAt: number;
  choices: { stage: number; route: ExpeditionRoute; second: number }[];
  discoveries: string[];
}
export interface ExpeditionResult {
  version: 1;
  restored: number;
  discovered: number;
  completed: number;
  discoveries: string[];
  choices: { stage: number; route: ExpeditionRoute; second: number }[];
}
export interface CampaignProgress {
  restored: number;
  discovered: number;
  structures: { name: string; cost: number; unlocked: boolean }[];
  relics: { name: string; cost: number; unlocked: boolean }[];
  chapter: number;
}
// One update represents at most one second of fresh telemetry, never a timer jump.
const MAX_SECONDS = 172800;
const MAX_MISSIONS = 5760;
const MAX_CAMPAIGN = 1_000_000_000;
const STRUCTURE_COSTS = [1, 5, 15, 35, 70, 120];
const RELIC_COSTS = [1, 4, 10, 24, 48, 80];
const NAMES: Record<WorldId, { structures: string[]; relics: string[] }> = {
  vestland: {
    structures: ['Naustet', 'Steinbrua', 'Bjørkelunden', 'Gårdstunet', 'Utsiktspunktet', 'Fjordbygda'],
    relics: ['Fjordkartet', 'Stimerkingen', 'Veiboken', 'Fjellskissen', 'Bygdekartet', 'Turboken'],
  },
  tron: { structures: ['Gridporten','Datasøylen','Lysbroen','Kjerneringen','Nettverket','Hovedkjernen'], relics: ['Lysdisken','Datakuben','Rutenøkkelen','Kjernedisken','Systemkartet','Gridminnet'] },
  neon: {
    structures: ['Lysbroen', 'Pulstorget', 'Signaltårnet', 'Solarkaden', 'Orbitalhavnen', 'Novakjernen'],
    relics: ['Prismesplinten', 'Ekkomodulen', 'Neonkartet', 'Stjernebrikken', 'Nullpunktsnøkkelen', 'Novahjertet'],
  },
  sky: {
    structures: ['Vindfyret', 'Mosehagen', 'Fossetempelet', 'Skybiblioteket', 'Stjerneporten', 'Aerias hjerte'],
    relics: ['Vindfrøet', 'Skykrystallen', 'Solkompasset', 'Månefjæren', 'Stjerneseglet', 'Aerias minne'],
  },
  fjord: {
    structures: ['Fjordfyret', 'Naustet', 'Fjellstua', 'Kystbroen', 'Utsiktstårnet', 'Havhavnen'],
    relics: ['Ravsteinen', 'Sjøkartet', 'Fjellrunen', 'Sølvkompasset', 'Nordlysglasset', 'Havets minne'],
  },
  alpine: {
    structures: ['Varden', 'Fjellhytta', 'Isbroen', 'Topptårnet', 'Solobservatoriet', 'Fjellkronen'],
    relics: ['Kvartskrystallen', 'Isrosen', 'Toppkartet', 'Ørnefjæren', 'Solsteinen', 'Fjellets minne'],
  },
  midnight: {
    structures: ['Nattfyret', 'Månehagen', 'Skumringsbroen', 'Nordlystårnet', 'Solhavnen', 'Nattkronen'],
    relics: ['Måneskåret', 'Nattkompasset', 'Solseilet', 'Nordlysperlen', 'Horisontseglet', 'Nattens minne'],
  },
};
const bounded = (n: number, max: number) => Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
const count = (n: number, max = MAX_CAMPAIGN) => Math.floor(bounded(n, max));
const routeDuration = (route: ExpeditionRoute) => route === 'restore' ? 30 : 40;
const validRoute = (route: unknown): route is ExpeditionRoute => route === 'restore' || route === 'explore';
const namesFor = (world: WorldId) => NAMES[world] ?? NAMES.neon;
const nextStructure = (s: Pick<ExpeditionState, 'worldId' | 'worldRestored'>) => {
  const index = STRUCTURE_COSTS.findIndex(cost => cost > s.worldRestored);
  return namesFor(s.worldId).structures[index < 0 ? 5 : index];
};
const missionLabel = (s: Pick<ExpeditionState, 'worldId' | 'worldRestored' | 'route'>) =>
  s.route === 'restore' ? `Gi energi til ${nextStructure(s)}` : 'Utforsk en glemt sti';

/** Only saved, real expeditions contribute; legacy rides remain valid history. */
export function campaignFor(history: RideRecord[], world: WorldId): CampaignProgress {
  let restored = 0;
  let discovered = 0;
  const seen = new Set<string>();
  for (const ride of history) {
    if (!ride || typeof ride.id !== 'string' || !ride.id || seen.has(ride.id)) continue;
    seen.add(ride.id);
    if (ride.demo !== false || ride.worldId !== world) continue;
    const result = ride.expedition;
    if (!result || result.version !== 1 || !Number.isInteger(result.restored) || !Number.isInteger(result.discovered)
      || result.restored < 0 || result.discovered < 0 || result.completed !== result.restored + result.discovered
      || result.completed > MAX_MISSIONS || !Number.isFinite(ride.seconds)
      || result.restored * 30 + result.discovered * 40 > ride.seconds + 1
      || !Array.isArray(result.discoveries) || result.discoveries.length !== result.discovered) continue;
    restored = count(restored + result.restored);
    discovered = count(discovered + result.discovered);
  }
  const names = namesFor(world);
  const structures = STRUCTURE_COSTS.map((cost, index) => ({ name: names.structures[index], cost, unlocked: restored >= cost }));
  const relics = RELIC_COSTS.map((cost, index) => ({ name: names.relics[index], cost, unlocked: discovered >= cost }));
  return { restored, discovered, structures, relics, chapter: Math.min(6, 1 + Math.floor((structures.filter(s => s.unlocked).length + relics.filter(r => r.unlocked).length) / 2)) };
}

export function createExpedition(world: WorldId, campaign: CampaignProgress, route: ExpeditionRoute = 'restore'): ExpeditionState {
  const selected = validRoute(route) ? route : 'restore';
  const s: ExpeditionState = {
    version: 1, worldId: world, route: selected, charge: 0, completed: 0, restored: 0, discovered: 0,
    worldRestored: count(campaign.restored), worldDiscovered: count(campaign.discovered),
    branch: selected === 'restore' ? -1 : 1, choiceOpen: false, eventSerial: 0, stage: 1,
    targetSeconds: routeDuration(selected), choiceRemaining: 0, elapsed: 0,
    label: '', event: 'Finn rytmen – reisen begynner', eventAt: 0,
    choices: [{ stage: 1, route: selected, second: 0 }], discoveries: [],
  };
  s.label = missionLabel(s);
  return s;
}

export function chooseExpeditionRoute(state: ExpeditionState, route: ExpeditionRoute): ExpeditionState {
  if (!state.choiceOpen || !validRoute(route) || state.completed >= MAX_MISSIONS || state.elapsed >= MAX_SECONDS) return state;
  const next: ExpeditionState = {
    ...state, route, branch: route === 'restore' ? -1 : 1, charge: 0,
    stage: state.completed + 1, targetSeconds: routeDuration(route), choiceOpen: false, choiceRemaining: 0,
    choices: [...state.choices, { stage: state.completed + 1, route, second: state.elapsed }],
    event: route === 'restore' ? 'Energiveien ved neste veiskille' : 'Høyveien ved neste veiskille', eventAt: state.elapsed,
  };
  next.label = missionLabel(next);
  return next;
}

export function stepExpedition(state: ExpeditionState, input: { seconds: number; power: number | undefined; target: number; phase: string; elapsed: number }): ExpeditionState {
  const dt = Math.min(bounded(input.seconds, 1), Math.max(0, MAX_SECONDS - state.elapsed));
  if (!dt || state.completed >= MAX_MISSIONS) return state;
  // Deliberately derive time from observed updates. elapsed/phase changes cannot grant rewards.
  let next = { ...state, elapsed: state.elapsed + dt };
  if (state.choiceOpen) {
    next.choiceRemaining = Math.max(0, state.choiceRemaining - dt);
    if (next.choiceRemaining <= 1e-8) next = chooseExpeditionRoute(next, state.route);
    return next;
  }
  if (!Number.isFinite(input.power) || !Number.isFinite(input.target) || input.target <= 0 || input.target > 5000 || input.power! < 0 || input.power! > 5000) return next;
  const ratio = input.power! / input.target;
  // Recovery and work use identical pacing; surplus watts never buy progress.
  if (ratio < 0.9 - 1e-9 || ratio > 1.1 + 1e-9) return next;
  next.charge = Math.min(1, state.charge + dt / state.targetSeconds);
  if (next.charge < 1 - 1e-8) return next;
  next.charge = 1;
  next.completed++;
  next.eventSerial++;
  next.eventAt = next.elapsed;
  next.choiceOpen = true;
  next.choiceRemaining = 12;
  if (state.route === 'restore') {
    next.restored++;
    next.worldRestored = count(next.worldRestored + 1);
    next.event = STRUCTURE_COSTS.includes(next.worldRestored) ? `${nextStructure(state)} er gjenreist!` : `Energi levert til ${nextStructure(state)}`;
  } else {
    const found = count(state.worldDiscovered + 1);
    const index = RELIC_COSTS.findIndex(cost => cost >= found);
    const names = namesFor(state.worldId).relics;
    const complete = index >= 0 && RELIC_COSTS[index] === found;
    const previousCost = index > 0 ? RELIC_COSTS[index - 1] : 0;
    const relic = index < 0 ? `${names[5]} · arkivfragment ${found - RELIC_COSTS[5]}`
      : complete ? names[index] : `${names[index]} · fragment ${found - previousCost}/${RELIC_COSTS[index] - previousCost}`;
    next.discovered++;
    next.worldDiscovered = found;
    next.discoveries = [...state.discoveries, relic];
    next.event = complete ? `Relikvie fullført: ${relic}!` : `Du fant ${relic}`;
  }
  next.label = 'Velg neste vei';
  return next;
}

export function finishExpedition(state: ExpeditionState): ExpeditionResult {
  return {
    version: 1, restored: state.restored, discovered: state.discovered, completed: state.completed,
    discoveries: [...state.discoveries], choices: state.choices.map(choice => ({ ...choice })),
  };
}
