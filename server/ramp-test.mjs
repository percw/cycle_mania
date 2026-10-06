const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

/** Retain the test protocol used on this ride; estimates are recomputed from samples. */
export function validateRampTestMetadata(value, result) {
  if (value.rampTest === undefined) {
    if (typeof value.workoutId === 'string' && value.workoutId.startsWith('ramp-v1-')) invalid('Rampetesten mangler testprotokoll.');
    return result;
  }
  const test = value.rampTest;
  if (!object(test) || test.version !== 1 || !object(test.protocol)) invalid('Ugyldig rampetest.');
  const protocol = test.protocol;
  if (protocol.version !== 1 || protocol.stageSeconds !== 60 || protocol.warmupSeconds !== 300
    || protocol.cooldownSeconds !== 180 || protocol.maxStages !== 40) invalid('Ugyldig rampetestprotokoll.');
  if (!Number.isInteger(protocol.startWatts) || !finite(protocol.startWatts, 25, 250)
    || !Number.isInteger(protocol.stepWatts) || !finite(protocol.stepWatts, 5, 40)) invalid('Ugyldige watt-trinn i rampetesten.');
  if (value.workoutId !== `ramp-v1-${protocol.startWatts}-${protocol.stepWatts}`) invalid('Rampetestens ID stemmer ikke med protokollen.');
  if (!finite(test.referenceFtp, 50, 600) || test.referenceFtp !== value.ftp) invalid('Rampetestens referanse-FTP stemmer ikke med økten.');
  if (!finite(test.endSecond, 0, Math.min(value.seconds, protocol.warmupSeconds + protocol.maxStages * protocol.stageSeconds))
    || value.seconds > test.endSecond + protocol.cooldownSeconds + 1) invalid('Rampetestens sluttid stemmer ikke med økten.');
  if (!['exhaustion', 'aborted', 'ceiling'].includes(test.reason) || typeof test.interrupted !== 'boolean') invalid('Ugyldig avslutning av rampetesten.');
  if (test.reason === 'ceiling' && test.endSecond !== protocol.warmupSeconds + protocol.maxStages * protocol.stageSeconds) invalid('Rampetesten har ikke nådd siste trinn.');
  if (['workoutSnapshot', 'blockSeconds', 'blockMeters', 'skippedBlocks'].some(key => value[key] !== undefined)
    || value.samples?.some(sample => sample.blockIndex !== undefined)) invalid('Rampetest kan ikke kombineres med en egendefinert øktplan.');
  result.rampTest = {
    version: 1,
    protocol: Object.fromEntries(['version', 'startWatts', 'stepWatts', 'stageSeconds', 'warmupSeconds', 'cooldownSeconds', 'maxStages'].map(key => [key, protocol[key]])),
    referenceFtp: test.referenceFtp, endSecond: test.endSecond, reason: test.reason, interrupted: test.interrupted,
  };
  return result;
}
