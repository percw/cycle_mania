import { useMemo } from "react";
import { TrendingUp, Zap, Target, Database } from "lucide-react";
import { analyzeRide } from "./analytics";
import type { RideRecord } from "./storage";
export function RideAnalysis({
  ride,
  history,
}: {
  ride: RideRecord;
  history: RideRecord[];
}) {
  const analysis = useMemo(() => analyzeRide(ride, history), [ride, history]);
  return (
    <div className="ride-analysis">
      <h3>
        <TrendingUp size={15} />
        Hva forteller denne økten?
      </h3>
      {analysis.bestEfforts.length > 0 && (
        <div className="effort-grid">
          {analysis.bestEfforts.map((e) => (
            <div key={e.seconds}>
              <span>
                {e.seconds < 60 ? `${e.seconds} sek` : `${e.seconds / 60} min`}
              </span>
              <strong>
                {e.watts}
                <small> W</small>
              </strong>
              <small
                className={e.delta !== null && e.delta > 0 ? "positive" : ""}
              >
                {e.delta === null
                  ? "Første måling"
                  : e.delta > 0
                    ? `+${e.delta} W · ny rekord`
                    : `${e.delta} W fra rekord`}
              </small>
            </div>
          ))}
        </div>
      )}
      {analysis.ftpEstimate && (
        <div className="ftp-estimate">
          <Zap size={19} />
          <div>
            <span>Øktbasert FTP-anslag</span>
            <strong>{analysis.ftpEstimate.watts} W</strong>
          </div>
          <small>{analysis.ftpEstimate.explanation}</small>
        </div>
      )}
      {analysis.comparison && (
        <div className="comparison">
          <Target size={17} />
          <span>
            Mot forrige tilsvarende økt:{" "}
            {analysis.comparison.adherenceDelta === null
              ? "for lite måldata"
              : `${analysis.comparison.adherenceDelta > 0 ? "+" : ""}${analysis.comparison.adherenceDelta} prosentpoeng innenfor wattmålet`}
            {analysis.comparison.powerDelta !== null
              ? ` · ${analysis.comparison.powerDelta > 0 ? "+" : ""}${analysis.comparison.powerDelta} W i snitt`
              : ""}
            .
          </span>
        </div>
      )}
      <ul className="insights">
        {analysis.insights.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
      {(!!ride.skippedSeconds || !!ride.skippedBlocks?.length) && (
        <p className="fine-print">
          {ride.skippedBlocks?.length ? `${ride.skippedBlocks.length} segmenter ble hoppet over helt eller delvis. Det du hoppet over teller ikke som syklet.` : `${Math.round(ride.skippedSeconds || 0)} sekunder av planen ble hoppet over og teller ikke som syklet.`}
        </p>
      )}
    </div>
  );
}
export function ProgressPanel({
  history,
  ftp,
  online,
  browserMode = false,
}: {
  history: RideRecord[];
  ftp: number;
  online: boolean;
  /** Static hosting without the local backend: data lives in IndexedDB. */
  browserMode?: boolean;
}) {
  const rides = useMemo(
    () =>
      history
        .filter((r) => !r.demo)
        .slice()
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [history],
  );
  const analyses = useMemo(
    () => rides.map((ride) => ({ ride, analysis: analyzeRide(ride, []) })),
    [rides],
  );
  const estimates = analyses.filter((r) => r.analysis.ftpEstimate !== null);
  const best = estimates.length
    ? Math.max(...estimates.map((r) => r.analysis.ftpEstimate!.watts))
    : null;
  const recent = analyses.slice(-12);
  const max = Math.max(ftp, ...recent.map((r) => r.ride.avgPower), 1);
  return (
    <section className="progress-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MÅLT OVER TID</span>
          <h2>Formen din, økt for økt.</h2>
        </div>
        <span className={`backend-badge ${online || browserMode ? "online" : ""}`}>
          <Database size={12} />
          {browserMode
            ? "Lagret i denne nettleseren"
            : online
            ? "Lokal database tilkoblet"
            : "Nettleserlagring · backend frakoblet"}
        </span>
      </div>
      <div className="progress-grid">
        <div className="progress-plot">
          <div className="plot-label">
            <span>Snitteffekt · siste 12 målte økter</span>
            <span>WATT</span>
          </div>
          <div className="power-bars">
            {recent.length ? (
              recent.map(({ ride, analysis }) => (
                <div
                  key={ride.id}
                  title={`${ride.name}: ${ride.avgPower} W · ${new Date(ride.date).toLocaleDateString("nb-NO")}`}
                >
                  <strong>{ride.avgPower}</strong>
                  <div>
                    <i
                      style={{
                        height: `${Math.max(2, (ride.avgPower / max) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>
                    {new Date(ride.date).toLocaleDateString("nb-NO", {
                      day: "numeric",
                      month: "numeric",
                    })}
                  </span>
                  <small>
                    {analysis.adherence === null
                      ? "—"
                      : `${analysis.adherence}%`}
                  </small>
                </div>
              ))
            ) : (
              <div className="plot-empty">
                <TrendingUp size={28} />
                <p>Effektkurven starter med din første målte tur.</p>
              </div>
            )}
          </div>
          <p>
            Prosent viser tid innenfor ±10 % av wattmålet. Økter med ulik
            intensitet kan ikke sammenlignes direkte.
          </p>
        </div>
        <div className="ftp-progress">
          <Zap size={21} />
          <span>Din innstilte FTP</span>
          <strong>
            {ftp}
            <small> W</small>
          </strong>
          <div>
            <span>Høyeste 20-minuttersanslag</span>
            <b>{best === null ? "Ikke nok data" : `${best} W`}</b>
          </div>
          <p>
            95 % av beste sammenhengende 20 minutter. Demoturer og datagap
            utelates. Anslaget endrer aldri FTP automatisk.
          </p>
        </div>
      </div>
    </section>
  );
}
