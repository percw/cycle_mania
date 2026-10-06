import { ArrowRight, ChevronDown, Compass, Route, Zap } from 'lucide-react';
import type { JourneyProgress } from './journey';
import type { ExpeditionRoute, ExpeditionState } from './expedition';
import type { Achievement } from './achievements';
import { PerformanceHUD } from './AchievementsUI';
import './journey.css';

const routes: ExpeditionRoute[] = ['restore', 'explore'];

export function JourneyBoard({journey,route,onRoute}: {journey:JourneyProgress;route:ExpeditionRoute;onRoute:(route:ExpeditionRoute)=>void}) {
  const selected=journey.choices[route];
  return <section className="journey-board" aria-label="Din rute gjennom The Grid">
    <div className="journey-intro"><span className="eyebrow">THE GRID · KAPITTEL {journey.chapter}</span><h2>{journey.chapterName}</h2>
      <p>Veien du velger endrer neste sted og hvordan kapittelet ender. Følg wattmålet for å åpne det — også i pausene.</p>
      <ol className="journey-steps" aria-label="Kapittelets etapper">{['Finn en inngang','Bygg videre på valget','Åpne kapittelets finale'].map((label,i)=><li key={label} className={i+1<journey.step?'done':i+1===journey.step?'current':''}><b>{i+1}</b><span>{label}</span></li>)}</ol>
      <p className="journey-next"><Route size={16}/><span>Neste sted: <strong>{selected.destination}</strong></span></p>
      <small>{journey.completed} steder fullført i lagrede sykkeløkter. Du fortsetter herfra neste gang.</small>
    </div>
    <div className="journey-plan"><span className="eyebrow">VELG HVOR TUREN FORTSETTER</span>{routes.map(r=>{const choice=journey.choices[r];return <button key={r} className={`journey-option ${route===r?'selected':''}`} aria-pressed={route===r} onClick={()=>onRoute(r)}>
      {r==='restore'?<Zap size={19}/>:<Compass size={19}/>}<span><strong>{choice.title}</strong><small>{choice.consequence}</small><em>{r==='restore'?30:40} sekunder innenfor wattmålet</em></span><ArrowRight size={16}/>
    </button>})}<small>Prøveturer lagrer ingen fremdrift. Tråkker du utenfor målet, venter oppdraget uten å miste det du har gjort.</small></div>
  </section>;
}

export function JourneyHUD({journey,state,paused,onChoice,items}: {journey:JourneyProgress;state:ExpeditionState;paused:boolean;onChoice:(route:ExpeditionRoute)=>void;items:Achievement[]}) {
  const last=journey.log.at(-1);
  return <>
    <details className="journey-hud">
      <summary><Route size={18}/><span><small>{journey.demo?'PRØVETUR':'THE GRID'} · KAPITTEL {journey.chapter} · {journey.step}/3</small><strong>{state.choiceOpen&&last?`${last.name} åpnet`:journey.destination}</strong></span><b>{state.choiceOpen?'✓':Math.round(journey.progress*100)}{!state.choiceOpen&&<small>%</small>}</b><ChevronDown size={15}/></summary>
      <div className="journey-meter" role="progressbar" aria-label="Neste sted" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(journey.progress*100)}><i style={{width:`${journey.progress*100}%`}}/></div>
      <div className="journey-hud-detail"><p><strong>{journey.chapterName}</strong> · {journey.nextGoal}</p><p>Arbeid og pauser teller ved riktig watt. Fullførte steder beholdes når en ekte økt lagres.</p><PerformanceHUD items={items} demo={journey.demo}/></div>
    </details>
    {state.choiceOpen&&<section className="expedition-choice journey-choice" aria-label="Velg vei ved porten">
      <div><span className="eyebrow">{last?`${last.name} ÅPNET`:'NESTE ETAPPE'}</span><strong>Hva skal skje videre?</strong><small>{paused?'Valget venter mens økten er pauset.':`Fortsetter automatisk med «${journey.choices[state.route].title}» om ${Math.ceil(state.choiceRemaining)} sek.`}</small></div>
      <div className="expedition-choices">{routes.map((r,i)=>{const c=journey.choices[r];return <button key={r} onClick={()=>onChoice(r)} data-route={r}><kbd>{i+1}</kbd><span><strong>{c.title}</strong><small>{c.consequence}</small><em>{r==='restore'?30:40} målsekunder</em></span></button>})}</div>
    </section>}
  </>;
}

export function JourneyReceipt({journey,count}: {journey:JourneyProgress;count:number}) {
  const places=count>0?journey.log.slice(-Math.min(count,12)):[];
  return <section className="journey-receipt"><span className="eyebrow">{journey.demo?'PRØVETURENS RUTE':'RUTEN DU ÅPNET'}</span><h3>{count} steder · neste: {journey.destination}</h3>
    {places.length>0?<ol>{places.map((place,i)=><li key={`${place.chapter}-${i}`}><b>{place.name}</b><span>Kapittel {place.chapter} · {place.route==='restore'?'Gjenreis':'Utforsk'}</span></li>)}</ol>:<p>Ingen steder ble fullført denne turen.</p>}
    {count>12&&<p>Viser de siste 12 av {count} steder fra økten.</p>}
    <p>{journey.demo?'Dette var en forhåndsvisning. Den lagrede reisen er uendret.':`Neste økt fortsetter i ${journey.chapterName}, etappe ${journey.step} av 3.`}</p>
  </section>;
}
