import {
  Flame,
  Sparkles,
  Star,
  Trophy,
  Zap,
  Target,
  ArrowRight,
} from "lucide-react";
import type { GameState, GameResult } from "./game";
import { careerLevel } from "./game";
import { worldById, worlds, type WorldId } from "./worlds";
import type { RideRecord } from "./storage";
export function WorldGlyph({ world }: { world: WorldId }) {
  return (
    <svg
      viewBox="0 0 300 110"
      fill="none"
      aria-hidden="true"
      className={`world-glyph glyph-${world}`}
    >
      <defs>
        <linearGradient id={`g-${world}`} x1="0" y1="0" x2="1" y2="1">
          <stop
            stopColor={
              world === "neon"
                ? "#8b3cff"
                : world === "sky"
                  ? "#86ddd6"
                  : "#8cbaa1"
            }
          />
          <stop
            offset="1"
            stopColor={
              world === "neon"
                ? "#081324"
                : world === "sky"
                  ? "#243b78"
                  : "#163e37"
            }
          />
        </linearGradient>
      </defs>
      <rect width="300" height="110" fill={`url(#g-${world})`} />
      {world === "vestland" ? (<>
        <rect width="300" height="110" fill="#b9d0d0" />
        <path d="m0 45 29-21 18 11 38-28 34 18 28-8 41 28 30-25 23 13 20-15 39 20v72H0Z" fill="#889d99" />
        <path d="m0 63 25-20 23 7 35-16 36 29 30-11 37 14 29-19 41 10 44-22v75H0Z" fill="#536d5b" />
        <path d="M0 70h197l37 40H0Z" fill="#7ea3a3" />
        <path d="M0 86h120m-110 8h69m-62 8h63" stroke="#a4bdb6" strokeWidth="1" opacity=".5" />
        <path d="M300 58q-87 4-96 21t-61 31h157Z" fill="#657848" />
        <path d="M218 110q39-17 7-27t44-21" stroke="#a3a99b" strokeWidth="17" />
        <path d="M218 110q39-17 7-27t44-21" stroke="#656b67" strokeWidth="12" />
        <path d="M218 110q39-17 7-27t44-21" stroke="#ddd9bd" strokeWidth=".7" strokeDasharray="4 4" />
        {[181,197,286].map((x,i)=><g key={x} transform={`translate(${x} ${74-i*5})`}><path d="M0 0v-25" stroke="#e0ded0" strokeWidth="2"/><ellipse cy="-25" rx="8" ry="12" fill={i===1?'#6e844d':'#526e43'}/><ellipse cx="-3" cy="-29" rx="5" ry="7" fill="#8a995f"/></g>)}
        <path d="M249 62V51h18v11Z" fill="#a96951" />
        <path d="m246 51 12-9 12 9Z" fill="#585854" />
        <path d="M253 53h4v4h-4Zm8 0h4v4h-4Z" fill="#e6e1ca" />
      </>) : world === "tron" ? (<>
        <rect width="300" height="110" fill="#020910"/>
        {[20,40,65,95].map(y=><path key={y} d={`M0 ${y}H300`} stroke="#0f6d82" strokeWidth=".7"/>)}
        {[-150,-60,30,120,210,300,390,480].map(x=><path key={x} d={`M150 10L${x} 110`} stroke="#126378" strokeWidth=".7"/>)}
        <path d="M70 100V45h50V25h85v45h30v30" stroke="#55e9ff" strokeWidth="3"/>
        <path d="M0 92h140" stroke="#ff952e" strokeWidth="7"/>
        <circle cx="155" cy="85" r="15" fill="#050c12" stroke="#70f4ff" strokeWidth="4"/>
        <circle cx="204" cy="85" r="15" fill="#050c12" stroke="#70f4ff" strokeWidth="4"/>
        <path d="m154 80 14-16h29l9 17-37 6Z" fill="#142e39" stroke="#b7f7ff"/>
      </>) : world === "neon" ? (
        <>
          <circle cx="232" cy="25" r="32" fill="#fc808d" opacity=".6" />
          {[10, 35, 58, 80, 104, 226, 252, 281].map((x, i) => (
            <g key={x}>
              <rect
                x={x}
                y={18 + (i % 3) * 15}
                width={14 + (i % 3) * 3}
                height="85"
                fill="#151537"
              />
              <path
                d={`M${x + 4} ${24 + (i % 3) * 15}v55`}
                stroke={i % 2 ? "#ed57f0" : "#60f7ff"}
                strokeWidth="2"
              />
            </g>
          ))}
          <path
            d="M70 110 140 52h20l75 58"
            fill="#1d1747"
            stroke="#57edff"
            strokeWidth="2"
          />
          <path d="M122 110 148 52M178 110l-26-58" stroke="#f569ff" />
          <path d="M127 67V35h46v32" stroke="#5ef6ff" strokeWidth="3" />
        </>
      ) : world === "sky" ? (
        <>
          <circle cx="231" cy="28" r="20" fill="#ffdfae" />
          {[30, 113, 224].map((x, i) => (
            <g key={x}>
              <path
                d={`M${x} ${62 - i * 10}l25-13 35 9-31 40Z`}
                fill="#465676"
              />
              <ellipse
                cx={x + 30}
                cy={57 - i * 10}
                rx="33"
                ry="10"
                fill="#99c9a0"
              />
              <path
                d={`M${x + 30} ${48 - i * 10}v-25m-9 5 9-7 9 7`}
                stroke="#ffdf97"
                strokeWidth="4"
              />
              <path
                d={`M${x + 8} ${59 - i * 10}v36`}
                stroke="#7ce4ed"
                strokeWidth="5"
                opacity=".6"
              />
            </g>
          ))}
          <path d="M50 110Q190 45 131 21" stroke="#fce5ac" strokeWidth="9" />
          <ellipse
            cx="137"
            cy="18"
            rx="16"
            ry="21"
            stroke="#ffde8d"
            strokeWidth="3"
          />
        </>
      ) : (
        <>
          <path d="m0 65 65-57 72 58L223 0l77 65v45H0Z" fill="#2b5b5e" />
          <path d="m27 42 38-34 32 32-27-8-14 8-7-11Z" fill="#d0e2d7" />
          <path d="M95 110q100-45 70-65" stroke="#cdd7b0" strokeWidth="6" />
          <path d="M0 84h120l-25 26H0Z" fill="#46a29b" />
        </>
      )}
    </svg>
  );
}
export function WorldShelf({
  current,
  onSelect,
  history,
}: {
  current: WorldId;
  onSelect: (world: WorldId) => void;
  history: RideRecord[];
}) {
  const xp = history
    .filter((r) => !r.demo)
    .reduce((sum, r) => sum + (r.game?.score ?? 0), 0);
  const rank = careerLevel(xp);
  return (
    <section className="world-shelf">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ET NYTT STED Å MESTRE</span>
          <h2>Hvilken verden kaller?</h2>
        </div>
        <div className="career-rank">
          <span>NIVÅ {rank.level}</span>
          <strong>{rank.title}</strong>
          <div>
            <i style={{ width: `${rank.progress * 100}%` }} />
          </div>
          <small>{Math.ceil(rank.remaining)} XP til neste nivå</small>
        </div>
      </div>
      <div className="world-shelf-grid">
        {worlds.filter(w=>["vestland","tron","neon","sky","fjord"].includes(w.id)).map((world) => {
          const records = history.filter(
            (r) => !r.demo && r.worldId === world.id,
          );
          const best = Math.max(0, ...records.map((r) => r.game?.score ?? 0));
          return (
            <button
              className={`world-option ${current === world.id ? "chosen" : ""}`}
              key={world.id}
              onClick={() => onSelect(world.id)}
              style={{ "--world-color": world.color } as React.CSSProperties}
            >
              <WorldGlyph world={world.id} />
              <div className="world-option-content">
                <span className="eyebrow">{world.genre}</span>
                <h3>
                  {world.name}
                  <ArrowRight size={18} />
                </h3>
                <p>{world.subtitle}</p>
                <div>
                  <span>
                    {current === world.id ? "VALGT VERDEN" : "UTFORSK VERDEN"}
                  </span>
                  <span>
                    {best
                      ? `${best.toLocaleString("nb-NO")} · REKORD`
                      : "NY HORISONT"}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
export function GameHUD({
  game,
  world,
  ghost,
  workBlocks,
  demo,
  remaining,
  sector,
}: {
  sector: number;
  game: GameState;
  world: WorldId;
  ghost: number | null;
  workBlocks: number;
  demo: boolean;
  remaining: number;
}) {
  const info = worldById(world);
  const eventVisible = game.elapsed - game.eventAt < 3.5;
  return (
    <>
      <section
        className={`game-hud quality-${game.quality}`}
        aria-label="Spillprogresjon"
        style={{ "--world-color": info.color } as React.CSSProperties}
      >
        <div className="game-hud-top">
          <span>
            <span className="signal-light" />
            {game.phase === "recovery" || game.phase === "cooldown"
              ? "LADEMODUS"
              : game.phase === "warmup"
                ? "SYSTEMSTART"
                : "OPPDRAG AKTIVT"}
          </span>
          <span>{demo ? "TRENINGSMODUS" : "REKORDLØP"}</span>
        </div>
        <div className="game-score-row">
          <div>
            <strong>{Math.floor(game.score).toLocaleString("nb-NO")}</strong>
            <small>POENG</small>
          </div>
          <div className={`combo ${game.combo >= 2 ? "hot" : ""}`}>
            <Flame size={18} />
            <strong>{game.combo}/4</strong>
            <small>FLYT</small>
          </div>
          <div
            className="charge-disc"
            style={{
              background: `conic-gradient(${info.color} ${game.charge * 360}deg,#ffffff12 0deg)`,
            }}
          >
            <div>
              <Zap size={20} />
              <span>{Math.round(game.charge * 100)}%</span>
            </div>
          </div>
        </div>
        <div className="flow-progress">
          <i style={{ width: `${game.charge * 100}%` }} />
        </div>
        <div className="game-feedback">
          <span>
            {game.quality === "locked"
              ? "FREKVENS LÅST"
              : game.quality === "high"
                ? "SENK WATT · FINN FREKVENSEN"
                : game.quality === "low"
                  ? "ØK WATT · FINN FREKVENSEN"
                  : "VENTER PÅ RYTMEN"}
          </span>
          <span>{Math.round(game.accuracy * 100)}% presisjon</span>
        </div>
        <p>
          {game.phase === "recovery" || game.phase === "cooldown"
            ? "Rolig kraft lader like mye. Følg pausens wattmål."
            : `Hold wattmålet i ${Math.max(1, Math.ceil((1 - game.charge) * 12))} sek for neste ${world === "sky" ? "lysfrø" : "energipuls"}.`}
        </p>
      </section>
      <div className="game-mission">
        <span className="mission-icon">
          {world === "sky" ? <Sparkles size={18} /> : <Target size={18} />}
        </span>
        <div>
          <small>
            {info.mission.toUpperCase()} · {info.sectors[sector % 3]}
          </small>
          <strong>
            {game.masteredBlocks} / {workBlocks} drag mestret{" "}
            <span>
              {"★".repeat(Math.min(3, game.stars))}
              {game.stars > 3 ? ` +${game.stars - 3}` : ""}
            </span>
          </strong>
        </div>
        <span className="mission-pulses">
          <Zap size={12} />
          {game.pulses}
        </span>
        {ghost !== null && (
          <span className={`ghost-delta ${game.score >= ghost ? "ahead" : ""}`}>
            {Math.round(game.score - ghost) >= 0 ? "+" : ""}
            {Math.round(game.score - ghost)}
            <small>mot eget beste</small>
          </span>
        )}
      </div>
      {eventVisible && (
        <div key={game.eventSerial} className="game-reward">
          <Sparkles size={18} />
          <span>
            {game.event.replace(
              "ENERGI AKTIVERT",
              world === "sky" ? "LYSFRØ VEKKET" : "ENERGIPULS AKTIVERT",
            )}
          </span>
        </div>
      )}
      {remaining <= 5 && remaining > 0 && (
        <div className="segment-countdown" aria-live="off">
          {Math.ceil(remaining)}
          <span>NESTE FASE</span>
        </div>
      )}
    </>
  );
}
export function GameSummary({
  result,
  demo,
  world,
}: {
  result: GameResult;
  demo: boolean;
  world: WorldId;
}) {
  const info = worldById(world);
  return (
    <div className="game-summary">
      <div>
        <Trophy size={20} />
        <span>
          {info.name} · {demo ? "øvingsrunde" : "lagret rekordløp"}
        </span>
      </div>
      <strong>
        {result.score.toLocaleString("nb-NO")}
        <small>{demo ? " poeng" : " XP"}</small>
      </strong>
      <div className="game-summary-stats">
        <span>
          <Star size={14} />
          {result.stars} stjerner
        </span>
        <span>
          <Zap size={14} />
          {result.pulses} {world === "sky" ? "lysfrø" : "pulser"}
        </span>
        <span>
          <Flame size={14} />Flytnivå {result.bestCombo}/4
        </span>
      </div>
      <p>
        {demo
          ? "Prøv mekanikken fritt. Ekte sykkelturer bygger ditt nivå og rekordløp."
          : `${result.masteredBlocks} drag mestret. ${Math.round(result.observed ? (result.onTarget / result.observed) * 100 : 0)} % av spillets måletid innenfor wattmålet.`}
      </p>
    </div>
  );
}
