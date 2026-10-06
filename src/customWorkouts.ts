import type { Workout, WorkoutBlock } from './training';

export type DurationUnit = 'seconds' | 'minutes' | 'meters' | 'kilometers';
export type BuilderStep = { value: number; unit: DurationUnit; intensity: number };
export type IntervalGroup = { id: string; name: string; sets: number; reps: number; work: BuilderStep; recovery: BuilderStep | null; setRecovery: BuilderStep | null };
export type CustomWorkoutDraft = { version: 1; id: string; name: string; description: string; warmup: BuilderStep | null; cooldown: BuilderStep | null; groups: IntervalGroup[] };
export type CustomTemplateId = '6x6-40-40' | '3x13-30-15' | '8x4' | 'blank';
export const customTemplates: { id: CustomTemplateId; name: string; description: string }[] = [
  { id: '6x6-40-40', name: '6 × 6 × 40/40', description: 'Seks serier med seks 40-sekundersdrag. 40 sekunder mellom drag og 3 minutter mellom serier.' },
  { id: '3x13-30-15', name: '3 × 13 × 30/15', description: 'Tre serier med tretten 30-sekundersdrag. 15 sekunder mellom drag og 3 minutter mellom serier.' },
  { id: '8x4', name: '8 × 4 min', description: 'Åtte fireminuttersdrag med 2 minutter rolig mellom dragene.' },
  { id: 'blank', name: 'Fra bunnen', description: 'Bygg din egen kombinasjon av tid, distanse, drag og serier.' },
];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const step = (value: number, unit: DurationUnit, intensity: number): BuilderStep => ({ value, unit, intensity });
export function createCustomWorkout(template: CustomTemplateId = 'blank'): CustomWorkoutDraft {
  const preset = customTemplates.find(item => item.id === template) ?? customTemplates[3];
  const micro = template === '6x6-40-40' || template === '3x13-30-15';
  return { version: 1, id: uid(), name: template === 'blank' ? 'Min økt' : preset.name, description: preset.description,
    warmup: step(10, 'minutes', 0.55), cooldown: step(5, 'minutes', 0.45),
    groups: [{ id: uid(), name: 'Hoveddel', sets: template === '6x6-40-40' ? 6 : template === '3x13-30-15' ? 3 : 1,
      reps: template === '6x6-40-40' ? 6 : template === '3x13-30-15' ? 13 : template === '8x4' ? 8 : 1,
      work: step(micro ? (template === '6x6-40-40' ? 40 : 30) : 4, micro ? 'seconds' : 'minutes', micro ? 1.15 : 1),
      recovery: step(micro ? (template === '6x6-40-40' ? 40 : 15) : 2, micro ? 'seconds' : 'minutes', 0.5),
      setRecovery: micro ? step(3, 'minutes', 0.5) : null }] };
}
/** Distance blocks use an explicit preview estimate of 30 km/h, never a runtime deadline. */
export function stepSeconds(item: BuilderStep): number {
  const seconds = item.value * (item.unit === 'minutes' ? 60 : item.unit === 'kilometers' ? 120 : item.unit === 'meters' ? 0.12 : 1);
  return Math.max(1, Math.round(seconds));
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const fail = (message: string): never => { throw new Error(message); };
function label(v: unknown, max: number, required = true): string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) return fail('Skriv et gyldig navn eller en kortere beskrivelse.');
  return v.trim();
}
function validateStep(v: unknown): BuilderStep {
  if (!object(v) || !['seconds', 'minutes', 'meters', 'kilometers'].includes(String(v.unit))) return fail('Velg sekunder, minutter, meter eller kilometer.');
  const unit = v.unit as DurationUnit;
  const multiplier = unit === 'minutes' ? 60 : unit === 'kilometers' ? 1000 : 1;
  if (!finite(v.value, 0, 1440000) || v.value * multiplier < 1 || ((unit === 'meters' || unit === 'kilometers') && v.value * multiplier > 1440000) || !finite(v.intensity, 0.05, 3)) return fail('Varighet må være minst 1 sekund eller 1 meter, og intensitet 5–300 % FTP.');
  const result = { value: v.value, unit, intensity: v.intensity };
  if (stepSeconds(result) > 172800) return fail('Et steg kan ikke være lengre enn 48 timer.');
  return result;
}
export function validateCustomWorkout(input: unknown): CustomWorkoutDraft {
  if (!object(input) || input.version !== 1 || !safeId(input.id)) return fail('Ugyldig format eller ID for egen økt.');
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 30) return fail('Økten må ha mellom 1 og 30 grupper.');
  const seen = new Set<string>();
  const groups = input.groups.map(v => {
    if (!object(v) || !safeId(v.id) || seen.has(v.id)) return fail('Hver gruppe må ha en unik ID.');
    seen.add(v.id);
    if (!finite(v.sets, 1, 30) || !Number.isInteger(v.sets) || !finite(v.reps, 1, 100) || !Number.isInteger(v.reps)) return fail('Velg 1–30 serier og 1–100 drag per serie.');
    return { id: v.id, name: label(v.name, 100), sets: v.sets, reps: v.reps, work: validateStep(v.work),
      recovery: v.recovery === null ? null : validateStep(v.recovery), setRecovery: v.setRecovery === null ? null : validateStep(v.setRecovery) };
  });
  const draft: CustomWorkoutDraft = { version: 1, id: input.id, name: label(input.name, 200), description: label(input.description, 2000, false),
    warmup: input.warmup === null ? null : validateStep(input.warmup), cooldown: input.cooldown === null ? null : validateStep(input.cooldown), groups };
  let blocks = Number(!!draft.warmup) + Number(!!draft.cooldown);
  let seconds = (draft.warmup ? stepSeconds(draft.warmup) : 0) + (draft.cooldown ? stepSeconds(draft.cooldown) : 0);
  for (const [index, g] of groups.entries()) {
    const setPauses = g.sets - 1 + Number(index < groups.length - 1);
    blocks += g.sets * (g.reps + (g.recovery ? g.reps - 1 : 0)) + (g.setRecovery ? setPauses : 0);
    seconds += g.sets * (g.reps * stepSeconds(g.work) + (g.recovery ? (g.reps - 1) * stepSeconds(g.recovery) : 0)) + (g.setRecovery ? setPauses * stepSeconds(g.setRecovery) : 0);
  }
  if (blocks > 1500) return fail('Økten kan ha maksimalt 1500 steg. Reduser antall serier eller drag.');
  if (seconds > 172800) return fail('Samlet estimert varighet kan ikke overstige 48 timer.');
  return draft;
}
function revision(text: string): string {
  // Two independent 32-bit accumulators provide a compact, deterministic revision ID.
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function compileCustomWorkout(input: CustomWorkoutDraft): Workout {
  const draft = validateCustomWorkout(input);
  const blocks: WorkoutBlock[] = [];
  const add = (label: string, item: BuilderStep, kind: WorkoutBlock['kind']) => blocks.push({ label, kind, seconds: stepSeconds(item), intensity: item.intensity,
    ...(item.unit === 'meters' || item.unit === 'kilometers' ? { distanceMeters: item.value * (item.unit === 'kilometers' ? 1000 : 1) } : {}) });
  if (draft.warmup) add('Oppvarming', draft.warmup, 'warmup');
  for (const [groupIndex, g] of draft.groups.entries()) for (let set = 0; set < g.sets; set++) {
    for (let rep = 0; rep < g.reps; rep++) {
      const prefix = `${g.name}${g.sets > 1 ? ` · serie ${set + 1}/${g.sets}` : ''}`;
      add(`${prefix} · drag ${rep + 1}/${g.reps}`, g.work, 'work');
      if (rep < g.reps - 1 && g.recovery) add(`${prefix} · pause`, g.recovery, 'recovery');
    }
    if ((set < g.sets - 1 || groupIndex < draft.groups.length - 1) && g.setRecovery) add(`${g.name} · seriepause`, g.setRecovery, 'recovery');
  }
  if (draft.cooldown) add('Nedkjøring', draft.cooldown, 'cooldown');
  const peak = Math.max(...blocks.filter(b => b.kind === 'work').map(b => b.intensity));
  return { id: `custom-${draft.id}-${revision(JSON.stringify({ name: draft.name, description: draft.description, blocks }))}`, name: draft.name,
    subtitle: `${blocks.filter(b => b.kind === 'work').length} drag · Egen økt`, category: 'Egne økter', description: draft.description,
    difficulty: peak > 1.05 ? 3 : peak > 0.8 ? 2 : 1, custom: true, blocks };
}
/** Strict snapshot validation for restoring a custom workout even after its template is deleted. */
export function validateWorkoutSnapshot(input: unknown): Workout {
  if (!object(input) || typeof input.id !== 'string' || !/^custom-[a-zA-Z0-9_-]{1,80}-[a-f0-9]{16}$/.test(input.id) || input.custom !== true
    || ![1, 2, 3].includes(Number(input.difficulty)) || typeof input.difficulty !== 'number' || !Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 1500) return fail('Ugyldig lagret øktoppsett.');
  const blocks = input.blocks.map(b => {
    if (!object(b) || !finite(b.seconds, 1, 172800) || !Number.isInteger(b.seconds) || !finite(b.intensity, 0.05, 3)
      || !['warmup', 'work', 'recovery', 'cooldown'].includes(String(b.kind)) || (b.distanceMeters !== undefined && !finite(b.distanceMeters, 1, 1440000))) return fail('Ugyldig steg i lagret øktoppsett.');
    return { label: label(b.label, 200), seconds: b.seconds, intensity: b.intensity, kind: b.kind as WorkoutBlock['kind'], ...(b.distanceMeters !== undefined ? { distanceMeters: b.distanceMeters as number } : {}) };
  });
  if (!blocks.some(b => b.kind === 'work') || blocks.reduce((sum, b) => sum + b.seconds, 0) > 172800) return fail('Ugyldig varighet i lagret øktoppsett.');
  return { id: input.id, name: label(input.name, 200), subtitle: label(input.subtitle, 300), category: label(input.category, 100), description: label(input.description, 2000, false), difficulty: input.difficulty as 1 | 2 | 3, custom: true, blocks };
}
