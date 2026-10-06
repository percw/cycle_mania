import type { ErgState } from './useErg'
import './erg.css'

/** Opt-in automatic resistance. Rendered only for trainers that accept target power. */
export default function ErgToggle({ erg, riding }: { erg: ErgState; riding: boolean }) {
  if (!erg.supported) return null
  const range = erg.info?.powerRange
  const state = !erg.enabled ? null
    : erg.status === 'error' ? erg.error ?? 'Motstandsstyringen svarte ikke.'
    : erg.status === 'on' ? `Aktiv · holder ${erg.targetWatts} W`
    : erg.status === 'pending' ? 'Kobler til motstandsstyringen …'
    : riding ? 'På pause. Slås på igjen når du fortsetter.' : 'Slås på når en vanlig økt starter.'
  return <div className="erg-toggle">
    <label>
      <input type="checkbox" role="switch" checked={erg.enabled} onChange={event => erg.setEnabled(event.target.checked)} />
      <span className="erg-switch" aria-hidden="true" />
      <span className="erg-copy">
        <strong>Automatisk motstand (ERG)</strong>
        <small>Sykkelen setter motstanden slik at du holder wattmålet. Brukes ikke i demoturer eller FTP-test.{range ? ` Område ${Math.max(0, range.min)}–${range.max} W.` : ''}</small>
      </span>
    </label>
    {state && <p className={`erg-state ${erg.status}`} role="status">{state}</p>}
  </div>
}
