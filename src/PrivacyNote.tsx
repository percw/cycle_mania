import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X } from 'lucide-react';
import { privacyLead, privacyOptOutLabel, privacySections, privacyTitle } from './privacyCopy';
import { setTelemetryOptOut, telemetryOptedOut } from './telemetry';
import './privacy.css';

/** Footer link plus a native modal dialog (focus, Escape and backdrop handled by the browser). */
export function PrivacyLink() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [optedOut, setOptedOut] = useState(telemetryOptedOut);
  const close = () => dialog.current?.close();
  return <>
    <button type="button" className="privacy-link" onClick={() => dialog.current?.showModal()}>Personvern</button>
    {typeof document !== 'undefined' && createPortal(
      <dialog ref={dialog} className="privacy-dialog" aria-labelledby="privacy-title"
        onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="privacy-sheet">
          <header>
            <span className="privacy-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
            <h2 id="privacy-title">{privacyTitle}</h2>
            <button type="button" className="privacy-close" onClick={close} aria-label="Lukk"><X size={20} /></button>
          </header>
          <p className="privacy-lead">{privacyLead}</p>
          {privacySections.map(section => <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map(text => <p key={text}>{text}</p>)}
          </section>)}
          <label className="privacy-optout">
            <input type="checkbox" checked={optedOut} onChange={event => { setOptedOut(event.target.checked); setTelemetryOptOut(event.target.checked); }} />
            {privacyOptOutLabel}
          </label>
        </div>
      </dialog>, document.body)}
  </>;
}
