type DistanceSample = { meters: number; at: number };

/**
 * Presentation-only distance. Keep workout recording on the original samples.
 * A small playback delay lets each frame interpolate between measured positions
 * instead of repeatedly easing towards a position held for an entire app tick.
 * All distances are absolute meters; route wrapping belongs in the renderer.
 */
export class RideMotion {
  static readonly bufferMs = 300;
  private samples: DistanceSample[];
  private visualMeters: number;
  private running: boolean;

  constructor(meters: number, nowMs: number, running: boolean) {
    const initial = Number.isFinite(meters) ? Math.max(0, meters) : 0;
    this.samples = [{ meters: initial, at: nowMs }];
    this.visualMeters = initial;
    this.running = running;
  }

  ingest(meters: number, nowMs: number, running: boolean): void {
    if (!Number.isFinite(meters) || !Number.isFinite(nowMs) || meters < 0) return;
    const last = this.samples[this.samples.length - 1];
    if (nowMs < last.at) return;
    // Pausing snaps to the recorded stopping point. Resuming starts a fresh
    // buffer there, so playback can never rewind into the pre-pause samples.
    // Restored sessions and tab stalls also establish a new authoritative origin.
    const reset = !running || !this.running || meters < last.meters ||
      nowMs - last.at > 1500 || meters - last.meters > 100;
    this.running = running;
    if (reset) {
      this.samples = [{ meters, at: nowMs }];
      this.visualMeters = meters;
      return;
    }
    if (nowMs === last.at) last.meters = meters;
    else this.samples.push({ meters, at: nowMs });
    // Bounded even when rendering is suspended while updates keep arriving.
    while (this.samples.length > 2 && this.samples[1].at < nowMs - RideMotion.bufferMs - 500) {
      this.samples.shift();
    }
  }

  update(nowMs: number): number {
    if (!this.running || !Number.isFinite(nowMs)) return this.visualMeters;
    const targetTime = nowMs - RideMotion.bufferMs;
    while (this.samples.length > 2 && this.samples[1].at <= targetTime) this.samples.shift();
    const first = this.samples[0];
    const second = this.samples[1];
    let meters = first.meters;
    if (second) {
      const fraction = Math.max(0, Math.min(1, (targetTime - first.at) / (second.at - first.at)));
      meters += (second.meters - first.meters) * fraction;
    }
    // No extrapolation: missing or zero-distance updates stop the scene, and
    // a delayed packet can never make the camera reverse along the road.
    this.visualMeters = Math.max(this.visualMeters, meters);
    return this.visualMeters;
  }
}
