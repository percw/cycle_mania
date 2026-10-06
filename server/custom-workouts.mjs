// Keep validation limits aligned with src/customWorkouts.ts; parity is tested.
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const safeId = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
const label = (v, max, required = true) => typeof v === 'string' && v.length <= max && (!required || v.trim()) ? v.trim() : fail('Skriv et gyldig navn eller en kortere beskrivelse.');
const seconds = s => Math.max(1, Math.round(s.value * (s.unit === 'minutes' ? 60 : s.unit === 'kilometers' ? 120 : s.unit === 'meters' ? 0.12 : 1)));
function step(v) {
  if (!object(v) || !['seconds', 'minutes', 'meters', 'kilometers'].includes(v.unit)) return fail('Velg sekunder, minutter, meter eller kilometer.');
  const multiplier = v.unit === 'minutes' ? 60 : v.unit === 'kilometers' ? 1000 : 1;
  if (!finite(v.value, 0, 1440000) || v.value * multiplier < 1 || ((v.unit === 'meters' || v.unit === 'kilometers') && v.value * multiplier > 1440000) || !finite(v.intensity, 0.05, 3)) return fail('Varighet må være minst 1 sekund eller 1 meter, og intensitet 5–300 % FTP.');
  const result = { value: v.value, unit: v.unit, intensity: v.intensity };
  if (seconds(result) > 172800) return fail('Et steg kan ikke være lengre enn 48 timer.');
  return result;
}
export function validateCustomWorkout(input) {
  if (!object(input) || input.version !== 1 || !safeId(input.id)) return fail('Ugyldig format eller ID for egen økt.');
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 30) return fail('Økten må ha mellom 1 og 30 grupper.');
  const seen = new Set();
  const groups = input.groups.map(v => {
    if (!object(v) || !safeId(v.id) || seen.has(v.id)) return fail('Hver gruppe må ha en unik ID.');
    seen.add(v.id);
    if (!finite(v.sets, 1, 30) || !Number.isInteger(v.sets) || !finite(v.reps, 1, 100) || !Number.isInteger(v.reps)) return fail('Velg 1–30 serier og 1–100 drag per serie.');
    return { id: v.id, name: label(v.name, 100), sets: v.sets, reps: v.reps, work: step(v.work), recovery: v.recovery === null ? null : step(v.recovery), setRecovery: v.setRecovery === null ? null : step(v.setRecovery) };
  });
  const draft = { version: 1, id: input.id, name: label(input.name, 200), description: label(input.description, 2000, false), warmup: input.warmup === null ? null : step(input.warmup), cooldown: input.cooldown === null ? null : step(input.cooldown), groups };
  let blockCount = Number(!!draft.warmup) + Number(!!draft.cooldown);
  let total = (draft.warmup ? seconds(draft.warmup) : 0) + (draft.cooldown ? seconds(draft.cooldown) : 0);
  for (const [index, g] of groups.entries()) {
    const pauses = g.sets - 1 + Number(index < groups.length - 1);
    blockCount += g.sets * (g.reps + (g.recovery ? g.reps - 1 : 0)) + (g.setRecovery ? pauses : 0);
    total += g.sets * (g.reps * seconds(g.work) + (g.recovery ? (g.reps - 1) * seconds(g.recovery) : 0)) + (g.setRecovery ? pauses * seconds(g.setRecovery) : 0);
  }
  if (blockCount > 1500) return fail('Økten kan ha maksimalt 1500 steg. Reduser antall serier eller drag.');
  if (total > 172800) return fail('Samlet estimert varighet kan ikke overstige 48 timer.');
  return draft;
}
export function createWorkoutStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS custom_workouts (id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const select = db.prepare('SELECT draft_json FROM custom_workouts ORDER BY updated_at DESC, id');
  const upsert = db.prepare('INSERT INTO custom_workouts (id, draft_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at');
  const del = db.prepare('DELETE FROM custom_workouts WHERE id = ?');
  return {
    list() { return select.all().map(row => validateCustomWorkout(JSON.parse(row.draft_json))); },
    save(input) { const draft = validateCustomWorkout(input); upsert.run(draft.id, JSON.stringify(draft), new Date().toISOString()); return draft; },
    remove(id) { if (!safeId(id)) fail('Ugyldig ID for egen økt.'); return Number(del.run(id).changes) > 0; },
  };
}
