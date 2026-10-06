import type { ExpeditionResult, ExpeditionRoute, ExpeditionState } from './expedition';
import type { RideRecord } from './storage';
import type { WorldId } from './worlds';

export type JourneyVariant = 'bridge' | 'vault' | 'garden' | 'beacon';
export interface JourneyVisual {
  chapter: number;
  chapterName: string;
  /** Upcoming destination, numbered 1–3 in each chapter. */
  step: number;
  destination: string;
  route: ExpeditionRoute;
  variant: JourneyVariant;
  completed: number;
  progress: number;
  eventSerial: number;
}
export interface JourneyChoice {
  title: string;
  consequence: string;
  destination: string;
  variant: JourneyVariant;
}
export interface JourneyProgress extends JourneyVisual {
  choices: Record<ExpeditionRoute, JourneyChoice>;
  log: { name: string; route: ExpeditionRoute; variant: JourneyVariant; chapter: number }[];
  nextGoal: string;
  demo: boolean;
}

const themes = [
  { name: 'Den tause byen', bridge: 'Bybroen', vault: 'Arkivet', garden: 'Takhagen', beacon: 'Signaltårnet' },
  { name: 'Øyene over tåken', bridge: 'Vindbroen', vault: 'Skykammeret', garden: 'Den svevende hagen', beacon: 'Vindfyret' },
  { name: 'Den glemte kjernen', bridge: 'Kjernebroen', vault: 'Minneshvelvet', garden: 'Biokammeret', beacon: 'Kjernefyret' },
  { name: 'Hjem gjennom natten', bridge: 'Hjemveien', vault: 'Nattarkivet', garden: 'Daggryhagen', beacon: 'Horisontfyret' },
] as const;
const isRoute = (route: unknown): route is ExpeditionRoute => route === 'restore' || route === 'explore';
const duration = (route: ExpeditionRoute) => route === 'restore' ? 30 : 40;

/** Validate the persisted engine result, including its choice timeline. No invented completions. */
function validChoices(result: ExpeditionResult | undefined, seconds: number): ExpeditionRoute[] | null {
  if (!result || result.version !== 1 || !Number.isFinite(seconds) || seconds < 0 || seconds > 172800
    || !Number.isInteger(result.restored) || !Number.isInteger(result.discovered)
    || result.restored < 0 || result.discovered < 0
    || result.completed !== result.restored + result.discovered || result.completed > 5760
    || result.restored * 30 + result.discovered * 40 > seconds + 1
    || !Array.isArray(result.discoveries) || result.discoveries.length !== result.discovered
    || !result.discoveries.every(item => typeof item === 'string')
    || !Array.isArray(result.choices) || result.choices.length < result.completed
    || result.choices.length > result.completed + 1 || result.choices.length === 0) return null;
  const routes: ExpeditionRoute[] = [];
  for (let i = 0; i < result.choices.length; i++) {
    const choice = result.choices[i];
    if (!choice || choice.stage !== i + 1 || !isRoute(choice.route)
      || !Number.isFinite(choice.second) || choice.second < 0 || choice.second > seconds + 1
      || (i === 0 && choice.second !== 0)) return null;
    if (i < result.completed) {
      const next = result.choices[i + 1];
      const end = next ? next.second : seconds;
      // Only final ride duration may be rounded to an integer by persistence.
      if (!Number.isFinite(end) || end - choice.second + (next ? 1e-7 : 1) < duration(choice.route)) return null;
      routes.push(choice.route);
    }
  }
  if (routes.filter(route => route === 'restore').length !== result.restored) return null;
  return routes;
}

/** A directed three-stop chapter: access -> use of that access -> permanent chapter outcome. */
function options(chapter: number, path: ExpeditionRoute[]): Record<ExpeditionRoute, JourneyChoice> {
  const theme = themes[(chapter - 1) % themes.length];
  const make = (variant: JourneyVariant, title: string, consequence: string, suffix = ''): JourneyChoice => ({
    variant, title, consequence, destination: `${theme[variant]}${suffix}`,
  });
  if (!path.length) return {
    restore: make('bridge', 'Bygg forbindelsen', `Åpner veien til ${theme.beacon} eller ${theme.garden}.`),
    explore: make('vault', 'Åpne den skjulte veien', `Åpner ${theme.vault}: velg deretter frøbanken eller dyparkivet.`),
  };
  if (path.length === 1) return path[0] === 'restore' ? {
    restore: make('beacon', 'Send et signal', 'Finalen blir et nettverk av fyr eller en ny bro mot horisonten.'),
    explore: make('garden', 'Følg livet over broen', 'Finalen blir en levende hage eller et arkiv for frøene.'),
  } : {
    restore: make('garden', 'Vekk frøbanken', 'Finalen blir et levende tilfluktssted eller en bro ut av arkivet.', ' · frøbanken'),
    explore: make('vault', 'Les dyparkivet', 'Finalen blir et minnefyr eller et bevart kart over den tapte byen.', ' · dyparkivet'),
  };
  const key = path.join('/');
  if (key === 'restore/restore') return {
    restore: make('beacon', 'Tenn hele nettverket', 'Kapittelet ender med et tent fyrnettverk.', ' · nettverket'),
    explore: make('bridge', 'Følg signalet videre', 'Kapittelet ender med en ny forbindelse over horisonten.', ' · horisonten'),
  };
  if (key === 'restore/explore') return {
    restore: make('garden', 'La hagen vokse', 'Kapittelet ender med en levende takhage.', ' · blomstring'),
    explore: make('vault', 'Bevar frøene', 'Kapittelet ender med en ny frøsamling i arkivet.', ' · frøsamlingen'),
  };
  if (key === 'explore/restore') return {
    restore: make('garden', 'Bygg et tilfluktssted', 'Kapittelet ender med et levende tilfluktssted.', ' · tilflukt'),
    explore: make('bridge', 'Gi livet en vei ut', 'Kapittelet ender med en grønn forbindelse ut av arkivet.', ' · grønn korridor'),
  };
  return {
    restore: make('beacon', 'Løft minnene frem', 'Kapittelet ender med et fyr som bærer byens minner.', ' · minnefyret'),
    explore: make('vault', 'Fullfør bykartet', 'Kapittelet ender med et bevart kart over den tapte byen.', ' · bykartet'),
  };
}

/** Pure replay; history excludes the current live ride. Demo previews never borrow saved progress. */
export function journeyFor(history: RideRecord[], world: WorldId, live?: ExpeditionState, demo = false): JourneyProgress {
  const routes: ExpeditionRoute[] = [];
  let savedRoute: ExpeditionRoute = 'restore';
  const seen = new Set<string>();
  const timestamp = (ride: RideRecord) => Date.parse(ride.startedAt || ride.date);
  const chronological = demo ? [] : history.filter(ride => ride && typeof ride.id === 'string' && ride.id
    && ride.demo === false && ride.worldId === world && Number.isFinite(timestamp(ride)))
    .slice().sort((a, b) => timestamp(a) - timestamp(b) || a.id.localeCompare(b.id));
  for (const ride of chronological) {
    if (seen.has(ride.id)) continue;
    const completed = validChoices(ride.expedition, ride.seconds);
    if (!completed) continue;
    seen.add(ride.id);
    routes.push(...completed);
    savedRoute = ride.expedition!.choices.at(-1)!.route;
  }
  const liveRoutes = live?.worldId === world ? validChoices(live, live.elapsed) : null;
  if (liveRoutes) routes.push(...liveRoutes);
  let chapter = 1;
  let path: ExpeditionRoute[] = [];
  const log: JourneyProgress['log'] = [];
  for (const route of routes) {
    const destination = options(chapter, path)[route];
    log.push({ name: destination.destination, route, variant: destination.variant, chapter });
    if (log.length > 12) log.shift();
    path.push(route);
    if (path.length === 3) { chapter++; path = []; }
  }
  const choices = options(chapter, path);
  const route = liveRoutes && live && isRoute(live.route) ? live.route : savedRoute;
  const selected = choices[route];
  const progress = liveRoutes && live && !live.choiceOpen && Number.isFinite(live.charge)
    ? Math.max(0, Math.min(1, live.charge)) : 0;
  return {
    chapter, chapterName: themes[(chapter - 1) % themes.length].name, step: path.length + 1,
    destination: selected.destination, route, variant: selected.variant,
    completed: routes.length, progress, eventSerial: routes.length, choices, log, demo,
    nextGoal: `${selected.destination}: ${duration(route)} målsekunder innenfor ±10 % av øktens wattmål.`,
  };
}

/** Historical receipt at this ride, unaffected by sessions saved later. */
export function journeyForRide(history: RideRecord[], ride: RideRecord): JourneyProgress {
  const world = ride.worldId || 'neon';
  if (ride.demo) {
    const preview = journeyFor([{ ...ride, demo: false }], world);
    return { ...preview, demo: true };
  }
  const targetTime = Date.parse(ride.startedAt || ride.date);
  const preceding = history.filter(item => {
    if (item.id === ride.id) return false;
    const time = Date.parse(item.startedAt || item.date);
    return time < targetTime || (time === targetTime && item.id.localeCompare(ride.id) < 0);
  });
  return journeyFor([...preceding, ride], world);
}
