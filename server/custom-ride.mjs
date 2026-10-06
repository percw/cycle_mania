const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

/** Copy only validated immutable plan and execution metadata into the clean ride. */
export function validateCustomRideMetadata(value, result) {
  const fields = ['workoutSnapshot', 'blockSeconds', 'blockMeters', 'skippedBlocks'];
  const hasIndices = Array.isArray(value.samples) && value.samples.some(sample => sample?.blockIndex !== undefined);
  if (!fields.some(field => value[field] !== undefined) && !hasIndices) return result;
  const plan = value.workoutSnapshot;
  if (!object(plan) || plan.custom !== true) invalid('Egendefinert gjennomføring krever en gyldig kopi av øktplanen.');
  const clean = { custom: true };
  for (const [key, max] of [['id', 128], ['name', 200], ['subtitle', 500], ['category', 100], ['description', 4000]]) {
    if (typeof plan[key] !== 'string' || plan[key].length > max || ((key === 'id' || key === 'name') && !plan[key].trim())) invalid(`Ugyldig øktplan: ${key}.`);
    clean[key] = plan[key];
  }
  if (value.workoutId !== undefined && value.workoutId !== plan.id) invalid('Øktplanen har en annen ID enn økten.');
  if (![1, 2, 3].includes(plan.difficulty)) invalid('Ugyldig vanskelighetsgrad i øktplanen.');
  clean.difficulty = plan.difficulty;
  if (!Array.isArray(plan.blocks) || plan.blocks.length < 1 || plan.blocks.length > 1500) invalid('Øktplanen må ha mellom 1 og 1500 deler.');
  clean.blocks = plan.blocks.map(block => {
    if (!object(block) || typeof block.label !== 'string' || block.label.length < 1 || block.label.length > 200
      || !['warmup', 'work', 'recovery', 'cooldown'].includes(block.kind)
      || !finite(block.seconds, Number.MIN_VALUE, 172800) || !finite(block.intensity, 0.05, 3)) invalid('Ugyldig del i øktplanen.');
    const copy = { label: block.label, kind: block.kind, seconds: block.seconds, intensity: block.intensity };
    if (block.distanceMeters !== undefined) {
      if (!finite(block.distanceMeters, 1, 1440000)) invalid('Ugyldig distanse i øktplanen.');
      copy.distanceMeters = block.distanceMeters;
    }
    return copy;
  });
  if (clean.blocks.reduce((sum, block) => sum + block.seconds, 0) > 172800) invalid('Øktplanen overskrider maksimal varighet.');
  result.workoutSnapshot = clean;
  for (const field of ['blockSeconds', 'blockMeters']) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field]) || value[field].length !== clean.blocks.length
      || !value[field].every(number => finite(number, 0, field === 'blockSeconds' ? value.seconds + 1 : 10000000))) invalid(`Ugyldig gjennomføring: ${field}.`);
    const total = value[field].reduce((sum, number) => sum + number, 0);
    if (field === 'blockSeconds' && total > value.seconds + 1) invalid('Tid per del overskrider øktens varighet.');
    // Ride distance uses kilometres, block distances use virtual metres.
    if (field === 'blockMeters' && total > value.distance * 1000 + 1) invalid('Distanse per del overskrider øktens distanse.');
    result[field] = [...value[field]];
  }
  if (value.skippedBlocks !== undefined) {
    if (!Array.isArray(value.skippedBlocks) || value.skippedBlocks.length > clean.blocks.length
      || !value.skippedBlocks.every(index => Number.isInteger(index) && index >= 0 && index < clean.blocks.length)
      || new Set(value.skippedBlocks).size !== value.skippedBlocks.length) invalid('Ugyldige hopp i øktplanen.');
    result.skippedBlocks = [...value.skippedBlocks];
  }
  let previousIndex = -1;
  for (let index = 0; index < (value.samples?.length ?? 0); index++) {
    const blockIndex = value.samples[index].blockIndex;
    if (blockIndex === undefined) continue;
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= clean.blocks.length || blockIndex < previousIndex) invalid('Ugyldig plassering av effektmåling i øktplanen.');
    previousIndex = blockIndex;
    if (!result.samples?.[index]) invalid('Effektmåling mangler validering.');
    result.samples[index].blockIndex = blockIndex;
  }
  return result;
}
