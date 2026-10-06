/** Fixed absolute watts make repeated tests independent of a changed profile FTP. */
export interface RampProtocol {
  version: 1;
  startWatts: number;
  stepWatts: number;
  stageSeconds: 60;
  warmupSeconds: 300;
  cooldownSeconds: 180;
  maxStages: 40;
}

export interface RampTestRecord {
  version: 1;
  protocol: RampProtocol;
  referenceFtp: number;
  /** Active elapsed seconds at the end of the ramp, before cooldown. */
  endSecond: number;
  reason: 'exhaustion' | 'aborted' | 'ceiling';
  interrupted: boolean;
}

export interface RampResult {
  rideId: string;
  date: string;
  protocolKey: string;
  protocol: RampProtocol;
  referenceFtp: number;
  rampSeconds: number;
  completedStages: number;
  finalStageWatts: number;
  best60Watts: number | null;
  best60StartSecond: number | null;
  best60EndSecond: number | null;
  estimatedFtp: number | null;
  /** Descriptive calculation only; must never update FTP or enter a trend. */
  previewFtp: number | null;
  valid: boolean;
  demo: boolean;
  coverage: number;
  adherence: number | null;
  issues: string[];
  reason: RampTestRecord['reason'];
}

export interface RampHistoryPoint extends RampResult {
  previousFtp: number | null;
  deltaWatts: number | null;
  deltaPercent: number | null;
}
