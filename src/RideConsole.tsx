import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronsDown, ChevronsUp, Eye, EyeOff, Maximize, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { formatTime, getZone, workoutDuration, zones, type Workout, type getWorkoutState } from './training';
import type { GameState } from './game';
import { blockHeight, blockStarts, blockStats, gaugePosition, GAUGE_SPAN, smoothedPower, TARGET_BAND, targetFeedback, tracePath, type CockpitSample, type TargetState } from './cockpit';
import { playCountdown } from './gameSound';
import './cockpit.css';

type Current = ReturnType<typeof getWorkoutState> & { remainingMeters?: number };

const zoneColor = (intensity: number) => zones[getZone(intensity * 100, 100).id - 1]?.color ?? '#8ea7ba';
const meters = (value: number) => `${Math.max(0, Math.ceil(value)).toLocaleString('nb-NO')} m`;

/** Display-only 3 s power, like a head unit. Recorded samples stay raw. */
function useSmoothedPower(power: number | undefined) {
  const readings = useRef<{ at: number; power: number }[]>([]);
  const now = performance.now();
  if (power === undefined) readings.current = [];
  else {
    const last = readings.current.at(-1);
    if (!last || last.power !== power) readings.current.push({ at: now, power });
    readings.current = readings.current.filter((r, i, all) => (all[i + 1]?.at ?? now) >= now - 3000);
  }
  return power === undefined ? undefined : smoothedPower(readings.current, now);
}

function TargetGauge({ power, target, state }: { power: number | undefined; target: number; state: TargetState }) {
  const band = TARGET_BAND / (GAUGE_SPAN * 2);
  return <div className={`target-gauge ${state}`} role="meter" aria-label="Watt mot målområdet"
    aria-valuemin={Math.round(target * (1 - GAUGE_SPAN))} aria-valuemax={Math.round(target * (1 + GAUGE_SPAN))} aria-valuenow={power ?? undefined}>
    <div className="gauge-track" style={{ ['--band' as string]: `${band * 100}%` }}>
      <span className="gauge-under" /><span className="gauge-band" /><span className="gauge-over" />
      {power !== undefined && <i className="gauge-marker" style={{ left: `${gaugePosition(power, target) * 100}%` }} />}
    </div>
    <div className="gauge-scale" aria-hidden="true">
      <span style={{ left: `${(0.5 - band) * 100}%` }}>{Math.round(target * (1 - TARGET_BAND))}</span>
      <span style={{ left: `${(0.5 + band) * 100}%` }}>{Math.round(target * (1 + TARGET_BAND))}</span>
    </div>
  </div>;
}

function WorkoutGraph({ workout, samples, ftp, progress, index }: { workout: Workout; samples: CockpitSample[]; ftp: number; progress: number; index: number }) {
  const total = Math.max(1, workoutDuration(workout));
  const maxIntensity = Math.max(1.2, ...workout.blocks.map(b => b.intensity));
  const starts = useMemo(() => blockStarts(workout), [workout]);
  // samples is a fresh array every tick; its length is what changes the trace.
  const trace = useMemo(() => tracePath(workout, samples, ftp, maxIntensity), [workout, samples.length, ftp, maxIntensity]);
  const gap = total * 0.0018;
  const playhead = Math.min(1, Math.max(0, progress)) * total;
  // Colour the measured trace by training zone: a zone boundary at k×FTP sits at y = 100 − k/max·92.
  const gradientId = useId().replace(/:/g, '');
  const zoneStops = useMemo(() => {
    const y = (k: number) => Math.max(0, Math.min(100, 100 - (k / maxIntensity) * 92)) / 100;
    return zones.flatMap((z, i) => {
      const lower = i ? zones[i - 1].max : 0, upper = Number.isFinite(z.max) ? z.max : 9;
      return [{ offset: y(upper), color: z.color, zone: i }, { offset: y(lower), color: z.color, zone: i }];
    }).sort((a, b) => a.offset - b.offset || b.zone - a.zone);
  }, [maxIntensity]);
  return <div className="console-profile cockpit-graph" aria-label="Øktgraf: planlagte mål og faktisk watt">
    <svg viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
        {zoneStops.map((stop, i) => <stop key={i} offset={stop.offset} stopColor={stop.color} />)}
      </linearGradient></defs>
      {workout.blocks.map((block, i) => {
        const h = blockHeight(block, maxIntensity);
        const w = Math.max(gap, block.seconds - gap), state = i < index ? 'past' : i === index ? 'now' : 'future';
        // Neutral bodies with a zone-coloured cap: low-opacity zone fills turn muddy on dark glass.
        return <g key={i} className={state}>
          <rect x={starts[i]} y={100 - h} width={w} height={h} className="block-body" style={state === 'now' ? { fill: zoneColor(block.intensity) } : undefined} />
          {state !== 'now' && <rect x={starts[i]} y={100 - h} width={w} height={Math.min(h, 5)} className="block-cap" fill={zoneColor(block.intensity)} />}
        </g>;
      })}
      {trace && <path d={trace} className="graph-trace" style={{ stroke: `url(#${gradientId})` }} vectorEffect="non-scaling-stroke" />}
      <line x1={playhead} x2={playhead} y1={0} y2={100} className="graph-playhead" vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="graph-marker" style={{ left: `${(playhead / total) * 100}%` }} />
  </div>;
}

export default function RideConsole({ workout, current, elapsed, skippedSeconds, target, power: livePower, cadence, heartRate, energy, running, sound, game, ghostDelta,
  speedKmh, sceneKm, arcade, rampStatus, erg, samples, ftp, focus, onFocus, onPause, onSkip, onWarmup, onSound, onFullscreen, onFinish }: {
  workout: Workout; current: Current; elapsed: number; skippedSeconds: number; distance: number; energy: number;
  /** On-screen speed and distance for this world (arcade worlds exaggerate; recorded data does not). */
  speedKmh: number; sceneKm: number; arcade: boolean;
  target: number; power: number | undefined; cadence: number | null | undefined; heartRate: number | null | undefined; running: boolean; sound: boolean; game: GameState; ghostDelta?: number | null;
  rampStatus?: {interrupted:boolean;belowTargetSeconds:number;ended:boolean};
  /** Automatic resistance is holding the trainer: the cue informs instead of instructing. */
  erg?: { status: 'pending' | 'on' | 'error'; watts?: number } | null;
  samples: CockpitSample[]; ftp: number; focus: boolean; onFocus: () => void;
  onPause: () => void; onSkip: () => void; onWarmup: () => void; onSound: () => void; onFullscreen: () => void; onFinish: () => void;
}) {
  const power = useSmoothedPower(livePower);
  const feedback = targetFeedback(power, target);
  const block = current.block;
  const next = workout.blocks[current.index + 1];
  const afterNext = workout.blocks[current.index + 2];
  const hasDistance = workout.blocks.some(b => b.distanceMeters !== undefined);
  const distanceRemaining = current.remainingMeters ?? block.distanceMeters;
  const ergOn = erg?.status === 'on';
  const soft = (block.kind !== 'work' && feedback.state === 'over') || (ergOn && (feedback.state === 'under' || feedback.state === 'over'));
  const live = useMemo(() => blockStats(workout, samples, current.index), [workout, samples.length, current.index]);
  const blockProgress = block.distanceMeters !== undefined && distanceRemaining !== undefined
    ? 1 - distanceRemaining / Math.max(1, block.distanceMeters)
    : 1 - current.remaining / Math.max(1, block.seconds);

  // 3-2-1 before the next block: big enough to read mid-effort, with the next target.
  const countdown = running && next && current.remainingMeters === undefined && current.remaining > 0 && current.remaining <= 5
    ? Math.ceil(current.remaining) : null;
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (sound && countdown !== null && countdown <= 3 && lastTick.current !== countdown) playCountdown(false);
    lastTick.current = countdown;
  }, [countdown, sound]);

  // Lap receipt after each work block that was actually ridden (skips stay silent).
  const previousIndex = useRef(current.index);
  const [lap, setLap] = useState<null | { label: string; avg: number; target: number; inBand?: number }>(null);
  useEffect(() => {
    const prev = previousIndex.current;
    previousIndex.current = current.index;
    if (current.index <= prev) return;
    const done = workout.blocks[prev];
    if (workout.ramp || !done || done.kind !== 'work' || done.seconds < 20) return;
    const stats = blockStats(workout, samples, prev);
    if (stats.coverage < 0.6 || stats.avgPower === undefined) return;
    setLap({ label: done.label, avg: stats.avgPower, target: Math.round(done.intensity * ftp), inBand: stats.inBand });
  }, [current.index]);
  useEffect(() => {
    if (!lap) return;
    const timer = setTimeout(() => setLap(null), 6000);
    return () => clearTimeout(timer);
  }, [lap]);

  const zone = getZone(block.intensity * 100, 100);
  const cue = !running ? 'Pauset' : feedback.state === 'none' ? 'Venter på watt'
    : feedback.state === 'on' ? 'I målområdet'
    : ergOn ? 'ERG justerer'
    : feedback.state === 'under' ? `Øk ${-feedback.delta} W` : `Senk ${feedback.delta} W`;
  const nextText = (b: Workout['blocks'][number]) => `${b.distanceMeters !== undefined ? meters(b.distanceMeters) : formatTime(b.seconds)} · ${Math.round(b.intensity * ftp)} W`;
  const lapGrade = lap?.inBand === undefined ? '' : lap.inBand >= 0.85 ? 'great' : lap.inBand >= 0.6 ? 'good' : 'off';

  return <>
    {running && feedback.state !== 'none' && <div className={`target-aura ${feedback.state} ${soft ? 'soft' : ''}`} aria-hidden="true" />}
    {countdown !== null && next && <div className="cockpit-countdown" aria-hidden="true" style={{ ['--next' as string]: zoneColor(next.intensity) }}>
      <strong key={countdown}>{countdown}</strong>
      <span>Neste · {next.label}</span>
      <b>{Math.round(next.intensity * ftp)} W</b>
    </div>}
    {lap && <div className={`lap-receipt ${lapGrade}`} role="status">
      <Check size={18} />
      <span><small>{lap.label} fullført</small><strong>{lap.avg} W snitt <em>mål {lap.target} W</em></strong></span>
      {lap.inBand !== undefined && <b>{Math.round(lap.inBand * 100)} %<small>i målområdet</small></b>}
    </div>}
    <div className={`speed-capsule ${arcade ? 'arcade' : ''}`} role="group" aria-label="Fart og distanse">
      <strong>{Math.round(speedKmh)}<small>km/t</small></strong>
      <span className="hud-distance"><b>{sceneKm.toFixed(1)}</b> km{arcade ? <em> · arkade</em> : null}</span>
    </div>
    <section className={`ride-console cockpit hud state-${feedback.state} phase-${block.kind} ${soft ? 'soft' : ''}`} aria-label="Øktkontroller" style={{ ['--zone' as string]: zoneColor(block.intensity) }}>
      {/* Two glass panels at the edges keep the centre free for the bike, the road and the handlebar. */}
      <div className="hud-panel hud-left">
        {rampStatus && <div className="ramp-live-cue" role="status"><strong>{rampStatus.interrupted?'Testen ble avbrutt – FTP blir ikke godkjent':rampStatus.ended?'Testdelen er ferdig · rolig nedkjøring':block.kind==='warmup'?'FTP-test · varm opp og finn jevn tråkkrytme':`Rampe · steg ${current.index} · ${formatTime(current.remaining)} til neste wattsteg`}</strong><span>{rampStatus.ended?'Du kan lagre nå eller fullføre nedkjøringen.':rampStatus.belowTargetSeconds>0?`${Math.max(0,Math.ceil(10-rampStatus.belowTargetSeconds))} s til automatisk avslutning hvis du blir under 80 % av målet.`:'Sitt rolig. Følg wattmålet uten å spurte. Avslutt når du ikke klarer å holde målet.'}</span></div>}
        <div className="ride-console-main">
          <div className={`power-focus ${feedback.state === 'on' ? 'on-target' : ''}`}>
            <span className="cockpit-eyebrow">Watt <small>3 s</small>{erg && <em className={`erg-pill ${erg.status}`} title="Automatisk motstand">{erg.status === 'error' ? 'ERG feil' : `ERG ${erg.watts ?? '…'} W`}</em>}</span>
            <strong>{power ?? '—'}<small>W</small></strong>
            <span className="target-readout">Mål <b>{target} W</b></span>
          </div>
          <div className="cockpit-target">
            <div className={`cockpit-cue ${running ? feedback.state : 'none'} ${soft ? 'soft' : ''}`} aria-live="off">
              {running && !ergOn && feedback.state === 'under' && <ChevronsUp size={22} />}
              {running && !ergOn && feedback.state === 'over' && <ChevronsDown size={22} />}
              {running && feedback.state === 'on' && <Check size={20} />}
              {!running && <Pause size={18} />}
              <strong>{cue}</strong>
              {running && (feedback.state === 'on' || (ergOn && feedback.state !== 'none')) && <small>{feedback.delta >= 0 ? '+' : ''}{feedback.delta} W</small>}
            </div>
            <TargetGauge power={power} target={target} state={feedback.state} />
          </div>
        </div>
        <div className="ride-toolbar">
          <button onClick={onPause} className="console-pause">{running ? <Pause size={18} /> : <Play size={18} />}<span>{running ? 'Pause' : 'Fortsett'}</span></button>
          {!rampStatus && <button onClick={onSkip}><SkipForward size={17} /><span>Neste segment</span></button>}
          {rampStatus && block.kind==='work' && !rampStatus.ended && <button onClick={onSkip} className="ramp-exhaustion" disabled={!running}>Jeg klarer ikke mer</button>}
          {!rampStatus && block.kind === 'warmup' && <button onClick={onWarmup} className="warmup-skip"><Check size={16} /><span>Jeg er ferdig oppvarmet</span></button>}
          <div className="console-spacer" />
          <button onClick={onFocus} aria-pressed={focus} aria-label={focus ? 'Vis spillpaneler' : 'Fokusmodus'} title="Fokusmodus (H)">{focus ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          <button onClick={onSound} aria-label={sound ? 'Slå av lyd' : 'Slå på lyd'}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
          <button onClick={onFullscreen} aria-label="Fullskjerm"><Maximize size={17} /></button>
          <details className="ride-detail"><summary>Detaljer <ChevronDown size={13} /></summary><div>
            <strong>{Math.round(game.score).toLocaleString('nb-NO')} poeng</strong>
            <span>{ghostDelta !== null && ghostDelta !== undefined ? <><b>{Math.round(ghostDelta) >= 0 ? '+' : ''}{Math.round(ghostDelta)}</b> <small>mot eget beste</small></> : null}</span>
            <span>{game.stars} stjerner · flytnivå {game.combo}/4</span>
            <span>{Math.round(game.accuracy * 100)} % av måletiden innenfor ±10 %</span>
            <span>Watt vises som 3 sekunders snitt. Lagrede målinger er rådata hvert sekund.</span>
            <span>{arcade ? 'Farten i denne verdenen er arkadefart og lagres ikke. Økten lagrer virtuell distanse fra watt.' : 'Fart og distanse er virtuelle og beregnes fra watt mot FTP.'}</span>
            <small>Spillpoeng måler måloppnåelse. Treningsutviklingen vises i økthistorikken.</small>
          </div></details>
          <button onClick={onFinish} className="end-ride">{rampStatus?.ended ? "Lagre test" : rampStatus ? "Avbryt test" : "Avslutt økt"}</button>
        </div>
      </div>
      <div className="hud-panel hud-right">
        <div className="hud-interval">
          <div className="interval-focus">
            <span className="cockpit-eyebrow"><i style={{ background: zone.color }} />Z{zone.id} {zone.name} · {Math.round(block.intensity * 100)} % FTP</span>
            <span className="interval-label">{block.label}</span>
            <strong>{distanceRemaining !== undefined ? meters(distanceRemaining) : formatTime(current.remaining)}</strong>
            {distanceRemaining !== undefined && <small>Virtuell distanse igjen</small>}
            <div className="block-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, blockProgress * 100))}%` }} /></div>
            <small className="lap-average">{live.avgPower !== undefined && live.seconds >= 3 ? <>Snitt i {block.kind === 'work' ? 'draget' : 'blokken'} <b>{live.avgPower} W</b></> : '\u00a0'}</small>
          </div>
          <div className="cockpit-next">
            <span className="cockpit-eyebrow">Neste</span>
            {next ? <>
              <strong><i style={{ background: zoneColor(next.intensity) }} />{next.label}</strong>
              <span>{nextText(next)}</span>
              {afterNext && <small>Så: {afterNext.label} · {Math.round(afterNext.intensity * ftp)} W</small>}
            </> : <><strong>Målgang</strong><span>Siste blokk</span></>}
          </div>
        </div>
        <WorkoutGraph workout={workout} samples={samples} ftp={ftp} progress={current.progress} index={current.index} />
        <div className="secondary-metrics">
          <span><b>{cadence ?? '—'}</b> rpm</span>
          <span><b>{heartRate && heartRate > 0 ? heartRate : '—'}</b> puls</span>
          <span className="metric-wide"><b>{formatTime(elapsed)}</b> {rampStatus && !rampStatus.ended ? '· rampe' : <>/ {hasDistance ? '≈ ' : ''}{formatTime(workoutDuration(workout) - skippedSeconds)}</>}</span>
          <span className="metric-wide"><b>{Math.round(energy)}</b> kJ</span>
        </div>
      </div>
    </section>
  </>;
}
