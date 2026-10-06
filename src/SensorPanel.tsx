import { Bluetooth, Heart, Radio, Usb } from "lucide-react";
import { bluetoothAvailable } from "./bluetooth";
import type { useSensors } from "./useSensors";
export default function SensorPanel({
  sensors,
  source,
  onSource,
}: {
  sensors: ReturnType<typeof useSensors>;
  source: "ble" | "ant";
  onSource: (source: "ble" | "ant") => void;
}) {
  const antActive =
    !!sensors.ant &&
    ["connected", "scanning", "connecting"].includes(sensors.ant.status);
  return (
    <div className="sensor-panel">
      <h3>Flere sensorer</h3>
      <div className="sensor-row">
        <span className="sensor-icon">
          <Heart size={19} />
        </span>
        <div>
          <strong>
            {sensors.hrStatus === "connected"
              ? sensors.hrName || "Pulsbelte tilkoblet"
              : "Pulsbelte via Bluetooth"}
          </strong>
          <small>Garmin · Polar · Suunto · standard BLE-puls</small>
        </div>
        <span className="sensor-value">{sensors.bleHeartRate ?? "—"}</span>
      </div>
      <button
        className="secondary full"
        disabled={!bluetoothAvailable() || sensors.hrStatus === "connecting"}
        onClick={() => void sensors.toggleHr()}
      >
        <Bluetooth size={15} />
        {sensors.hrStatus === "connected"
          ? "Koble fra pulsbelte"
          : sensors.hrStatus === "connecting"
            ? "Søker etter pulsbelte …"
            : "Koble til BLE-puls"}
      </button>
      <div className="sensor-row">
        <span className="sensor-icon">
          <Usb size={19} />
        </span>
        <div>
          <strong>ANT+ via lokal USB-mottaker</strong>
          <small>
            {antActive
              ? `Søker / leser · sykkel-ID 47963`
              : "Puls og sykkelwatt via lokal backend"}
          </small>
        </div>
        <Radio size={17} />
      </div>
      {antActive && (
        <div className="ant-readings">
          <span>{sensors.ant?.power ?? "—"} W</span>
          <span>{sensors.ant?.heartRate ?? "—"} bpm</span>
          <span>{sensors.ant?.cadence ?? "—"} rpm</span>
        </div>
      )}
      <button
        className="secondary full"
        onClick={() => void sensors.toggleAnt()}
      >
        <Radio size={15} />
        {antActive ? "Stopp ANT+-mottaker" : "Start ANT+-mottaker"}
      </button>
      <label className="source-select">
        Kilde for sykkeldata
        <select
          value={source}
          onChange={(event) => onSource(event.target.value as "ble" | "ant")}
        >
          <option value="ble">Bluetooth fra sykkelen</option>
          <option value="ant">ANT+ fra USB-mottaker</option>
        </select>
      </label>
      <p className="fine-print">
        Pulsbeltet må støtte BLE Heart Rate eller ANT+ Heart Rate. Eldre
        ANT+-belter trenger USB-mottakeren. BT 62194 og ANT 47963 er konsollens
        kjennetegn, ikke en garanti for protokollstøtte.
      </p>
    </div>
  );
}
