import { useRef, useState } from 'react';
import { Archive, Upload, X } from 'lucide-react';
import { createBackup, parseBackup } from './backup';
import type { CustomWorkoutDraft } from './customWorkouts';
import type { RideRecord } from './storage';
import './backup.css';

function saveFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «Sikkerhetskopi» and «Importer» next to the history export on «Min utvikling». */
export function DataBackup({ history, ftp, customWorkouts, onImportRides, onImportWorkouts, onApplyFtp }: {
  history: RideRecord[];
  ftp: number;
  customWorkouts: CustomWorkoutDraft[];
  onImportRides(rides: RideRecord[]): Promise<{ added: number; existing: number }>;
  onImportWorkouts(drafts: CustomWorkoutDraft[]): number;
  onApplyFtp?(ftp: number): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ftp?: number } | null>(null);
  function exportAll() {
    const backup = createBackup({ rides: history, ftp, customWorkouts });
    saveFile(`summit-sikkerhetskopi-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup));
  }
  async function importFile(file: File) {
    setBusy(true);
    try {
      const parsed = parseBackup(await file.text());
      const rides = await onImportRides(parsed.rides);
      const workouts = parsed.customWorkouts.length ? onImportWorkouts(parsed.customWorkouts) : 0;
      const parts = [count(rides.added, 'ny økt', 'nye økter')];
      if (rides.existing) parts.push(`${rides.existing} fantes fra før`);
      if (workouts) parts.push(count(workouts, 'ny øktmal', 'nye øktmaler'));
      if (parsed.skipped) parts.push(`${parsed.skipped} ugyldige hoppet over`);
      setStatus({ text: `Importert: ${parts.join(' · ')}.`, ftp: parsed.ftp !== null && parsed.ftp !== ftp ? parsed.ftp : undefined });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : 'Kunne ikke lese filen.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <>
      <button className="today-stat backup-stat" onClick={exportAll} aria-label="Sikkerhetskopi" title="Økter, FTP og egne øktmaler i én fil">
        <Archive size={16} /><b>Sikkerhets{'\u00ad'}kopi</b>
      </button>
      <button className="today-stat backup-stat" disabled={busy} onClick={() => input.current?.click()} title="Les inn en sikkerhetskopi. Økter som finnes fra før, beholdes.">
        <Upload size={16} /><b>{busy ? 'Leser …' : 'Importer'}</b>
      </button>
      <input ref={input} className="backup-file" type="file" accept="application/json,.json" aria-label="Velg sikkerhetskopi" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void importFile(file);
      }} />
      {status && (
        <p className="backup-status" role="status">
          <span>{status.text}</span>
          {status.ftp !== undefined && onApplyFtp && (
            <button className="backup-ftp" onClick={() => { onApplyFtp(status.ftp!); setStatus({ text: `FTP er satt til ${status.ftp} W.` }); }}>
              Bruk {status.ftp} W som FTP
            </button>
          )}
          <button className="backup-close" aria-label="Lukk melding" onClick={() => setStatus(null)}><X size={15} /></button>
        </p>
      )}
    </>
  );
}
