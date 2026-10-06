import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock3, Copy, Flag, Layers3, Plus, Route, Save, Target, Trash2, X } from 'lucide-react';
import { createCustomWorkout, validateCustomWorkout, customTemplates, stepSeconds, type BuilderStep, type CustomWorkoutDraft, type DurationUnit, type IntervalGroup } from './customWorkouts';
import './workout-builder.css';

type Props = { initial?: CustomWorkoutDraft; ftp: number; onSave: (draft: CustomWorkoutDraft) => Promise<void>; onClose: () => void };
const DRAFT_KEY = 'summit-builder-draft';
const units: { value: DurationUnit; label: string }[] = [{ value: 'seconds', label: 'sekunder' }, { value: 'minutes', label: 'minutter' }, { value: 'meters', label: 'meter' }, { value: 'kilometers', label: 'kilometer' }];
const distance = (step: BuilderStep) => step.unit === 'meters' || step.unit === 'kilometers';
const durationLabel = (step: BuilderStep) => `${step.value.toLocaleString('nb-NO')} ${{ seconds: 'sek', minutes: 'min', meters: 'm', kilometers: 'km' }[step.unit]}`;
const clock = (seconds: number) => { const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0; return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`; };
function loadDraft(key = DRAFT_KEY): CustomWorkoutDraft | null { try { const value = localStorage.getItem(key); if (!value) return null; const draft = JSON.parse(value); validateCustomWorkout(draft); return draft; } catch { return null; } }

function StepEditor({ label, value, onChange, ftp, optional = false, fallback }: { label: string; value: BuilderStep | null; onChange: (value: BuilderStep | null) => void; ftp: number; optional?: boolean; fallback: BuilderStep }) {
  return <fieldset className={`builder-step ${value ? '' : 'is-off'}`}>
    <legend>{label}</legend>
    {optional && <label className="builder-toggle"><input type="checkbox" checked={value !== null} onChange={event => onChange(event.target.checked ? { ...fallback } : null)} /><span>{value ? 'På' : 'Ingen'}</span></label>}
    {value ? <div className="builder-step-inputs">
      <label><span>Lengde</span><input aria-label={`${label} lengde`} type="number" min={value.unit === 'minutes' ? 1 / 60 : value.unit === 'kilometers' ? 0.001 : 1} max={1440000} step="any" value={value.value || ''} onChange={event => onChange({ ...value, value: Number(event.target.value) })} /></label>
      <label><span>Enhet</span><select aria-label={`${label} enhet`} value={value.unit} onChange={event => {
        const nextUnit = event.target.value as DurationUnit;
        let nextValue = value.value;
        if (value.unit === 'seconds' && nextUnit === 'minutes') nextValue /= 60;
        else if (value.unit === 'minutes' && nextUnit === 'seconds') nextValue *= 60;
        else if (value.unit === 'meters' && nextUnit === 'kilometers') nextValue /= 1000;
        else if (value.unit === 'kilometers' && nextUnit === 'meters') nextValue *= 1000;
        else if (nextUnit === 'meters') nextValue = 200;
        else if (nextUnit === 'kilometers') nextValue = 0.2;
        else if (nextUnit === 'minutes') nextValue = 1;
        else nextValue = 30;
        onChange({ ...value, value: Math.round(nextValue * 10000) / 10000, unit: nextUnit });
      }}>{units.map(unit => <option value={unit.value} key={unit.value}>{unit.label}</option>)}</select></label>
      <label><span>Mål · % FTP</span><input aria-label={`${label} prosent FTP`} type="number" min={5} max={300} step={1} value={Math.round(value.intensity * 100)} onChange={event => onChange({ ...value, intensity: Number(event.target.value) / 100 })} /></label>
      <output className="builder-watts">{Math.round(value.intensity * ftp)}<small>W</small></output>
    </div> : <p className="builder-step-off">{label === 'Dragpause' ? 'Dragene følger rett etter hverandre.' : 'Denne delen er slått av.'}</p>}
  </fieldset>;
}

export function WorkoutBuilder({ initial, ftp, onSave, onClose }: Props) {
  const storageKey = initial ? `${DRAFT_KEY}:${initial.id}` : DRAFT_KEY;
  const [draft, setDraft] = useState<CustomWorkoutDraft>(() => initial ? structuredClone(initial) : createCustomWorkout('8x4'));
  const [recoverable, setRecoverable] = useState<CustomWorkoutDraft | null>(() => loadDraft(storageKey));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const savingRef = useRef(saving); savingRef.current = saving;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!savingRef.current) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', handleKey, true); previous?.focus(); };
  }, []);
  useEffect(() => { if (!dirty) return; try { localStorage.setItem(storageKey, JSON.stringify(draft)); setStorageFailed(false); } catch { setStorageFailed(true); } }, [draft, dirty, storageKey]);
  const update = (next: CustomWorkoutDraft) => { setDraft(next); setDirty(true); setError(''); };
  const updateGroup = (id: string, patch: Partial<IntervalGroup>) => update({ ...draft, groups: draft.groups.map(group => group.id === id ? { ...group, ...patch } : group) });
  const move = (index: number, by: number) => { const groups = [...draft.groups]; [groups[index], groups[index + by]] = [groups[index + by], groups[index]]; update({ ...draft, groups }); };
  const duplicate = (index: number) => { const groups = [...draft.groups]; groups.splice(index + 1, 0, { ...structuredClone(groups[index]), id: crypto.randomUUID(), name: `${groups[index].name} · kopi` }); update({ ...draft, groups }); };
  const summary = useMemo(() => {
    let work = 0, recovery = 0, reps = 0, hasDistance = false;
    const bars: { seconds: number; intensity: number; kind: string; label: string }[] = [];
    const add = (step: BuilderStep | null, kind: string, label: string, count = 1) => {
      if (!step) return;
      const seconds = stepSeconds(step);
      hasDistance ||= distance(step);
      if (kind === 'work') work += seconds * count; else recovery += seconds * count;
      if (bars.length < 150) bars.push({ seconds, intensity: step.intensity, kind, label: `${label}: ${durationLabel(step)}, ${Math.round(step.intensity * 100)} % FTP` });
    };
    add(draft.warmup, 'warmup', 'Oppvarming');
    for (const [groupIndex, group] of draft.groups.entries()) {
      const sets = Math.max(0, Math.floor(group.sets)), repeats = Math.max(0, Math.floor(group.reps));
      reps += sets * repeats;
      // Totals include every repeat; the chart shows a bounded miniature of the entire plan.
      work += stepSeconds(group.work) * sets * repeats;
      recovery += (group.recovery ? stepSeconds(group.recovery) : 0) * sets * Math.max(0, repeats - 1);
      recovery += (group.setRecovery ? stepSeconds(group.setRecovery) : 0) * Math.max(0, sets - 1 + Number(groupIndex < draft.groups.length - 1));
      hasDistance ||= [group.work, group.recovery, group.setRecovery].some(step => step && distance(step));
      for (let set = 0; set < Math.min(sets, 30) && bars.length < 150; set++) {
        for (let rep = 0; rep < Math.min(repeats, 100) && bars.length < 150; rep++) {
          bars.push({ seconds: stepSeconds(group.work), intensity: group.work.intensity, kind: 'work', label: `${group.name} · drag ${rep + 1}: ${durationLabel(group.work)}` });
          if (rep < repeats - 1 && group.recovery && bars.length < 150) bars.push({ seconds: stepSeconds(group.recovery), intensity: group.recovery.intensity, kind: 'recovery', label: `Dragpause: ${durationLabel(group.recovery)}` });
        }
        if ((set < sets - 1 || groupIndex < draft.groups.length - 1) && group.setRecovery && bars.length < 150) bars.push({ seconds: stepSeconds(group.setRecovery), intensity: group.setRecovery.intensity, kind: 'recovery', label: `Seriepause: ${durationLabel(group.setRecovery)}` });
      }
    }
    add(draft.cooldown, 'cooldown', 'Nedtrapping');
    return { work, recovery, reps, hasDistance, bars, total: work + recovery };
  }, [draft]);
  const save = async () => {
    setError('');
    try { validateCustomWorkout(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sjekk verdiene i økten.'); return; }
    setSaving(true);
    try { await onSave(draft); try { localStorage.removeItem(storageKey); } catch { /* Saving to the workout library succeeded. */ } }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Kunne ikke lagre økten. Utkastet ligger fortsatt her.'); setSaving(false); }
  };
  return <div className="builder-overlay"><div className="workout-builder" role="dialog" aria-modal="true" aria-labelledby="builder-title" ref={dialog} tabIndex={-1}>
    <header className="builder-header"><div className="builder-mark"><Layers3 size={23} /></div><div><span>DIN PLAN. DIN RYTME.</span><h2 id="builder-title">{initial ? 'Rediger økten' : 'Bygg din egen økt'}</h2></div><button type="button" className="builder-close" aria-label="Lukk øktbygger" onClick={onClose} disabled={saving}><X size={22} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="builder-body"><fieldset className="builder-fields" disabled={saving}>
      <div className="builder-scroll"><main className="builder-editor">
        {recoverable && <div className="builder-restore"><div><b>Du har et ulagret utkast</b><span>{recoverable.name}</span></div><button type="button" onClick={() => { update(recoverable); setRecoverable(null); }}>Fortsett utkast</button><button type="button" aria-label="Forkast gammelt utkast" onClick={() => { setRecoverable(null); try { localStorage.removeItem(storageKey); } catch {} }}><X size={18} /></button></div>}
        <section className="builder-presets"><div className="builder-section-label"><span>01</span><h3>Start med en mal</h3><small>Alt kan tilpasses</small></div><div className="builder-template-grid">{customTemplates.map(template => <button type="button" className="builder-template" key={template.id} onClick={() => { const next = createCustomWorkout(template.id); update({ ...next, id: draft.id }); setRecoverable(null); }}><b>{template.name}</b><span>{template.description}</span><Plus size={16} /></button>)}</div></section>
        <div className="builder-name-row"><label><span>Navn på økten</span><input autoComplete="off" aria-label="Navn på økten" maxLength={100} value={draft.name} placeholder="Min favorittøkt" onChange={event => update({ ...draft, name: event.target.value })} /></label><label><span>Eget notat <small>valgfritt</small></span><input aria-label="Notat til økten" maxLength={500} value={draft.description} placeholder="F.eks. kontrollert og jevnt" onChange={event => update({ ...draft, description: event.target.value })} /></label></div>
        <div className="builder-section-label"><span>02</span><h3>Sett sammen økten</h3></div>
        <div className="builder-bookend"><Flag size={18} /><StepEditor label="Oppvarming" value={draft.warmup} ftp={ftp} optional fallback={{ value: 10, unit: 'minutes', intensity: 0.55 }} onChange={warmup => update({ ...draft, warmup })} /></div>
        <div className="builder-groups">{draft.groups.map((group, index) => <section className="builder-group" key={group.id} aria-label={`Blokk ${index + 1}`}>
          <details open><summary><span className="builder-group-number">{String(index + 1).padStart(2, '0')}</span><div><b>{group.name || `Blokk ${index + 1}`}</b><span>{group.sets} {group.sets === 1 ? 'serie' : 'serier'} × {group.reps} drag · {durationLabel(group.work)}{group.recovery ? ` / ${durationLabel(group.recovery)}` : ''}</span></div><ChevronDown size={18} /></summary>
            <div className="builder-group-content"><div className="builder-group-title"><label><span>Navn på blokken</span><input aria-label={`Navn på blokk ${index + 1}`} maxLength={60} value={group.name} onChange={event => updateGroup(group.id, { name: event.target.value })} /></label><div className="builder-group-tools"><button type="button" aria-label={`Flytt blokk ${index + 1} opp`} title="Flytt opp" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button><button type="button" aria-label={`Flytt blokk ${index + 1} ned`} title="Flytt ned" disabled={index === draft.groups.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button><button type="button" aria-label={`Dupliser blokk ${index + 1}`} title="Dupliser blokk" disabled={draft.groups.length >= 30} onClick={() => duplicate(index)}><Copy size={17} /></button><button type="button" aria-label={`Slett blokk ${index + 1}`} title="Slett blokk" disabled={draft.groups.length <= 1} onClick={() => update({ ...draft, groups: draft.groups.filter(item => item.id !== group.id) })}><Trash2 size={17} /></button></div></div>
            <div className="builder-repeat-row"><label><span>Antall serier</span><input aria-label={`Antall serier i blokk ${index + 1}`} type="number" min={1} max={30} step={1} value={group.sets || ''} onChange={event => updateGroup(group.id, { sets: Number(event.target.value) })} /></label><span className="builder-multiply">×</span><label><span>Drag i hver serie</span><input aria-label={`Drag per serie i blokk ${index + 1}`} type="number" min={1} max={100} step={1} value={group.reps || ''} onChange={event => updateGroup(group.id, { reps: Number(event.target.value) })} /></label><span className="builder-repeat-total">= <b>{group.sets * group.reps}</b> drag</span></div>
            <StepEditor label="Drag" value={group.work} ftp={ftp} fallback={group.work} onChange={work => work && updateGroup(group.id, { work })} />
            <StepEditor label="Dragpause" value={group.recovery} ftp={ftp} optional fallback={{ value: 1, unit: 'minutes', intensity: 0.5 }} onChange={recovery => updateGroup(group.id, { recovery })} />
            {(group.sets > 1 || index < draft.groups.length - 1) && <StepEditor label="Seriepause" value={group.setRecovery} ftp={ftp} optional fallback={{ value: 3, unit: 'minutes', intensity: 0.5 }} onChange={setRecovery => updateGroup(group.id, { setRecovery })} />}
            <p className="builder-group-note">{group.sets > 1 || index < draft.groups.length - 1 ? `Seriepausen erstatter dragpausen mellom seriene${index < draft.groups.length - 1 ? ' og før neste blokk' : ''}. Ingen ekstra pause etter hele hoveddelen.` : 'Dragpause mellom dragene, ingen etter siste drag.'}</p>
            </div>
          </details>
        </section>)}</div>
        <button type="button" className="builder-add" disabled={draft.groups.length >= 30} onClick={() => update({ ...draft, groups: [...draft.groups, { id: crypto.randomUUID(), name: `Blokk ${draft.groups.length + 1}`, sets: 1, reps: 4, work: { value: 4, unit: 'minutes', intensity: 1 }, recovery: { value: 2, unit: 'minutes', intensity: 0.5 }, setRecovery: { value: 3, unit: 'minutes', intensity: 0.5 } }] })}><Plus size={18} /> Legg til en blokk <span>En annen lengde, pause eller intensitet</span></button>
        <div className="builder-bookend"><Flag size={18} /><StepEditor label="Nedtrapping" value={draft.cooldown} ftp={ftp} optional fallback={{ value: 5, unit: 'minutes', intensity: 0.45 }} onChange={cooldown => update({ ...draft, cooldown })} /></div>
      </main><aside className="builder-preview" aria-label="Forhåndsvisning av økten"><div className="builder-preview-inner"><span className="builder-eyebrow">ØKTEN DIN</span><h3>{draft.name || 'Din egen økt'}</h3><div className="builder-total"><Clock3 size={20} /><strong>{clock(summary.total)}</strong><span>{summary.hasDistance ? 'anslått min:sek' : 'min:sek totalt'}</span></div>
        <div className="builder-chart" role="img" aria-label={`Øktprofil med ${summary.reps} drag. ${summary.hasDistance ? 'Distanser vises med anslått varighet.' : ''}`}>{summary.bars.map((bar, index) => <div key={index} className={`builder-bar ${bar.kind}`} style={{ flexGrow: Math.max(1, Math.min(bar.seconds, 3600)), height: `${Math.max(8, Math.min(100, bar.intensity / Math.max(1.3, ...summary.bars.map(item => item.intensity)) * 100))}%` }} title={bar.label} />)}</div>
        <div className="builder-chart-key"><span><i /> Drag</span><span><i /> Pause / rolig</span></div>{summary.bars.length >= 150 && <p className="builder-fine">Profilen viser de første 150 delene. Tallene inkluderer hele økten.</p>}
        <div className="builder-stats"><div><Layers3 size={17} /><span>Hoveddrag</span><b>{summary.reps}</b></div><div><Target size={17} /><span>{summary.hasDistance ? 'Anslått dragtid' : 'Tid i drag'}</span><b>{clock(summary.work)}</b></div><div><Clock3 size={17} /><span>Pauser + rolig{summary.hasDistance ? ' ≈' : ''}</span><b>{clock(summary.recovery)}</b></div></div>
        <div className="builder-plan-list">{draft.groups.map((group, index) => <div key={group.id}><span>{String(index + 1).padStart(2, '0')}</span><p><b>{group.sets > 1 ? `${group.sets} × ` : ''}{group.reps} × {durationLabel(group.work)}</b><small>{group.recovery ? `${durationLabel(group.recovery)} dragpause` : 'Uten dragpause'}{group.sets > 1 || index < draft.groups.length - 1 ? ` · ${group.setRecovery ? `${durationLabel(group.setRecovery)} seriepause` : 'uten seriepause'}` : ''}</small></p></div>)}</div>
        <div className="builder-ftp"><Target size={17} /><p>Målene følger din FTP.<br /><b>100 % = {ftp} W</b></p></div>
        {summary.hasDistance && <div className="builder-distance-note"><Route size={18} /><p><b>Distanse følger den virtuelle turen.</b> Meter beregnes fra watt, ikke sykkelens distansemåler. Tidsanslag bruker 30 km/t; faktisk varighet avhenger av farten din.</p></div>}
        <p className="builder-fine">Ulike pauser? Del økten i flere blokker. Du kan blande tid og distanse i samme økt.</p>
      </div></aside></div>
      </fieldset></div>
      <footer className="builder-footer"><div>{error ? <p className="builder-error" role="alert">{error}</p> : <p className="builder-draft-status"><Check size={15} />{storageFailed ? 'Utkastet er åpent, men nettleseren kunne ikke sikkerhetslagre det.' : dirty ? 'Utkastet er lagret i denne nettleseren.' : 'Lagre økten for å finne den i biblioteket.'}</p>}</div><button className="builder-save" type="submit" disabled={saving}><Save size={18} />{saving ? 'Lagrer …' : initial ? 'Lagre endringer' : 'Lagre min økt'}</button></footer>
    </form>
  </div></div>;
}
export default WorkoutBuilder;
