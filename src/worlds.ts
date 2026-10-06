import type { WorkoutBlock } from "./training";
import type { ExpeditionVisual } from './expedition';
import type { JourneyVisual } from './journey';
export type WorldId = "tron" | "neon" | "sky" | "vestland" | "fjord" | "alpine" | "midnight";
export interface WorldVisualState {
  charge: number;
  combo: number;
  score: number;
  phase: WorkoutBlock["kind"];
  blockProgress: number;
  accuracy: number;
  eventSerial: number;
  quality: "locked" | "low" | "high" | "idle";
  elapsed: number;
  ghostDelta?: number;
}
export interface WorldSceneProps {
  achievements?: string[];
  expedition?: ExpeditionVisual;
  journey?: JourneyVisual;
  running: boolean;
  speed: number;
  progress: number;
  zoneColor: string;
  onRenderer?: (name: string) => void;
  onSector?: (index: number) => void;
  game: WorldVisualState;
}
export const worlds: {
  id: WorldId;
  name: string;
  subtitle: string;
  length: string;
  color: string;
  eyebrow: string;
  genre: string;
  description: string;
  sectors: string[];
  mission: string;
  reward: string;
}[] = [
  {
    id: "vestland",
    name: "Vestlandsveien",
    subtitle: "En stille morgen langs fjorden.",
    length: "8,4 km virtuell rundløype",
    color: "#bccd91",
    eyebrow: "VESTLANDET / MORGENLYS VED FJORDEN",
    genre: "NATUR · LANDEVEI · RYTME",
    description:
      "Smal asfalt, bjørkeskog og små bygder under bratte fjell. En naturtro, oppdiktet rute inspirert av Vestlandet, med øktplanen som følgesvenn.",
    sectors: ["Fjordkanten", "Bjørkelia", "Bygda"],
    mission: "Finn rytmen langs fjorden",
    reward: "FLYT",
  },
  {
    id: "tron", name: "TRON / The Grid", subtitle: "Din presisjon. Ditt lysspor.",
    length: "Lysløypen", color: "#62efff", eyebrow: "THE GRID / PROGRAM ONLINE",
    genre: "LYSSYKKEL · PRESISJON · PRESTASJON",
    description: "Svart grid, cyan lys og en ren lyssykkel. Følg wattmålet og lås opp detaljer gjennom dokumenterte treningsprestasjoner.",
    sectors: ["Grid Arena", "Datatunnelen", "Lysbroen"], mission: "Mestre øktplanen", reward: "PRESISJON",
  },
  {
    id: "neon",
    name: "Neon Rush",
    subtitle: "Finn frekvensen. Tenn hele byen.",
    length: "Endeløs arkade",
    color: "#63edf3",
    eyebrow: "NOVA CITY / ÅR 2186",
    genre: "FART · FLYT · PERSONLIG REKORD",
    description:
      "En svevesykkel, en by uten strøm og ett perfekt løp. Lad energikjeder, aktiver portaler og jakt på ditt eget rekordløp.",
    sectors: ["Neonbyen", "Pulstunnelen", "Orbitalbroen"],
    mission: "Gi byen energi",
    reward: "ENERGIPULS",
  },
  {
    id: "sky",
    name: "Skybound",
    subtitle: "Vekk en verden over skyene.",
    length: "Et svevende eventyr",
    color: "#f2d57b",
    eyebrow: "AERIA / DE GLEMTE ØYENE",
    genre: "UTFORSKING · UNDRING · MESTRING",
    description:
      "Følg vindveien gjennom glemte øyriker. Nøyaktige drag vekker krystallene, tenner templene og sender deg videre over skyhavet.",
    sectors: ["Vindlunden", "Fosseøyene", "Stjerneporten"],
    mission: "Vekk øyriket",
    reward: "LYSFRØ",
  },
  {
    id: "fjord",
    name: "Fjordveien",
    subtitle: "Mellom fjell og åpent hav",
    length: "8,4 km rundløype",
    color: "#80c9b3",
    eyebrow: "NORGE / FRIHET PÅ TO HJUL",
    genre: "DEN KLASSISKE TUREN",
    description:
      "Fjorden, fjellene og rytmen fra pedalene. Den opprinnelige verdenen, med samme intervallmål og valgfri spillprogresjon.",
    sectors: ["Fjorden", "Fjellpasset", "Kystveien"],
    mission: "Finn din flyt",
    reward: "FLYTPULS",
  },
  {
    id: "alpine",
    name: "Høyfjell",
    subtitle: "Over skyene. Nærmere toppen.",
    length: "8,4 km rundløype",
    color: "#c9bd9b",
    eyebrow: "NORGE / OVER TREGRENSEN",
    genre: "KLASSISK · HØYFJELL",
    description: "Fjordløypens lyse høyfjellsstemning.",
    sectors: ["Dalen", "Fjellpasset", "Toppen"],
    mission: "Finn din flyt",
    reward: "FLYTPULS",
  },
  {
    id: "midnight",
    name: "Midnattssol",
    subtitle: "En runde under den lyse nattehimmelen",
    length: "8,4 km rundløype",
    color: "#c3a8d7",
    eyebrow: "NORGE / DEN LYSE NATTEN",
    genre: "KLASSISK · KVELDSTUR",
    description: "Fjordløypen i kveldens rolige farger.",
    sectors: ["Fjorden", "Fjellpasset", "Nattkysten"],
    mission: "Finn din flyt",
    reward: "FLYTPULS",
  },
];
export function worldById(id: unknown) {
  return worlds.find((w) => w.id === id) ?? worlds.find(w=>w.id==='neon')!;
}
export const idleVisual: WorldVisualState = {
  charge: 0.28,
  combo: 0,
  score: 0,
  phase: "warmup",
  blockProgress: 0,
  accuracy: 1,
  eventSerial: 0,
  quality: "idle",
  elapsed: 0,
};
