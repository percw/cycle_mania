import { useEffect, useRef, useState } from "react";
import { CadenceSpeedConnection, HeartRateConnection, hasRememberedCadence, hasRememberedHeartRate } from "./bluetooth";
import { connectAnt, disconnectAnt, getAntStatus, type AntStatus } from "./api";
export function useSensors(onError: (message: string) => void) {
  const [hrStatus, setHrStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [hrName, setHrName] = useState("");
  const [bleHeartRate, setBleHeartRate] = useState<number | null>(null);
  const [ant, setAnt] = useState<AntStatus | null>(null);
  const [cscStatus, setCscStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [cscName, setCscName] = useState("");
  const [csc, setCsc] = useState<{ cadence?: number; speed?: number }>({});
  const hr = useRef<HeartRateConnection | null>(null);
  const cadenceSensor = useRef<CadenceSpeedConnection | null>(null);
  const lastCsc = useRef(0);
  const lastHr = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    hr.current = new HeartRateConnection({
      onData(value) {
        lastHr.current = Date.now();
        setBleHeartRate(value);
      },
      onStatus(status, name) {
        setHrStatus(status);
        setHrName(name ?? "");
        if (status !== "connected") setBleHeartRate(null);
      },
      onError: (message) => {setBleHeartRate(null);errorRef.current(message)},
    });
    // Standalone speed/cadence sensor: cadence and wheel speed only, never power.
    cadenceSensor.current = new CadenceSpeedConnection({
      onData(value) {
        lastCsc.current = Date.now();
        setCsc((previous) => ({ ...previous, ...value }));
      },
      onStatus(status, name) {
        setCscStatus(status);
        setCscName(name ?? "");
        if (status !== "connected") setCsc({});
      },
      onError: (message) => { setCsc({}); errorRef.current(message); },
    });
    try {
      if (localStorage.getItem("summit-auto-connect") !== "false" && hasRememberedHeartRate())
        void hr.current.connectRemembered();
      if (localStorage.getItem("summit-auto-connect") !== "false" && hasRememberedCadence())
        void cadenceSensor.current.connectRemembered();
    } catch { /* Disabled local storage must not block manual sensor connections. */ }
    let active = true;
    const poll = async () => {
      if (lastHr.current && Date.now() - lastHr.current > 10000)
        setBleHeartRate(null);
      if (lastCsc.current && Date.now() - lastCsc.current > 5000) setCsc({});
      try {
        const next = await getAntStatus();
        if (active) setAnt(next);
      } catch {
        if (active) setAnt(null);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
      hr.current?.disconnect();
      cadenceSensor.current?.disconnect();
    };
  }, []);
  async function toggleCadence() {
    if (cscStatus !== "disconnected") cadenceSensor.current?.disconnect();
    else await cadenceSensor.current?.connect();
  }
  async function toggleHr() {
    if (hrStatus !== "disconnected") hr.current?.disconnect();
    else await hr.current?.connect();
  }
  async function toggleAnt() {
    try {
      const next =
        ant && ["scanning", "connected", "connecting"].includes(ant.status)
          ? await disconnectAnt()
          : await connectAnt({ bikeId: 47963 });
      setAnt(next);
      if (next.error) errorRef.current(next.error);
    } catch (error) {
      errorRef.current(
        error instanceof Error ? error.message : "ANT+-broen svarte ikke.",
      );
    }
  }
  return {
    hrStatus,
    hrName,
    bleHeartRate,
    ant,
    toggleHr,
    toggleAnt,
    cscStatus,
    cscName,
    toggleCadence,
    /** Standalone speed/cadence sensor values; the bike's own cadence takes precedence. */
    cadence: csc.cadence,
    speed: csc.speed,
    heartRate: bleHeartRate ?? ant?.heartRate ?? null,
  };
}
