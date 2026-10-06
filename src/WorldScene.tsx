import { lazy, Suspense } from "react";
import RideScene from "./RideScene";
import type { WorldId, WorldSceneProps } from "./worlds";
const TronWorld = lazy(() => import("./TronWorld"));
const NeonWorld = lazy(() => import("./NeonWorld"));
const SkyWorld = lazy(() => import("./SkyWorld"));
const RealWorld = lazy(() => import("./RealWorld"));
export default function WorldScene({
  world,
  ...props
}: WorldSceneProps & { world: WorldId }) {
  if (world === "fjord" || world === "alpine" || world === "midnight")
    return <RideScene {...props} route={world} />;
  return (
    <Suspense
      fallback={
        <div className="world-loading">
          <span className="loading-orbit" />
          <strong>Åpner {world === "vestland" ? "Vestlandsveien" : world === "tron" ? "The Grid" : world === "sky" ? "øyriket" : "Neon Rush"} …</strong>
        </div>
      }
    >
      {world === "vestland" ? <RealWorld {...props} /> : world === "tron" ? <TronWorld {...props} /> : world === "neon" ? <NeonWorld {...props} /> : <SkyWorld {...props} />}
    </Suspense>
  );
}
