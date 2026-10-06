import { useEffect, useRef, useState } from "react";
import { HeartRateConnection, hasRememberedHeartRate } from "./bluetooth";
import { connectAnt, disconnectAnt, getAntStatus, type AntStatus } from "./api";
export function useSensors(onError: (message: string) => void) {
  const [hrStatus, setHrStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [hrName, setHrName] = useState("");
  const [bleHeartRate, setBleHeartRate] = useState<number | null>(null);
  const [ant, setAnt] = useState<AntStatus | null>(null);
  const hr = useRef<HeartRateConnection | null>(null);
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
    try {
      if (localStorage.getItem("summit-auto-connect") !== "false" && hasRememberedHeartRate())
        void hr.current.connectRemembered();
    } catch { /* Disabled local storage must not block manual sensor connections. */ }
    let active = true;
    const poll = async () => {
      if (lastHr.current && Date.now() - lastHr.current > 10000)
        setBleHeartRate(null);
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
    };
  }, []);
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
    heartRate: bleHeartRate ?? ant?.heartRate ?? null,
  };
}
