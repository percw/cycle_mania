import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bluetooth,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Flag,
  Heart,
  Maximize,
  Mountain,
  Pause,
  Play,
  Search,
  Settings2,
  Star,
  Volume2,
  VolumeX,
  X,
  Zap,
  Bike,
  TrendingUp,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import WorldScene from "./WorldScene";
import {enableGameSound,playGameSound} from "./gameSound";
import { GameSummary, WorldShelf, WorldGlyph } from "./GameHUD";
import { campaignFor, createExpedition, stepExpedition, chooseExpeditionRoute, finishExpedition, type ExpeditionState, type ExpeditionRoute } from './expedition';
import { performanceAchievements } from './achievements';
import { AchievementBoard, AchievementReceipt } from './AchievementsUI';
import { RideReport } from './RideReport';
import { TrainingTrends } from './TrainingTrends';
import { rideLoad } from './trends';
import { journeyFor, journeyForRide } from './journey';
import { JourneyBoard, JourneyHUD, JourneyReceipt } from './JourneyUI';
import { CampaignBoard, ExpeditionHUD, ExpeditionSummary } from './ExpeditionUI';
import RideConsole from './RideConsole';
import './expedition.css';
import {
  worlds as routes,
  worldById,
  idleVisual,
  type WorldId,
} from "./worlds";
import {
  createGame,
  stepGame,
  completeGameBlock,
  gameResult,
  ghostScore,
  type GameState,
} from "./game";
import SensorPanel from "./SensorPanel";
import { useSensors } from "./useSensors";
import { useErg } from "./useErg";
import ErgToggle from "./ErgToggle";
import DeviceCheck from "./DeviceCheck";
import {
  loadRides,
  persistRide,
  getFitUrl,
  getBackendStatus,
  getProfile,
  saveProfile,
} from "./api";
import { ProgressPanel } from "./ProgressPanel";
import {
  workouts as builtInWorkouts,
  zones,
  getZone,
  workoutDuration,
  workoutTss,
  zoneDistribution,
  getWorkoutState,
  formatTime,
  formatDuration,
  type Workout,
} from "./training";
import {
  BikeConnection,
  bluetoothAvailable,
  hasRememberedBike,
  rememberedBikeName,
  forgetRememberedBike,
  type BikeTelemetry,
} from "./bluetooth";
import { readStored, saveStored, type RideRecord } from "./storage";

import WorkoutBuilder from './WorkoutBuilder';
import {compileCustomWorkout,validateWorkoutSnapshot,type CustomWorkoutDraft} from './customWorkouts';
import {useCustomWorkouts} from './useCustomWorkouts';
import {createPlanCursor,validPlanCursor,planState,planStepLimit,advancePlan,skipPlan,type PlanCursor} from './workoutRuntime';

import {rampWorkout,isRampProtocol,analyzeRampTest} from './rampTest';
import type {RampProtocol,RampTestRecord} from './rampTypes';
import {RampTestSetup,RampTestResult,RampTestProgress} from './RampTestUI';

type RampSession = Omit<RampTestRecord,'version'|'endSecond'|'reason'> & {endSecond?:number;reason?:RampTestRecord['reason'];belowTargetSeconds:number};
type Route = WorldId;
type Session = {
  ramp?: RampSession;
  planCursor?: PlanCursor;
  worldId?: WorldId;
  game?: GameState;
  expedition?: ExpeditionState;
  startedAt: string;
  skippedSeconds: number;
  timerEvents?: { wallSecond: number; type: "start" | "stop" }[];
  workout: Workout;
  elapsed: number;
  running: boolean;
  demo: boolean;
  distance: number;
  energy: number;
  powerTime: number;
  measuredSeconds: number;
  zoneSeconds: number[];
  samples: {
    second: number;
    power: number;
    cadence: number | null;
    heartRate: number | null;
    targetPower?: number;
    measured?: boolean;
    wallSecond?: number;
    workoutSecond?: number;
    blockIndex?: number;
  }[];
};
function sessionWorkout(s:Session):Workout {
  if(s.ramp?.endSecond===undefined)return s.workout;
  let left=s.ramp.endSecond;
  const blocks=[] as Workout['blocks'];
  for(const block of s.workout.blocks){if(block.kind==='cooldown'||left<=0)break;const seconds=Math.min(left,block.seconds);blocks.push({...block,seconds});left-=seconds;}
  blocks.push(s.workout.blocks[s.workout.blocks.length-1]);
  return {...s.workout,blocks};
}
function sessionState(s:Session) {
  return s.workout.custom && s.planCursor ? planState(s.workout,s.planCursor) : {...getWorkoutState(sessionWorkout(s),s.elapsed+(s.skippedSeconds||0)),remainingMeters:undefined};
}
function customMetadata(s:Session) {
  return s.workout.custom && s.planCursor ? {workoutSnapshot:s.workout,blockSeconds:s.planCursor.blockSeconds,blockMeters:s.planCursor.blockMeters,skippedBlocks:s.planCursor.skippedBlocks} : {};
}
function mainIntensity(w: Workout) {
  const main = w.blocks.filter((b) => b.kind === "work");
  return main.length ? main.reduce((a, b) => a + b.intensity * b.seconds, 0) / Math.max(1, main.reduce((a, b) => a + b.seconds, 0)) : (w.blocks[0]?.intensity ?? 0.5);
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "God natt" : hour < 10 ? "God morgen" : hour < 17 ? "God dag" : "God kveld";
}
function workoutLength(w:Workout) {return `${w.blocks.some(b=>b.distanceMeters!==undefined)?'≈ ':''}${formatDuration(workoutDuration(w))}`;}
function IconLogo() {
  return (
    <svg viewBox="0 0 42 34" fill="none" aria-hidden="true">
      <path
        d="M2 30 17 4l8 14 5-9 11 21H2Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="m11 15 6 5 5-5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function ProfileChart({
  workout,
  elapsed = 0,
  large = false,
}: {
  workout: Workout;
  elapsed?: number;
  large?: boolean;
}) {
  const total = workoutDuration(workout);
  return (
    <div
      className={`profile-chart ${large ? "large" : ""}`}
      style={{gap:`min(3px, ${20 / workout.blocks.length}%)`}}
      aria-label="Øktprofil, søylehøyde viser wattmål"
    >
      {workout.blocks.map((block, i) => (
        <div
          key={i}
          style={{
            flex: block.seconds,
            height: `${Math.max(13, Math.min(100, (block.intensity / 1.5) * 100))}%`,
            background:
              zones[getZone(block.intensity * 100, 100).id - 1]?.color,
          }}
          title={`${block.label} · ${block.distanceMeters !== undefined ? `${block.distanceMeters} m` : formatDuration(block.seconds)} · ${Math.round(block.intensity * 100)} % FTP`}
        />
      ))}
      {elapsed > 0 && (
        <span
          className="chart-playhead"
          style={{ left: `${Math.min(100, (elapsed / total) * 100)}%` }}
        />
      )}
    </div>
  );
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initialFtp = Number(readStored("summit-ftp", 250));
export default function App() {
  const customLibrary=useCustomWorkouts();
  const workouts=useMemo(()=>[...builtInWorkouts,...customLibrary.drafts.map(compileCustomWorkout)],[customLibrary.drafts]);
  const [builder,setBuilder]=useState<CustomWorkoutDraft|null|undefined>(undefined);
  const [deleteTemplate,setDeleteTemplate]=useState<string|null>(null);
  const draftFor=(w:Workout)=>customLibrary.drafts.find(d=>compileCustomWorkout(d).id===w.id);
  const [page, setPage] = useState("home");
  const [ftp, setFtp] = useState(
    Number.isFinite(initialFtp) && initialFtp >= 50 && initialFtp <= 600
      ? initialFtp
      : 250,
  );
  const [ftpDraft, setFtpDraft] = useState(String(ftp));
  const [settings, setSettings] = useState(false);
  const [rampSetup,setRampSetup]=useState<RampProtocol|null>(null);
  const [route, setRoute] = useState<Route>(
    () =>
      worldById(
        readStored<Session | null>("summit-active-session", null)?.worldId ??
          readStored("summit-world", "neon"),
      ).id,
  );
  function chooseWorld(id: WorldId) {
    setRoute(id);
    saveStored("summit-world", id);
  }
  const [pendingStart, setPendingStart] = useState<Workout | null>(null);
  const [autoConnect, setAutoConnect] = useState(() =>
    readStored("summit-auto-connect", true),
  );
  const [routePicker, setRoutePicker] = useState(false);
  const [missionRoute, setMissionRoute] = useState<ExpeditionRoute>(() => readStored<string>('summit-mission-route', 'restore') === 'explore' ? 'explore' : 'restore');
  const [alreadyWarm, setAlreadyWarm] = useState(false);
  function selectMissionRoute(next: ExpeditionRoute) { setMissionRoute(next); saveStored('summit-mission-route', next); }
  const [selected, setSelected] = useState<Workout | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Alle");
  const [favorites, setFavorites] = useState<string[]>(() => {
    const v = readStored<unknown>("summit-favorites", []);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  });
  const [history, setHistory] = useState<RideRecord[]>(() => {
    const v = readStored<unknown>("summit-history", []);
    return Array.isArray(v)
      ? (v.filter(
          (x) =>
            x &&
            typeof x === "object" &&
            typeof x.seconds === "number" &&
            Array.isArray(x.zoneSeconds),
        ) as RideRecord[])
      : [];
  });
  const [session, setSession] = useState<Session | null>(() => {
    const saved = readStored<Session | null>("summit-active-session", null);
    let workout = workouts.find((w) => w.id === saved?.workout?.id);
    if(saved?.ramp && isRampProtocol(saved.ramp.protocol) && Number.isFinite(saved.ramp.referenceFtp) && saved.ramp.referenceFtp>=50 && saved.ramp.referenceFtp<=600){
      const r=saved.ramp;
      if(typeof r.interrupted!=='boolean' || !Number.isFinite(r.belowTargetSeconds) || r.belowTargetSeconds<0 || r.belowTargetSeconds>10
        || (r.endSecond!==undefined && (!Number.isFinite(r.endSecond) || r.endSecond<0 || r.endSecond>saved.elapsed || !['exhaustion','aborted','ceiling'].includes(r.reason??'')))
        || (r.endSecond===undefined && r.reason!==undefined))return null;
      workout=rampWorkout(saved.ramp.protocol,saved.ramp.referenceFtp);
      saved.ramp={...saved.ramp,belowTargetSeconds:0,interrupted:saved.ramp.interrupted || (saved.elapsed>=saved.ramp.protocol.warmupSeconds && saved.ramp.endSecond===undefined)};
    }
    if(saved?.workout?.custom){try{workout=validateWorkoutSnapshot(saved.workout);if(!validPlanCursor(workout,saved.planCursor))return null;}catch{return null;}}
    return saved &&
      workout &&
      Number.isFinite(saved.elapsed) &&
      Array.isArray(saved.samples) &&
      Array.isArray(saved.zoneSeconds)
      ? { ...saved, workout, running: false }
      : null;
  });
  const sessionRef = useRef<Session | null>(session);
  const lastCheckpoint = useRef(0);
  const resumedSample = useRef(false);
  const [summary, setSummary] = useState<RideRecord | null>(null);
  const [summarySamples, setSummarySamples] = useState<Session["samples"]>([]);
  const [bleStatus, setBleStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [deviceName, setDeviceName] = useState("");
  const [telemetry, setTelemetry] = useState<BikeTelemetry>({});
  const telemetryRef = useRef<BikeTelemetry>({});
  const lastTelemetry = useRef(0);
  const lastPower = useRef(0);
  const [deviceModal, setDeviceModal] = useState(false);
  const [error, setError] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);
  const [sensorSource, setSensorSource] = useState<"ble" | "ant">("ble");
  const sensorSourceRef = useRef(sensorSource);
  sensorSourceRef.current = sensorSource;
  const sensors = useSensors(setError);
  const externalHr = useRef<number | null>(null);
  externalHr.current = sensors.heartRate;
  const status =
    sensorSource === "ble"
      ? bleStatus
      : sensors.ant?.status === "connected" ||
          sensors.ant?.status === "scanning"
        ? "connected"
        : sensors.ant?.status === "connecting"
          ? "connecting"
          : "disconnected";
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    let active = true;
    async function sync() {
      try {
        const ftpBeforeSync=readStored('summit-ftp',250);
        await getBackendStatus();
        const pendingFtp=readStored<number|null>('summit-pending-ftp',null);
        if(pendingFtp!==null && pendingFtp>=50 && pendingFtp<=600){await saveProfile(pendingFtp);if(readStored('summit-pending-ftp',null)===pendingFtp)saveStored('summit-pending-ftp',null);}
        const [remote, profile] = await Promise.all([
          loadRides(),
          getProfile(),
        ]);
        if (!active) return;
        setBackendOnline(true);
        const merged = new Map(remote.map((ride) => [ride.id, ride]));
        for (const local of historyRef.current) {
          if (!merged.has(local.id)) {
            await persistRide(local);
            merged.set(local.id, local);
          }
        }
        if (!active) return;
        const next = [...merged.values()].sort(
          (a, b) => Date.parse(b.date) - Date.parse(a.date),
        );
        setHistory(next);
        saveStored("summit-history", next);
        if (profile.updatedAt && !sessionRef.current && readStored('summit-pending-ftp',null)===null && readStored('summit-ftp',250)===ftpBeforeSync) {
          setFtp(profile.ftp);
          setFtpDraft(String(profile.ftp));
          saveStored("summit-ftp", profile.ftp);
        }
      } catch {
        if (active) setBackendOnline(false);
      }
    }
    void sync();
    const timer = setInterval(() => void sync(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (sensorSource !== "ant") return;
    const ant = sensors.ant;
    if (ant?.power != null && ant.powerUpdatedAt) {
      lastPower.current = ant.powerUpdatedAt;
      telemetryRef.current = {
        ...telemetryRef.current,
        power: ant.power,
        cadence: ant.cadence ?? undefined,
      };
      setTelemetry(telemetryRef.current);
    } else if (
      !ant ||
      ant.status === "disconnected" ||
      ant.status === "error"
    ) {
      telemetryRef.current = {};
      setTelemetry({});
    }
  }, [sensors.ant, sensorSource]);
  function changeSource(source: "ble" | "ant") {
    if (sessionRef.current) {
      setError("Avslutt økten før du bytter kilde for sykkeldata.");
      return;
    }
    setSensorSource(source);
    lastPower.current = 0;
    telemetryRef.current = {};
    setTelemetry({});
  }
  async function exportFit(record: RideRecord) {
    try {
      await persistRide(record);
      const response = await fetch(getFitUrl(record.id));
      if (!response.ok) throw new Error("FIT-eksport feilet.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `summit-${record.id}.fit`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Start lokal backend for å eksportere FIT.",
      );
    }
  }
  const [sound, setSound] = useState(false);
  const [focusMode, setFocusMode] = useState(() => readStored<unknown>("summit-focus", false) === true);
  function toggleFocus() {
    setFocusMode((on) => { saveStored("summit-focus", !on); return !on; });
  }
  const [renderer, setRenderer] = useState("Three.js");
  const [sceneSector, setSceneSector] = useState(0);
  const connection = useRef<BikeConnection | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const featured =
    workouts.find((w) => w.id === "recovery-10") ??
    workouts[0];
  const [readyWorkout, setReadyWorkout] = useState<Workout>(() => workouts.find(w => w.id === readStored('summit-last-workout', '')) ?? featured);
  const activeWorld = session?.worldId ?? route;
  const featuredRoute = worldById(activeWorld);
  const expeditionEnabled = !session?.ramp && (activeWorld === "tron" || activeWorld === "neon" || activeWorld === "sky");
  const savedAchievements = useMemo(()=>performanceAchievements(history),[history]);
  const currentAchievements = useMemo(()=>{
    if(!session)return savedAchievements;
    const live:RideRecord={...customMetadata(session),id:'active-performance',name:session.workout.name,workoutId:session.workout.id,date:new Date().toISOString(),seconds:session.elapsed,distance:session.distance,avgPower:0,energy:session.energy,zoneSeconds:session.zoneSeconds,completed:false,demo:false,ftp,skippedSeconds:session.skippedSeconds,samples:session.demo?session.samples.map(p=>({...p,measured:true})):session.samples};
    return performanceAchievements(history,live);
  },[history,session,ftp,savedAchievements]);
  const summaryAchievements = useMemo(()=>{
    if(!summary||summary.demo)return [];
    const before=history.filter(r=>r.id!==summary.id && Date.parse(r.date)<Date.parse(summary.date));
    const earnedBefore=new Set(performanceAchievements(before).filter(x=>x.earned).map(x=>x.id));
    return performanceAchievements([...before,summary]).filter(x=>x.earned&&!earnedBefore.has(x.id));
  },[summary,history]);
  const game = session?.game ?? createGame();
  const campaign = campaignFor(history, activeWorld);
  const expedition = session?.expedition ?? createExpedition(activeWorld, campaign, missionRoute);
  const journey = useMemo(()=>journeyFor(history, activeWorld, session?.expedition, session?.demo ?? false),[history,activeWorld,session]);
  const lastPlace = journey.log.at(-1);
  const sceneJourney = expedition.choiceOpen && lastPlace ? {...journey, variant:lastPlace.variant,route:lastPlace.route,destination:lastPlace.name,progress:1} : journey;
  function chooseMission(next: ExpeditionRoute) {
    const s = sessionRef.current;
    if (!s?.expedition?.choiceOpen) return;
    const updated = { ...s, expedition: chooseExpeditionRoute(s.expedition, next) };
    updateSession(updated);
    saveStored('summit-active-session', updated);
    if (soundRef.current) playGameSound('segment', s.worldId ?? route);
  }
  const bestRun = history
    .filter(
      (r) =>
        !r.demo &&
        r.worldId === activeWorld &&
        r.workoutId === session?.workout.id &&
        r.game,
    )
    .sort((a, b) => (b.game?.score ?? 0) - (a.game?.score ?? 0))[0]?.game;
  const ghost = ghostScore(bestRun, session?.elapsed ?? 0);
  function updateSession(s: Session | null) {
    const previous = sessionRef.current;
    if(s?.ramp && previous?.running && !s.running && s.ramp.endSecond===undefined && s.elapsed>=s.ramp.protocol.warmupSeconds){
      s={...s,ramp:{...s.ramp,interrupted:true,belowTargetSeconds:0}};
    }
    if (s && previous && s.running !== previous.running)
      s = {
        ...s,
        timerEvents: [
          ...(s.timerEvents ?? []),
          {
            wallSecond: Math.max(
              0,
              (Date.now() - Date.parse(s.startedAt)) / 1000,
            ),
            type: s.running ? "start" : "stop",
          },
        ],
      };
    if (s?.running && !previous?.running) resumedSample.current = true;
    sessionRef.current = s;
    setSession(s);
    if (
      !s ||
      Date.now() - lastCheckpoint.current > 5000 ||
      s.running !== previous?.running ||
      s.skippedSeconds !== previous?.skippedSeconds ||
      s.ramp?.endSecond !== previous?.ramp?.endSecond ||
      s.planCursor?.index !== previous?.planCursor?.index
    ) {
      saveStored("summit-active-session", s);
      lastCheckpoint.current = Date.now();
    }
  }
  function beep(){if(soundRef.current){enableGameSound();playGameSound('segment',sessionRef.current?.worldId??route)}}
  useEffect(() => {
    connection.current = new BikeConnection({
      onData(data) {
        if (sensorSourceRef.current !== "ble") return;
        lastTelemetry.current = Date.now();
        if (data.power !== undefined) {
          lastPower.current = Date.now();
          setError(message => /^(Forbindelsen ble brutt|Ingen ferske wattdata|Koble til sykkelen og vent)/.test(message) ? '' : message);
        }
        telemetryRef.current = {
          ...telemetryRef.current,
          ...data,
          ...(data.power === undefined
            ? {}
            : { power: Math.max(0, data.power) }),
        };
        setTelemetry(telemetryRef.current);
      },
      onStatus(next, name) {
        setBleStatus(next);
        setDeviceName(name ?? "");
        if (next === "disconnected" && sensorSourceRef.current === "ble") {
          telemetryRef.current = {};
          setTelemetry({});
          if (sessionRef.current && !sessionRef.current.demo) {
            updateSession({ ...sessionRef.current, running: false });
            setError(
              "Forbindelsen ble brutt. Økten er satt på pause. Koble til sykkelen igjen for å fortsette.",
            );
          }
        }
      },
      onError: (message) => {
        setError(message);
        setPendingStart(null);
      },
    }, erg.control);
    if (readStored("summit-auto-connect", true))
      void connection.current.connectRemembered();
    return () => connection.current?.disconnect();
  }, []);
  function finish(s: Session, completed: boolean) {
    const record: RideRecord = {
      ...customMetadata(s),
      id: crypto.randomUUID(),
      name: s.workout.name,
      date: new Date().toISOString(),
      seconds: s.elapsed,
      distance: s.distance,
      avgPower:
        s.measuredSeconds > 0 ? Math.round(s.powerTime / s.measuredSeconds) : 0,
      energy: s.energy,
      zoneSeconds: s.zoneSeconds,
      completed: s.ramp ? s.ramp.reason==='exhaustion' : completed,
      demo: s.demo,
      ftp: s.ramp?.referenceFtp ?? ftp,
      ...(s.ramp?{rampTest:{version:1 as const,protocol:s.ramp.protocol,referenceFtp:s.ramp.referenceFtp,endSecond:s.ramp.endSecond??s.elapsed,reason:s.ramp.reason??'aborted',interrupted:s.ramp.interrupted}}:{}),
      skippedSeconds: s.skippedSeconds || 0,
      timerEvents: s.timerEvents ?? [],
      workoutId: s.workout.id,
      startedAt: s.startedAt,
      samples: s.samples,
      distanceMeasured: false,
      worldId: s.worldId ?? route,
      game: gameResult(s.game ?? createGame()),
      ...(s.expedition ? { expedition: finishExpedition(s.expedition) } : {}),
    };
    if (s.expedition && !s.demo) selectMissionRoute(s.expedition.route);
    const next = [record, ...history];
    setHistory(next);
    saveStored("summit-history", next);
    void persistRide(record)
      .then(() => setBackendOnline(true))
      .catch(() => {
        setBackendOnline(false);
        setError(
          "Økten er lagret i nettleseren. Start lokal backend for databasesynkronisering og FIT-eksport.",
        );
      });
    setSummary(record);
    setSummarySamples(s.samples);
    updateSession(null);
    beep();
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;
  function tick(seconds: number) {
    let s = sessionRef.current;
    if (!s?.running) return;
    if (!s.demo && seconds > 3) {
      if(s.elapsed<1)return;
      updateSession({ ...s, running: false });
      setError(
        "Appen var inaktiv. Økten er pauset for å unngå å lagre uobserverte wattdata.",
      );
      return;
    }
    if (!s.demo && Date.now() - lastPower.current > (s.ramp?2500:10000)) {
      updateSession({ ...s, running: false });
      setError(
        "Ingen ferske wattdata fra sykkelen. Økten er satt på pause. Sjekk tilkoblingen og tråkk noen omdreininger.",
      );
      return;
    }
    const oldEvent=s.game?.eventSerial??0;const oldStars=s.game?.stars??0;
    const oldIndex = sessionState(s).index;
    let remaining = Math.min(
      seconds,
      s.planCursor ? 172800-s.elapsed : workoutDuration(s.workout) - s.elapsed - (s.skippedSeconds || 0),
    );
    s = { ...s, ...(s.ramp?{ramp:{...s.ramp}}:{}), zoneSeconds: [...s.zoneSeconds], samples: [...s.samples] };
    while (remaining > 0.0001) {
      if(s.ramp && s.ramp.endSecond===undefined && s.elapsed>=s.ramp.protocol.warmupSeconds+s.ramp.protocol.maxStages*60){s.ramp={...s.ramp,endSecond:s.elapsed,reason:'ceiling',belowTargetSeconds:0};}
      const state = sessionState(s);
      if(state.completed)break;
      const target = state.block.intensity * (s.ramp?.referenceFtp??ftp);
      const power = s.demo
        ? Math.round(target * (1 + 0.025 * Math.sin(s.elapsed * 0.8)))
        : telemetryRef.current.power;
      const speed = s.planCursor
        ? (s.demo || Date.now()-lastPower.current<=5000 ? Math.cbrt(Math.max(0,power??0))*5.3 : 0)
        : s.demo
        ? Math.max(12, Math.cbrt(Math.max(0, power ?? 0)) * 5.3)
        : (telemetryRef.current.speed ??
          ((power ?? 0) > 0 ? Math.cbrt(power ?? 0) * 5.3 : 0));
      const dt=Math.min(remaining,1,s.planCursor?planStepLimit(s.workout,s.planCursor,speed/3.6):state.remaining||1);
      s.distance += (speed * dt) / 3600;
      if (power !== undefined && (s.demo || Date.now() - lastPower.current <= 5000)) {
        s.powerTime += power * dt;
        s.measuredSeconds += dt;
        s.energy += (power * dt) / 1000;
        s.zoneSeconds[getZone(power, s.ramp?.referenceFtp??ftp).id - 1] += dt;
        if (Math.floor(s.elapsed + dt) > Math.floor(s.elapsed))
          s.samples.push({
            second: Math.floor(s.elapsed + dt),
            power,
            cadence: s.demo ? 88 : (telemetryRef.current.cadence ?? sensors.cadence ?? null),
            heartRate: s.demo
              ? null
              : (externalHr.current ?? telemetryRef.current.heartRate ?? null),
            targetPower: target,
            ...(s.planCursor ? {blockIndex:state.index} : {workoutSecond: Math.floor(s.elapsed + dt) + (s.skippedSeconds || 0)}),
            wallSecond: Math.max(
              0,
              (Date.now() - Date.parse(s.startedAt)) / 1000,
            ),
            measured: s.demo
              ? false
              : !resumedSample.current &&
                Date.now() - lastPower.current <= (s.ramp?2000:5000),
          });
        if (Math.floor(s.elapsed + dt) > Math.floor(s.elapsed))
          resumedSample.current = false;
      }
      if (!s.ramp && ["tron", "neon", "sky"].includes(s.worldId ?? route)) s.expedition = stepExpedition(s.expedition ?? createExpedition(s.worldId ?? route, campaignFor(history, s.worldId ?? route), missionRoute), {
        seconds: dt, power: s.demo || Date.now() - lastPower.current <= 5000 ? power : undefined,
        target, phase: state.block.kind, elapsed: s.elapsed,
      });
      s.game = stepGame(s.game ?? createGame(), {
        seconds: dt,
        power:
          s.demo || Date.now() - lastPower.current <= 5000 ? power : undefined,
        target,
        block: state.block,
        index: state.index,
        remaining: state.remaining,
        elapsed: s.elapsed,
      });
      if(s.planCursor){
        s.planCursor=advancePlan(s.workout,s.planCursor,dt,speed*dt/3.6);
        if(s.planCursor.index!==state.index)s.game=completeGameBlock(s.game,{...state.block,seconds:s.planCursor.blockSeconds[state.index]});
      }else if (state.remaining - dt <= 0.000001)
        s.game = completeGameBlock(s.game, state.block);
      s.elapsed += dt;
      if(s.ramp && s.ramp.endSecond===undefined && state.block.kind==='work'){
        const fresh=s.demo || Date.now()-lastPower.current<=2000;
        const failing=s.elapsed>=s.ramp.protocol.warmupSeconds+120 && fresh && power!==undefined && power<target*.8;
        s.ramp.belowTargetSeconds=failing?s.ramp.belowTargetSeconds+dt:0;
        if(s.ramp.belowTargetSeconds>=10){s.ramp={...s.ramp,endSecond:s.elapsed,reason:'exhaustion',belowTargetSeconds:0};}
      }
      if(s.ramp && s.ramp.endSecond===undefined && s.elapsed>=s.ramp.protocol.warmupSeconds+s.ramp.protocol.maxStages*60){s.ramp={...s.ramp,endSecond:s.elapsed,reason:'ceiling',belowTargetSeconds:0};}
      remaining -= dt;
    }
    if(soundRef.current&&s.game&&s.game.eventSerial>oldEvent)playGameSound(s.game.stars>oldStars?'mastery':'pulse',s.worldId??route,s.game.combo);
    if (
      sessionState(s).index !==
      oldIndex
    )
      beep();
    if (
      sessionState(s).completed
    )
      finishRef.current(s, true);
    else if(s.elapsed>=172800)finishRef.current(s,false);
    else updateSession(s);
  }
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      tickRef.current((now - previous) / 1000);
      previous = now;
    }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Escape closes dialogs from anywhere, including a focused input.
      if (event.key === "Escape" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) {
        setSettings(false); setSelected(null); setDeviceModal(false); setRoutePicker(false); setSummary(null);
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      if (event.key === '1' || event.key === '2') {
        chooseMission(event.key === '1' ? 'restore' : 'explore');
        return;
      }
      if (event.target instanceof HTMLButtonElement) return;
      if (event.code === "Space" && sessionRef.current) {
        event.preventDefault();
        togglePause();
      }
      if (event.key === "f") toggleFullscreen();
      if (event.key === "h" && sessionRef.current) toggleFocus();
      if (event.key === "Escape") {
        setSettings(false);
        setSelected(null);
        setDeviceModal(false);
        setRoutePicker(false);
        setSummary(null);
        setRampSetup(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status]);
  useEffect(() => {
    Object.assign(window, {
      render_game_to_text: () => {
        const session = sessionRef.current;
        return JSON.stringify({
          page,
          mode: session ? (session.running ? "riding" : "paused") : "browse",
          route,
          ftp,
          workoutCount: workouts.length,
          bluetooth: status,
          renderer,
          campaign: campaignFor(history, route),
          achievements: currentAchievements,
          journey: journeyFor(history, session?.worldId ?? route, session?.expedition, session?.demo ?? false),
          session: session
            ? {
                workout: session.workout.name,
                elapsed: session.elapsed,
                demo: session.demo,
                distanceKm: session.distance,
                ...sessionState(session),
                planCursor:session.planCursor,
                ramp:session.ramp,
                zoneSeconds: session.zoneSeconds,
                game: session.game
                  ? {
                      score: Math.round(session.game.score),
                      combo: session.game.combo,
                      charge: session.game.charge,
                      pulses: session.game.pulses,
                      stars: session.game.stars,
                      quality: session.game.quality,
                      masteredBlocks: session.game.masteredBlocks,
                    }
                  : null,
                world: session.worldId ?? route,
                sector: sceneSector,
                expedition: session.expedition ?? null,
              }
            : null,
          summary,
          coordinateSystem:
            "Three.js world: Y up; rider follows a closed X/Z road",
        });
      },
      advanceTime: (ms: number) => tickRef.current(ms / 1000),
    });
  }, [page, session, ftp, status, renderer, route, summary, workouts, history, currentAchievements, sceneSector]);
  function togglePause() {
    const s = sessionRef.current;
    if (!s) return;
    if (
      !s.running &&
      !s.demo &&
      (status !== "connected" || Date.now() - lastPower.current > 10000)
    ) {
      setError(
        "Koble til sykkelen og vent på ferske wattdata før du fortsetter.",
      );
      return;
    }
    updateSession({ ...s, running: !s.running });
  }
  function skipSegment() {
    const s = sessionRef.current;
    if (!s) return;
    if(s.ramp){
      if(s.ramp.endSecond!==undefined){finishRef.current(s,true);return;}
      if(sessionState(s).block.kind!=='work')return;
      updateSession({...s,ramp:{...s.ramp,endSecond:s.elapsed,reason:'exhaustion',belowTargetSeconds:0}});beep();return;
    }
    const state = sessionState(s);
    const skipped=s.planCursor?skipPlan(s.workout,s.planCursor):null;
    const next = {
      ...s,
      ...(skipped?{planCursor:skipped.cursor}:{}),
      skippedSeconds: (s.skippedSeconds || 0) + (skipped?.skippedSeconds ?? state.remaining),
    };
    if (state.index === s.workout.blocks.length - 1) {
      finishRef.current(next, true);
      return;
    }
    updateSession(next);
    beep();
  }
  function skipWarmup() {
    const s = sessionRef.current;
    if (!s || s.ramp) return;
    if(s.planCursor){
      let cursor=s.planCursor,skippedSeconds=s.skippedSeconds;
      while(!planState(s.workout,cursor).completed && s.workout.blocks[cursor.index].kind==='warmup'){
        const result=skipPlan(s.workout,cursor);cursor=result.cursor;skippedSeconds+=result.skippedSeconds;
      }
      updateSession({...s,planCursor:cursor,skippedSeconds});beep();return;
    }
    const position = s.elapsed + (s.skippedSeconds || 0);
    let end = 0;
    for (const block of s.workout.blocks) {
      if (block.kind !== "warmup") break;
      end += block.seconds;
    }
    if (end > position) {
      updateSession({
        ...s,
        skippedSeconds: (s.skippedSeconds || 0) + end - position,
      });
      beep();
    }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  function start(workout: Workout, demo: boolean) {
    if(sessionRef.current)return;
    if(workout.ramp)workout=rampWorkout(workout.ramp,ftp);
    setRampSetup(null);
    setReadyWorkout(workout);
    if (
      !demo &&
      (status !== "connected" || Date.now() - lastPower.current > 10000)
    ) {
      setSelected(null);
      if (sensorSource === "ant") {
        setDeviceModal(true);
        setError("Start ANT+-mottakeren og tråkk til wattdata vises.");
        return;
      }
      if (!bluetoothAvailable()) {
        setDeviceModal(true);
        return;
      }
      setError("");
      setPendingStart(workout);
      if (status !== "connected" && status !== "connecting")
        void connection.current?.connect();
      return;
    }
    setSelected(null);
    setDeviceModal(false);
    setPendingStart(null);
    setSummary(null);
    setError("");
    setReadyWorkout(workout);
    saveStored('summit-last-workout', workout.id);
    let warmedSeconds=0;
    if (alreadyWarm && !workout.ramp) { for (const block of workout.blocks) { if (block.kind !== 'warmup') break; warmedSeconds += block.seconds; } }
    let planCursor=workout.custom?createPlanCursor(workout):undefined;
    if(planCursor&&alreadyWarm){warmedSeconds=0;while(!planState(workout,planCursor).completed&&workout.blocks[planCursor.index].kind==='warmup'){const skipped=skipPlan(workout,planCursor);planCursor=skipped.cursor;warmedSeconds+=skipped.skippedSeconds;}}
    window.scrollTo(0, 0);
    updateSession({
      ...(planCursor?{planCursor}:{}),
      ...(workout.ramp?{ramp:{protocol:workout.ramp,referenceFtp:ftp,interrupted:false,belowTargetSeconds:0}}:{}),
      workout,
      worldId: route,
      game: createGame(),
      ...((!workout.ramp && ["tron", "neon", "sky"].includes(route)) ? {expedition: createExpedition(route, campaignFor(history, route), missionRoute)} : {}),
      startedAt: new Date().toISOString(),
      skippedSeconds: warmedSeconds,
      elapsed: 0,
      running: true,
      demo,
      distance: 0,
      energy: 0,
      powerTime: 0,
      measuredSeconds: 0,
      zoneSeconds: Array(7).fill(0),
      samples: [],
    });
    beep();
  }
  useEffect(() => {
    if (
      pendingStart &&
      status === "connected" &&
      Date.now() - lastPower.current < 5000 &&
      !sessionRef.current
    )
      start(pendingStart, false);
  }, [pendingStart, status, telemetry]);
  useEffect(() => {
    if (!pendingStart) return;
    const timer = setTimeout(() => {
      setPendingStart(null);
      setError(
        "Ingen ferske wattdata ennå. Tråkk noen omdreininger og trykk Start økten igjen.",
      );
    }, 30000);
    return () => clearTimeout(timer);
  }, [pendingStart]);
  function repeatRamp(protocol:RampProtocol){setSummary(null);setRampSetup(protocol);}
  function startRamp(protocol:RampProtocol,demo:boolean){start(rampWorkout(protocol,ftp),demo);}
  function persistFtp(value:number){
    setFtp(value);setFtpDraft(String(value));saveStored('summit-ftp',value);saveStored('summit-pending-ftp',value);
    void saveProfile(value).then(()=>{if(readStored('summit-pending-ftp',null)===value)saveStored('summit-pending-ftp',null);setBackendOnline(true);}).catch(()=>{setBackendOnline(false);setError('FTP er lagret lokalt og synkroniseres når backend er tilgjengelig.');});
  }
  function applyRampFtp(value:number){
    if(sessionRef.current || !summary || value<50 || value>600 || analyzeRampTest(summary)?.estimatedFtp!==value)return;
    persistFtp(value);
  }
  function favorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    setFavorites(next);
    saveStored("summit-favorites", next);
  }
  const categories = [
    "Alle",
    ...new Set(workouts.map((w) => w.category)),
    "Favoritter",
  ];
  const filtered = workouts.filter(
    (w) =>
      (category === "Alle" ||
        (category === "Favoritter"
          ? favorites.includes(w.id)
          : w.category === category)) &&
      `${w.name} ${w.subtitle} ${w.category}`
        .toLowerCase()
        .replace(/[×x\s]/g, "")
        .includes(query.toLowerCase().replace(/[×x\s]/g, "")),
  );
  const actualRides = history.filter((r) => !r.demo);
  const loadById = useMemo(() => new Map(history.map((r) => [r.id, rideLoad(r)])), [history]);
  const weekRides = actualRides.filter(
    (r) => Date.now() - new Date(r.date).getTime() < 7 * 86400000,
  );
  const weekSeconds = weekRides.reduce((a, r) => a + r.seconds, 0);
  const current = session
    ? sessionState(session)
    : null;
  const target = current ? Math.round(current.block.intensity * (session?.ramp?.referenceFtp??ftp)) : 0;
  // Automatic resistance (ERG): opt-in per trainer, real Bluetooth rides only, never demo or FTP ramp tests.
  const erg = useErg({ session: !!session, running: !!session?.running, target,
    eligible: !!session && !session.demo && !session.ramp && sensorSource === "ble" && bleStatus === "connected" });
  const liveCadence = telemetry.cadence ?? sensors.cadence;
  function openDeviceCheck() {
    if (sessionRef.current) return;
    // The check page opens its own connection: two owners of one control point would fight.
    connection.current?.disconnect();
    setDeviceModal(false);
    setPage("device-check");
    window.scrollTo(0, 0);
  }
  const livePower = session?.demo
    ? Math.round(target * (1 + 0.025 * Math.sin(session.elapsed * 0.8)))
    : telemetry.power;
  const liveSpeed = session?.planCursor
    ? Math.cbrt(Math.max(0,livePower??0))*5.3
    : session?.demo
    ? Math.max(12, Math.cbrt(livePower ?? 0) * 5.3)
    : (telemetry.speed ?? Math.cbrt(Math.max(0, livePower ?? 0)) * 5.3);
  const liveZone = getZone(livePower ?? 0, session?.ramp?.referenceFtp??ftp);
  const dialogOpen = settings || selected || deviceModal || routePicker || rampSetup;
  const modalOpen = dialogOpen || summary;
  useEffect(() => {
    if (!modalOpen) return;
    const oldFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>("button,input,select")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      oldFocus?.focus();
    };
  }, [!!modalOpen,!!rampSetup]);
  return (
    <div className={`app ${session ? "is-riding" : ""}`}>
      <header className="header">
        <button
          className="brand"
          onClick={() => {
            if (!session) setPage("home");
          }}
          aria-label="SUMMIT hjem"
        >
          <IconLogo />
          <span>
            SUMMIT<span className="brand-dot">®</span>
          </span>
        </button>
        <nav aria-label="Hovedmeny">
          {[
            ["home", "Treningsrom"],
            ["library", "Øktbibliotek"],
            ["ftp-test", "FTP-test"],
            ["history", "Min utvikling"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={page === id && !session ? "active" : ""}
              onClick={() => {
                if (session) {
                  if (session.running)
                    updateSession({ ...session, running: false });
                  setError("Avslutt økten før du bytter side.");
                } else setPage(id);
              }}
            >
              {name}
              {id === "library" && <span className="nav-count">{workouts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className={`connection-button ${status === "connected" ? "connected" : ""}`}
            disabled={status === "connecting"}
            onClick={() => {
              if (status === "connected" || sensorSource === "ant")
                setDeviceModal(true);
              else {
                setError("");
                void connection.current?.connect();
              }
            }}
          >
            <Bluetooth size={16} />
            <span>
              {status === "connected"
                ? "Sykkel tilkoblet"
                : status === "connecting"
                  ? "Kobler til …"
                  : "Koble til sykkel"}
            </span>
            <span className="status-dot" />
          </button>
          <button
            className="sensor-shortcut"
            aria-label="Sensorinnstillinger"
            onClick={() => setDeviceModal(true)}
          >
            <Settings2 size={16} />
          </button>
          <button
            className="avatar"
            aria-label="Åpne profil og FTP"
            onClick={() => setSettings(true)}
          >
            DU
          </button>
        </div>
      </header>
      {session && current ? (
        <main className={`ride-view expedition-ride world-${activeWorld} ${focusMode ? "focus-mode" : ""}`}>
          <WorldScene running={session.running} speed={liveSpeed} progress={session.distance / 8.4}
            zoneColor={liveZone.color} world={activeWorld} journey={activeWorld==="tron"?sceneJourney:undefined} achievements={currentAchievements.filter(x=>x.ready).map(x=>x.id)} expedition={expeditionEnabled?expedition:undefined}
            game={{...game,ghostDelta:ghost===null?undefined:game.score-ghost}}
            onSector={setSceneSector} onRenderer={setRenderer}/>
          <div className="ride-topbar">
            <div className="ride-title"><IconLogo /><span>{featuredRoute.name}</span><i /><b>{session.workout.name}</b></div>
            <div className="ride-top-actions">
              <span className={`session-source ${session.demo ? "demo" : ""}`}>{session.demo?'DEMO · SIMULERTE DATA':sensorSource==='ant'?'LIVE · ANT+':'LIVE · BLUETOOTH'}</span>
              <button className={`sensor-chip ${status === "connected" ? "on" : ""} ${session.demo ? "demo" : ""}`} onClick={() => setDeviceModal(true)} aria-label="Sensorinnstillinger" title={status === "connected" ? "Sykkel tilkoblet" : "Sykkel ikke tilkoblet"}><i /><span>{session.demo ? "Sensorer" : status === "connected" ? "Sykkel" : "Koble til"}</span>{(sensors.heartRate ?? telemetry.heartRate) != null && <b>♥</b>}</button>
            </div>
          </div>
          {!session.ramp && (activeWorld==="tron"?<JourneyHUD journey={journey} state={expedition} paused={!session.running} onChoice={chooseMission} items={currentAchievements}/>:expeditionEnabled?<ExpeditionHUD progress={campaign} state={expedition} onChoice={chooseMission} paused={!session.running} demo={session.demo}/>:<div className="classic-progress">{Math.round(game.score).toLocaleString("nb-NO")} poeng · {game.stars} stjerner</div>)}
          <RideConsole workout={sessionWorkout(session)} current={current} elapsed={session.elapsed} skippedSeconds={session.skippedSeconds||0}
            distance={session.distance} target={target} power={livePower}
            cadence={session.demo?88:liveCadence===undefined?undefined:Math.round(liveCadence)}
            erg={erg.active ? { status: erg.status === "off" ? "pending" : erg.status, watts: erg.targetWatts } : null}
            heartRate={session.demo?null:(sensors.heartRate??telemetry.heartRate)}
            running={session.running} sound={sound} game={game} ghostDelta={ghost===null?null:game.score-ghost} onPause={togglePause} onSkip={skipSegment} onWarmup={skipWarmup}
            onSound={()=>{if(!sound)enableGameSound();setSound(!sound)}} onFullscreen={toggleFullscreen}
            samples={session.samples} ftp={session.ramp?.referenceFtp??ftp} rampStatus={session.ramp ? {interrupted:session.ramp.interrupted,belowTargetSeconds:session.ramp.belowTargetSeconds,ended:session.ramp.endSecond!==undefined} : undefined} energy={session.energy} focus={focusMode} onFocus={toggleFocus}
            onFinish={()=>{if(session.ramp?.endSecond!==undefined){finish(session,true);return;}updateSession({...session,running:false});setSelected(session.workout)}}/>
          {!session.running && !selected && (
            <div className="pause-overlay">
              <Pause size={30} />
              <h2>Pauset</h2>
              <div className="pause-stats">
                <span><b>{formatTime(session.elapsed)}</b>syklet</span>
                <span><b>{formatTime(current.totalRemaining)}</b>igjen</span>
                <span><b>{target} W</b>{current.block.label}</span>
              </div>
              <button className="primary" onClick={togglePause}>
                <Play size={17} /> Fortsett økten
              </button>
              <kbd>Mellomrom fortsetter</kbd>
            </div>
          )}
        </main>
      ) : (
        <main className="main">
          {page === "device-check" && <DeviceCheck onBack={() => setPage("home")} onClose={() => { if (readStored("summit-auto-connect", true)) void connection.current?.connectRemembered(); }} />}
          {page === 'ftp-test' && <><RampTestSetup ftp={ftp} history={history} onStart={startRamp} disabled={!!pendingStart}/><RampTestProgress history={history} onRepeat={repeatRamp}/></>}
          {page === "home" && (
            <>
              <div className="today-head">
                <div>
                  <span className="eyebrow">{greeting()} · {new Date().toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" })}</span>
                  <h1>Klar for neste økt?</h1>
                </div>
                <div className="today-stats">
                  <button className="today-stat ftp-chip" onClick={() => setSettings(true)} aria-label={`FTP ${ftp} W. Endre treningsprofil`}>
                    <Zap size={16} /><b>{ftp} W</b><span>FTP</span>
                  </button>
                  <button className="today-stat" onClick={() => setPage("history")}>
                    <Activity size={16} /><b>{Math.round(weekSeconds / 60)} min</b><span>siste 7 dager</span>
                  </button>
                  <button className={`today-stat sensor ${status === "connected" ? "ok" : ""}`} onClick={() => setDeviceModal(true)}>
                    <Bluetooth size={16} /><b>{status === "connected" ? "Sykkel klar" : status === "connecting" ? "Kobler til …" : "Koble til"}</b>{status === "connected" && (telemetry.power ?? null) !== null && <span>{telemetry.power} W nå</span>}
                  </button>
                </div>
              </div>
              <section className="hero-grid">
                <div className={`world-card world-${route}`}>
                  <WorldScene
                    running={false}
                    speed={0}
                    progress={0}
                    zoneColor="#f48468"
                    world={route}
                    game={idleVisual}
                    onRenderer={setRenderer}
                    achievements={savedAchievements.filter(x=>x.earned).map(x=>x.id)}
                  />
                  <div className="world-shade" />
                  <div className="world-top">
                    <span className="world-badge">
                      <i /> DIN VIRTUELLE VERDEN
                    </span>
                    <button
                      className="glass-button"
                      onClick={() => setRoutePicker(true)}
                    >
                      Bytt rute <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="world-info">
                    <div className="eyebrow">{featuredRoute.eyebrow}</div>
                    <h2>
                      {featuredRoute.name}
                      <span>
                        {route === "vestland" ? "NATUR" : route === "tron" ? "LIGHT CYCLE" : route === "neon"
                          ? "ARCADE"
                          : route === "sky"
                            ? "ADVENTURE"
                            : "CLASSIC"}
                      </span>
                    </h2>
                    <p>{featuredRoute.subtitle}</p>
                    <div className="route-info">
                      <span>
                        <Flag size={15} />
                        {featuredRoute.length}
                      </span>
                      <span>
                        <Mountain size={16} />
                        {route === "vestland" ? "Fjord · skog · bygd" : route === "tron" ? "3 grid-sektorer" : route === "neon"
                          ? "3 distrikter"
                          : route === "sky"
                            ? "3 øyriker"
                            : "Virtuelt terreng"}
                      </span>
                      <span>
                        <span className="live-dot" />
                        3D i sanntid
                      </span>
                    </div>
                  </div>
                  <button
                    className="world-play"
                    aria-label="Prøv ruten i demomodus"
                    onClick={() => start(readyWorkout, true)}
                  >
                    <Play size={23} fill="currentColor" />
                  </button>
                </div>
                <aside className="featured session-card">
                  <div className="featured-top">
                    <span className="eyebrow">DAGENS ØKT</span>
                    <button className="text-button" onClick={() => setPage("library")}>Alle {workouts.length} økter <ArrowRight size={14} /></button>
                  </div>
                  <div className="quick-duration" aria-label="Velg tid og intensitet">
                    {['recovery-10','endurance-20','threshold-4x10'].map((id)=>{ const w=workouts.find(x=>x.id===id);return w?<button key={id} className={readyWorkout.id===w.id?'chosen':''} aria-pressed={readyWorkout.id===w.id} onClick={()=>setReadyWorkout(w)}><b>{id==='threshold-4x10'?'4 × 10 min':id==='recovery-10'?'Lett':'Rolig'}</b><small>{workoutLength(w)}</small></button>:null;})}
                    {!['recovery-10','endurance-20','threshold-4x10'].includes(readyWorkout.id) && <button className="chosen" aria-pressed="true"><b>{readyWorkout.name}</b><small>{workoutLength(readyWorkout)}</small></button>}
                  </div>
                  <span className="session-category"><i style={{ background: zones[getZone(mainIntensity(readyWorkout) * 100, 100).id - 1].color }} />{readyWorkout.category}</span>
                  <h2>{readyWorkout.name}</h2>
                  <p>{readyWorkout.description}</p>
                  <div className="session-facts">
                    <div><b>{workoutLength(readyWorkout)}</b><span>totalt</span></div>
                    <div><b>{Math.round(mainIntensity(readyWorkout) * ftp)}<small> W</small></b><span>hoveddel</span></div>
                    <div><b>{Math.round(workoutTss(readyWorkout))}</b><span>TSS, anslag</span></div>
                  </div>
                  <ProfileChart workout={readyWorkout} />
                  <label className="already-warm"><input type="checkbox" checked={alreadyWarm} onChange={e=>setAlreadyWarm(e.target.checked)}/> Jeg er allerede varm <small>hopper over oppvarmingen</small></label>
                  <button
                    className="primary start-button"
                    onClick={() => start(readyWorkout, false)}
                  >
                    <Play size={18} fill="currentColor" />
                    Start økten
                    <ArrowRight size={18} />
                  </button>
                  <p className="start-hint">{status === "connected" ? `${deviceName || "Sykkelen"} er klar. Målene bruker FTP ${ftp} W.` : `Vi kobler til sykkelen når du trykker Start. Målene bruker FTP ${ftp} W.`}</p>
                  <div className="session-links">
                    <button className="text-button demo-start" onClick={() => start(readyWorkout, true)}>Ta en demotur</button>
                    <button className="text-button builder-launch" onClick={()=>setBuilder(null)}>+ Bygg egen økt</button>
                    <button className="text-button device-check-link" onClick={openDeviceCheck}>Test sykkelen din</button>
                  </div>
                </aside>
              </section>
              {route === "tron"?<><JourneyBoard journey={journeyFor(history,"tron")} route={missionRoute} onRoute={selectMissionRoute}/><AchievementBoard items={savedAchievements}/></>: (route === "neon" || route === "sky")?<CampaignBoard world={route} progress={campaignFor(history, route)} route={missionRoute} onRoute={selectMissionRoute}/>:<p className="classic-note">Den klassiske turen med intervaller og personlig rekord. Velg Neon Rush eller Skybound for ekspedisjoner med veivalg og en verden du bygger videre på.</p>}
              <RampTestSetup ftp={ftp} history={history} onStart={startRamp} disabled={!!pendingStart}/>
              <WorldShelf
                current={route}
                onSelect={chooseWorld}
                history={history}
              />
              <section className="dashboard-bottom">
                <div className="recommendations">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">EN ØKT FOR ALLE DAGER</span>
                      <h2>Hva har du lyst til i dag?</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("library")}
                    >
                      Se alle {workouts.length} økter <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="quick-cards">
                    {[
                      workouts.find(
                        (w) =>
                          w.name.includes("4") &&
                          w.name.includes("4") &&
                          w.category.toLowerCase().includes("vo"),
                      ),
                      workouts.find(
                        (w) => w.name.includes("2") && w.name.includes("20"),
                      ),
                      workouts.find((w) =>
                        w.category.toLowerCase().includes("sweet"),
                      ),
                    ]
                      .filter((w): w is Workout => !!w)
                      .map((w, i) => (
                        <button
                          className="quick-card"
                          key={w.id}
                          onClick={() => setSelected(w)}
                        >
                          <div className="quick-top">
                            <span
                              className="tag"
                              style={{
                                color: ["#ffb98a", "#f48468", "#73c8ea"][i],
                              }}
                            >
                              {w.category}
                            </span>
                            <ArrowRight size={16} />
                          </div>
                          <h3>{w.name}</h3>
                          <p>{w.subtitle}</p>
                          <ProfileChart workout={w} />
                          <div className="quick-meta">
                            <span>{workoutLength(w)}</span>
                            <span>
                              {
                                [
                                  "Bygg kapasitet",
                                  "Flytt terskelen",
                                  "Finn balansen",
                                ][i]
                              }
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
                <aside className="weekly-card">
                  <div className="section-heading">
                    <h3>Din uke</h3>
                    <Activity size={19} />
                  </div>
                  <div className="week-total">
                    {Math.round(weekSeconds / 60)}
                    <span>min</span>
                  </div>
                  <p>
                    {weekRides.length
                      ? `${weekRides.length} økter. Hver omdreining teller.`
                      : "Nye muligheter. Én økt av gangen."}
                  </p>
                  <div className="week-bars">
                    {Array.from({ length: 7 }, (_, i) => {
                      const day = new Date();
                      day.setDate(day.getDate() - 6 + i);
                      const seconds = weekRides
                        .filter(
                          (r) =>
                            new Date(r.date).toDateString() ===
                            day.toDateString(),
                        )
                        .reduce((a, r) => a + r.seconds, 0);
                      return (
                        <div key={i}>
                          <div>
                            <i
                              style={{
                                height: `${seconds ? Math.max(8, Math.min(100, (seconds / 3600) * 100)) : 5}%`,
                              }}
                            />
                          </div>
                          <span>
                            {["S", "M", "T", "O", "T", "F", "L"][day.getDay()]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setPage("history")}
                  >
                    Se din utvikling <ArrowRight size={15} />
                  </button>
                </aside>
              </section>
            </>
          )}
          {page === "library" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BYGG DIN NESTE GODE ØKT</div>
                  <h1>
                    {workouts.length} veier til <span>bedre form.</span>
                  </h1>
                  <p>
                    Klassiske intervaller og varianter. Wattmål tilpasset din
                    FTP på {ftp} W.
                  </p>
                </div>
                <button className="ftp-chip" onClick={() => setSettings(true)}>
                  <Settings2 size={16} />
                  Tilpass FTP
                </button>
              </div>
              <div className="custom-library-tools"><button className="primary builder-launch" onClick={()=>setBuilder(null)}>+ Bygg egen økt</button><p role="status">{customLibrary.message || 'Serier, korte drag og pauser – med tid eller virtuell distanse.'}</p></div>
              <div className="library-tools">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    placeholder="Søk etter økt, f.eks. 3 × 10 …"
                    aria-label="Søk etter økt"
                    value={query}
                    onChange={(e) =>
                      setQuery(e.target.value.replace(/(\d)x(?=\d)/g, "$1 × "))
                    }
                  />
                  {query && (
                    <button aria-label="Tøm søk" onClick={() => setQuery("")}>
                      <X size={15} />
                    </button>
                  )}
                </div>
                <span>{filtered.length} økter</span>
              </div>
              <div className="category-filters">
                {categories.map((c) => (
                  <button
                    className={category === c ? "selected" : ""}
                    key={c}
                    onClick={() => setCategory(c)}
                  >
                    {c === "Favoritter" && <Star size={13} />} {c}
                  </button>
                ))}
              </div>
              <div className="workout-grid">
                {filtered.map((w) => (
                  <article className="library-card" key={w.id}>
                    <div className="quick-top">
                      <span className="tag">{w.category}</span>
                      <button
                        className={`favorite ${favorites.includes(w.id) ? "saved" : ""}`}
                        aria-label={
                          favorites.includes(w.id)
                            ? `Fjern ${w.name} fra favoritter`
                            : `Lagre ${w.name} som favoritt`
                        }
                        onClick={() => favorite(w.id)}
                      >
                        <Star
                          size={17}
                          fill={
                            favorites.includes(w.id) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </div>
                    <button
                      className="card-content"
                      onClick={() => setSelected(w)}
                    >
                      <h3>{w.name}</h3>
                      <p>{w.subtitle}</p>
                      <ProfileChart workout={w} />
                      <div className="quick-meta">
                        <span>
                          <Clock3 size={14} />
                          {workoutLength(w)}
                        </span>
                        <span>
                          {"●".repeat(w.difficulty)}
                          {"○".repeat(3 - w.difficulty)}{" "}
                          <ArrowRight size={15} />
                        </span>
                      </div>
                    </button>
                    {w.custom && <div className="custom-card-actions">
                      <button onClick={()=>setBuilder(draftFor(w))}>Rediger</button>
                      <button onClick={()=>{const draft=draftFor(w);if(draft)setBuilder({...draft,id:crypto.randomUUID(),name:`${draft.name} – kopi`.slice(0,200)});}}>Kopier</button>
                      {deleteTemplate===w.id ? <><button className="delete-confirm" onClick={()=>{const draft=draftFor(w);if(draft)void customLibrary.remove(draft.id).then(()=>{if(readyWorkout.id===w.id)setReadyWorkout(featured);setDeleteTemplate(null)}).catch(e=>setError(String(e)));}}>Slett malen</button><button onClick={()=>setDeleteTemplate(null)}>Avbryt</button></> : <button onClick={()=>setDeleteTemplate(w.id)}>Slett</button>}
                    </div>}
                  </article>
                ))}
              </div>
              {!filtered.length && (
                <div className="empty-state">
                  <Search size={32} />
                  <h2>Ingen økter her ennå.</h2>
                  <p>
                    {category === "Favoritter"
                      ? "Trykk på stjernen ved en økt for å lagre den."
                      : "Prøv et annet søk eller en annen kategori."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setQuery("");
                      setCategory("Alle");
                    }}
                  >
                    Vis alle økter
                  </button>
                </div>
              )}
            </>
          )}
          {page === "history" && (
            <>
              <div className="today-head">
                <div>
                  <span className="eyebrow">MIN UTVIKLING</span>
                  <h1>Formen din over tid</h1>
                </div>
                <div className="today-stats">
                  <span className="today-stat"><Activity size={16} /><b>{actualRides.length}</b><span>{actualRides.length === 1 ? "målt økt" : "økter"}</span></span>
                  <span className="today-stat"><Clock3 size={16} /><b>{(actualRides.reduce((a, r) => a + r.seconds, 0) / 3600).toFixed(1)} t</b><span>på sykkelen</span></span>
                  <span className="today-stat"><Flag size={16} /><b>{actualRides.reduce((a, r) => a + r.distance, 0).toFixed(0)} km</b><span>virtuelt</span></span>
                  <button className="today-stat" disabled={!history.length} onClick={() => download("summit-treningshistorikk.json", JSON.stringify(history, null, 2))}>
                    <ArrowDownToLine size={16} /><b>Eksporter</b>
                  </button>
                </div>
              </div>
              <TrainingTrends history={history} />
              <RampTestProgress history={history} onRepeat={repeatRamp}/>
              <ProgressPanel
                history={history}
                ftp={ftp}
                online={backendOnline}
              />
              {history.length ? (
                <div className="history-list">
                  {history.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSummary(r);
                        setSummarySamples(
                          (r.samples ?? []).map((sample) => ({
                            ...sample,
                            cadence: sample.cadence ?? null,
                            heartRate: sample.heartRate ?? null,
                          })),
                        );
                      }}
                    >
                      <span className="history-icon">
                        <Bike size={23} />
                      </span>
                      <div>
                        <strong>{r.name}</strong>
                        <span>
                          {new Date(r.date).toLocaleDateString("nb-NO", {
                            weekday: "short",
                            day: "numeric",
                            month: "long",
                          })}{" "}
                          ·{" "}
                          {r.demo
                            ? "Demotur"
                            : r.completed
                              ? "Fullført"
                              : "Avsluttet tidlig"}
                          {r.worldId ? ` · ${worldById(r.worldId).name}` : ""}
                        </span>
                        <i className="history-zones" aria-hidden="true">{zones.map((z, i) => r.zoneSeconds[i] > 0 && <b key={z.id} style={{ flex: r.zoneSeconds[i], background: z.color }} />)}</i>
                      </div>
                      <span className="history-stat"><b>{formatDuration(r.seconds)}</b><small>tid</small></span>
                      <span className="history-stat"><b>{r.avgPower} W</b><small>snitt</small></span>
                      <span className="history-stat"><b>{loadById.get(r.id) ?? "—"}</b><small>TSS</small></span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Mountain size={48} />
                  <h2>Din første topp venter.</h2>
                  <p>
                    Start en økt, så får du oversikt over treningen din her.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setPage("library")}
                  >
                    Finn en økt <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            <span>
              <IconLogo /> LAGET FOR TUREN. OG DEG.
            </span>
            <span>
              {workouts.length} økter <i /> {routes.length} verdener <i /> Uendelige muligheter
            </span>
            <span>SUMMIT / XEBEX</span>
          </footer>
        </main>
      )}
      {pendingStart && (
        <div className="quick-connect-banner" role="status">
          <Bluetooth size={19} />
          <div>
            <strong>
              {status === "connected"
                ? "Tråkk, så starter vi."
                : "Kobler til sykkelen …"}
            </strong>
            <span>{pendingStart.name} starter når ferske wattdata kommer.</span>
          </div>
          <button
            aria-label="Avbryt automatisk øktstart"
            onClick={() => setPendingStart(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {error && (
        <div className="toast" role="status">
          <Bluetooth size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Lukk melding">
            <X size={17} />
          </button>
        </div>
      )}
      {summary && !dialogOpen && (
        <RideReport
          ride={summary}
          samples={summary.samples ?? []}
          history={history}
          onClose={() => setSummary(null)}
          onHistory={() => { setSummary(null); setPage("history"); }}
          onFit={() => void exportFit(summary)}
          fitDisabled={summary.demo || !summary.samples?.length}
          fitTitle={summary.demo ? "FIT krever ekte sensordata. Demoturer kan eksporteres som CSV." : undefined}
          csvLabel={`Eksporter ${summarySamples.length ? "måledata (CSV)" : "øktoppsummering"}`}
          onCsv={() => summarySamples.length
            ? download("summit-okt.csv", "sekund,watt,kadens,puls\n" + summarySamples.map((s) => `${s.second},${s.power},${s.cadence ?? ""},${s.heartRate ?? ""}`).join("\n"), "text/csv")
            : download("summit-okt.json", JSON.stringify(summary, null, 2))}
          ramp={summary.rampTest ? <RampTestResult ride={summary} history={history} onApply={applyRampFtp} onRepeat={repeatRamp} canApply={!session} currentFtp={ftp}/> : undefined}
          achievements={<AchievementReceipt items={summaryAchievements} demo={summary.demo}/>}
          rewards={(summary.expedition || summary.game) ? <>
            {summary.worldId==="tron" && summary.expedition && <JourneyReceipt journey={journeyForRide(history,summary)} count={summary.expedition.completed}/>}
            {summary.expedition && <ExpeditionSummary result={summary.expedition} progress={campaignFor(history, summary.worldId ?? 'neon')} demo={summary.demo}/>}
            {summary.game && <GameSummary result={summary.game} world={summary.worldId ?? "fjord"} demo={summary.demo}/>}
          </> : undefined}
        />
      )}
      {dialogOpen && !rampSetup && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSettings(false);
              setSelected(null);
              setDeviceModal(false);
              setRoutePicker(false);
              setSummary(null);
            }
          }}
        >
          <section
            className={`modal ${selected ? "workout-modal" : ""} ${summary ? "summary-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              settings
                ? "Din treningsprofil"
                : deviceModal
                  ? "Koble til sykkel"
                  : routePicker
                    ? "Velg rute"
                    : summary
                      ? "Oppsummering"
                      : "Øktdetaljer"
            }
          >
            <button
              className="modal-close"
              aria-label="Lukk"
              onClick={() => {
                setSettings(false);
                setSelected(null);
                setDeviceModal(false);
                setRoutePicker(false);
                setSummary(null);
              }}
            >
              <X size={22} />
            </button>
            {settings ? (
              <>
                <span className="modal-symbol">
                  <Settings2 />
                </span>
                <div className="eyebrow">DIN MOTOR. DINE SONER.</div>
                <h2>Gjør treningen personlig.</h2>
                <p>
                  FTP er terskeleffekten din i watt. Vi bruker den til å beregne
                  mål og intensitet for alle øktene.
                </p>
                <label className="ftp-input-label" htmlFor="ftp">
                  Din FTP <span>watt</span>
                </label>
                <div className="ftp-input">
                  <input
                    id="ftp"
                    type="number"
                    min="50"
                    max="600"
                    value={ftpDraft}
                    disabled={!!session}
                    onChange={(e) => setFtpDraft(e.target.value)}
                  />
                  <Zap size={24} />
                </div>
                {session && (
                  <p className="muted">
                    FTP kan endres når økten er avsluttet.
                  </p>
                )}
                <div className="zone-list">
                  {zones.map((z, i) => (
                    <div key={z.id}>
                      <i style={{ background: z.color }} />
                      <span>
                        Z{z.id} · {z.name}
                      </span>
                      <strong>
                        {i === 0
                          ? "0"
                          : Math.floor(z.min * (Number(ftpDraft) || ftp)) + 1}
                        –
                        {Number.isFinite(z.max)
                          ? Math.floor(z.max * (Number(ftpDraft) || ftp))
                          : "∞"}{" "}
                        W
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="fine-print">
                  FTP-soner er veiledende. Sprintsonen over 150 % er en praktisk
                  forenkling.
                </p>
                <button
                  className="primary full"
                  disabled={
                    !!session ||
                    !Number.isFinite(Number(ftpDraft)) ||
                    Number(ftpDraft) < 50 ||
                    Number(ftpDraft) > 600
                  }
                  onClick={() => {
                    const value = Math.round(Number(ftpDraft));
                    persistFtp(value);
                    setSettings(false);
                  }}
                >
                  <Check size={17} />
                  Lagre treningsprofil
                </button>
              </>
            ) : deviceModal ? (
              <>
                <span className="modal-symbol">
                  <Bluetooth />
                </span>
                <div className="eyebrow">FRA SYKKEL TIL FJELL</div>
                <h2>
                  {status === "connected"
                    ? "Du er tilkoblet."
                    : "Koble til din Xebex."}
                </h2>
                <p>
                  Slå på konsollen og tråkk noen omdreininger. Velg sykkelen i
                  nettleserens Bluetooth-vindu.
                </p>
                <div className="device-status">
                  <span
                    className={`status-dot ${status === "connected" ? "on" : ""}`}
                  />
                  <div>
                    <strong>
                      {status === "connected"
                        ? (sensorSource === "ant"
                            ? "ANT+ sykkel 47963"
                            : deviceName) || "Sykkel tilkoblet"
                        : bleStatus === "connecting"
                          ? "Søker etter sykkelen …"
                          : "Klar for tilkobling"}
                    </strong>
                    <span>
                      {sensorSource === "ant"
                        ? "ANT+ via USB-mottaker"
                        : "Bluetooth FTMS / Cycling Power"}
                    </span>
                  </div>
                  <Bike size={28} />
                </div>
                {status === "connected" && (
                  <div className="device-metrics">
                    <span>
                      {telemetry.power ?? "—"}
                      <small>watt</small>
                    </span>
                    <span>
                      {liveCadence === undefined
                        ? "—"
                        : Math.round(liveCadence)}
                      <small>rpm</small>
                    </span>
                    <span>
                      {sensors.heartRate ?? telemetry.heartRate ?? "—"}
                      <small>puls</small>
                    </span>
                  </div>
                )}
                <ErgToggle erg={erg} riding={!!session} />
                <p className="fine-print">
                  Bruk Chrome eller Edge på en støttet datamaskin eller Android,
                  via localhost eller HTTPS. Sykkelen må sende FTMS- eller
                  Cycling Power-data. {erg.supported ? "Uten ERG justerer du motstanden selv." : "Motstand justeres på sykkelen."}
                </p>
                {!bluetoothAvailable() && (
                  <div className="inline-notice">
                    Denne nettleseren støtter ikke Web Bluetooth. Du kan
                    fortsatt utforske alle øktene i demomodus.
                  </div>
                )}
                <button
                  className="primary full"
                  disabled={
                    bleStatus === "connecting" ||
                    (!bluetoothAvailable() && bleStatus !== "connected")
                  }
                  onClick={() => {
                    setError("");
                    if (bleStatus === "connected")
                      connection.current?.disconnect();
                    else void connection.current?.connect();
                  }}
                >
                  <Bluetooth size={17} />
                  {bleStatus === "connected"
                    ? "Koble fra BLE-sykkel"
                    : bleStatus === "connecting"
                      ? "Venter på tilkobling …"
                      : "Finn sykkelen min"}
                </button>
                {!session && status === "connected" && (
                  <button
                    className="primary full"
                    onClick={() => {
                      setDeviceModal(false);
                      start(readyWorkout, false);
                    }}
                  >
                    <Play size={16} />
                    Start {readyWorkout.name}
                  </button>
                )}
                <button
                  className="text-button center"
                  onClick={() => {
                    setDeviceModal(false);
                    if (!session) start(readyWorkout, true);
                  }}
                >
                  {session ? "Tilbake til økten" : "Prøv en demotur først"}
                  <ArrowRight size={15} />
                </button>
                {!session && <button className="text-button center device-check-link" onClick={openDeviceCheck}>Test sykkelen din: se hva den støtter</button>}
                <div className="auto-connect-settings">
                  <label>
                    <input
                      type="checkbox"
                      checked={autoConnect}
                      onChange={(e) => {
                        setAutoConnect(e.target.checked);
                        saveStored("summit-auto-connect", e.target.checked);
                      }}
                    />
                    <span>Husk sensorene og koble til automatisk</span>
                  </label>
                  <p>
                    {hasRememberedBike()
                      ? `Husket: ${rememberedBikeName() || "sykkelen din"}.`
                      : "Velg sykkelen én gang. Vi husker den til neste tur."}{" "}
                    Automatisk tilkobling krever at nettleseren støtter det.
                  </p>
                  {hasRememberedBike() && (
                    <button
                      className="text-button"
                      onClick={() => {
                        connection.current?.disconnect();
                        forgetRememberedBike();
                        setError("Lagret sykkel er glemt.");
                      }}
                    >
                      Glem lagret sykkel
                    </button>
                  )}
                </div>
                <SensorPanel
                  sensors={sensors}
                  source={sensorSource}
                  onSource={changeSource}
                />
              </>
            ) : routePicker ? (
              <>
                <div className="eyebrow">VELG DIN UTSIKT</div>
                <h2>Hvor går turen?</h2>
                <p>Fart, eventyr eller ro. Velg din neste verden.</p>
                <div className="route-choices">
                  {routes.map((r, i) => (
                    <button
                      key={r.id}
                      className={route === r.id ? "chosen" : ""}
                      onClick={() => {
                        chooseWorld(r.id);
                        setRoutePicker(false);
                      }}
                    >
                      <div
                        style={{
                          background: `linear-gradient(145deg, ${r.color}, #28483b)`,
                        }}
                      >
                        <WorldGlyph world={r.id} />
                      </div>
                      <span>
                        <small>{r.genre}</small>
                        <strong>{r.name}</strong>
                        <small>{r.subtitle}</small>
                      </span>
                      {route === r.id ? (
                        <Check size={20} />
                      ) : (
                        <ArrowRight size={20} />
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : selected && session ? (
              <>
                <span className="modal-symbol">
                  <Flag />
                </span>
                <h2>Avslutte turen?</h2>
                <p>
                  Du har syklet {formatTime(session.elapsed)}. Økten lagres med
                  det du har gjennomført.
                </p>
                <button
                  className="primary full"
                  onClick={() => {
                    finish(session, false);
                    setSelected(null);
                  }}
                >
                  Lagre og avslutt <Check size={17} />
                </button>
                <button
                  className="secondary full"
                  onClick={() => {
                    setSelected(null);
                    togglePause();
                  }}
                >
                  Fortsett økten
                </button>
              </>
            ) : selected ? (
              <>
                <div className="eyebrow">
                  {selected.category} / DIN NESTE UTFORDRING
                </div>
                <h2>{selected.name}</h2>
                <p>{selected.description}</p>
                <div className="detail-meta">
                  <span>
                    <Clock3 size={16} />
                    {workoutLength(selected)}
                  </span>
                  <span>
                    <Zap size={16} />
                    ca. {Math.round(workoutTss(selected))} TSS
                  </span>
                  <button
                    className="favorite"
                    aria-label="Favoritt"
                    onClick={() => favorite(selected.id)}
                  >
                    <Star
                      size={17}
                      fill={
                        favorites.includes(selected.id)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </div>
                <ProfileChart workout={selected} large />
                <div className="chart-labels">
                  <span>0 min</span>
                  <span>{workoutLength(selected)}</span>
                </div>
                <h3>Planlagt sonefordeling</h3>
                <div className="distribution">
                  {zoneDistribution(selected)
                    .filter((z) => z.seconds > 0)
                    .map((z) => (
                      <div
                        key={z.zone}
                        style={{
                          flex: z.seconds,
                          background: zones[z.zone - 1].color,
                        }}
                        title={`Sone ${z.zone}: ${formatDuration(z.seconds)}`}
                      />
                    ))}
                </div>
                <div className="distribution-labels">
                  {zoneDistribution(selected)
                    .filter((z) => z.seconds > 0)
                    .map((z) => (
                      <span key={z.zone}>
                        <i style={{ background: zones[z.zone - 1].color }} />Z
                        {z.zone} · {Math.round(z.seconds / 60)} min
                      </span>
                    ))}
                </div>
                <div className="block-list">
                  {selected.blocks.map((b, i) => (
                    <div key={i}>
                      <i
                        style={{
                          background: getZone(b.intensity * ftp, ftp).color,
                        }}
                      />
                      <span>{b.label}</span>
                      <span>{b.distanceMeters!==undefined?`${b.distanceMeters} m`:formatTime(b.seconds)}</span>
                      <strong>{Math.round(b.intensity * ftp)} W</strong>
                    </div>
                  ))}
                </div>
                <button
                  className="primary full"
                  onClick={() => start(selected, false)}
                >
                  <Bluetooth size={17} />
                  {status === "connected"
                    ? "Start med sykkelen"
                    : "Koble til og start"}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="secondary full"
                  onClick={() => start(selected, true)}
                >
                  <Play size={16} />
                  Prøv økten i demomodus
                </button>
                <p className="fine-print">
                  {selected.blocks.some(b=>b.distanceMeters!==undefined) && <>Tid, sonefordeling og TSS er anslag ved 30 km/t. Distanseblokker styres av virtuelle meter beregnet fra watt. </>}TSS er et estimat basert på planlagt intensitet. Juster
                  motstanden manuelt for å følge wattmålet.
                </p>
              </>
            ) : null}
          </section>
        </div>
      )}
      {rampSetup && <div className="modal-backdrop" onClick={()=>setRampSetup(null)}><div className="modal ramp-setup-modal" role="dialog" aria-modal="true" aria-label="Gjenta FTP-test" onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Lukk FTP-test" onClick={()=>setRampSetup(null)}><X/></button><RampTestSetup ftp={ftp} history={history} initialProtocol={rampSetup} onStart={startRamp} disabled={!!pendingStart}/></div></div>}
      {builder!==undefined && <WorkoutBuilder initial={builder??undefined} ftp={ftp} onClose={()=>setBuilder(undefined)} onSave={async draft=>{await customLibrary.save(draft);setReadyWorkout(compileCustomWorkout(draft));setBuilder(undefined);setCategory('Egne økter');setQuery('');setPage('library');}}/>}
    </div>
  );
}
