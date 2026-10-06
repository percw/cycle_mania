import { ArrowRight, Check, Compass, Layers3, LockKeyhole, Sparkles, Zap } from 'lucide-react';
import type { CampaignProgress, ExpeditionRoute, ExpeditionState, ExpeditionResult } from './expedition';
import type { WorldId } from './worlds';

export function CampaignBoard({ world, progress, route, onRoute }: {world:WorldId;progress:CampaignProgress;route:ExpeditionRoute;onRoute:(route:ExpeditionRoute)=>void}) {
  const sky=world==='sky';
  const items=route==='restore'?progress.structures:progress.relics;
  const count=route==='restore'?progress.restored:progress.discovered;
  const next=items.find(x=>!x.unlocked);
  const points=[[55,122],[147,79],[232,131],[325,62],[415,112],[505,45]];
  return <section className={`campaign-board campaign-${world}`} aria-label="Ekspedisjonen din">
    <div className="campaign-map">
      <div className="eyebrow">DIN VERDEN · KAPITTEL {progress.chapter}</div>
      <h2>{sky?'Et øyrike å vekke.':'En verden å forandre.'}</h2>
      <p>Hver tur setter spor. Velg hva du vil bygge videre på.</p>
      <svg viewBox="0 0 560 175" role="img" aria-label={`${items.filter(x=>x.unlocked).length} av ${items.length} landemerker åpnet`}>
        <defs><linearGradient id="campaign-road"><stop stopColor="#ace2cc"/><stop offset="1" stopColor="#8b78c4"/></linearGradient></defs>
        <path d="M0 150 70 87 130 132 235 55 330 113 460 10 560 110V175H0Z" fill="#88a8bb0c"/>
        <path d="M55 122Q100 115 147 79T232 131 325 62 415 112 505 45" fill="none" stroke="url(#campaign-road)" strokeWidth="3" strokeDasharray="5 7" opacity=".4"/>
        {items.map((item,i)=><g key={item.name} transform={`translate(${points[i]![0]},${points[i]![1]})`} className={item.unlocked?'map-node opened':item===next?'map-node next':'map-node'}>
          <circle r="24" fill="currentColor" opacity=".08"/><circle r="15" fill="#161b23" stroke="currentColor" strokeWidth="2"/>
          {item.unlocked?<path d="m-6 0 4 5 9-10" fill="none" stroke="currentColor" strokeWidth="2"/>:<text textAnchor="middle" y="4" fill="currentColor" fontSize="10">{i+1}</text>}
          <text textAnchor="middle" y="38" fill="currentColor" fontSize="8">{item.cost} {route==='restore'?'kjerner':'funn'}</text>
          <title>{item.name} · {item.unlocked?'Åpnet':`${Math.max(0,item.cost-count)} igjen`}</title>
        </g>)}
      </svg>
      <div className="campaign-next"><span>{next?'NESTE LANDMERKE':'ALLE LANDMERKER ÅPNET'}</span><strong>{next?.name??'Verdenen din lever'}</strong><small>{next?`${count} / ${next.cost} ${route==='restore'?'energikjerner':'funn'}`:'Fortsett rekordjakten eller utforsk en annen verden.'}</small></div>
    </div>
    <div className="campaign-plan">
      <span className="eyebrow">VELG FØRSTE RETNING</span>
      <button aria-pressed={route==='restore'} onClick={()=>onRoute('restore')} className={`mission-route ${route==='restore'?'selected':''}`}><Zap/><span><strong>Gjenreis</strong><small>Samle energikjerner. Tenn landemerker og bygg broer.</small></span>{route==='restore'?<Check size={18}/>:<ArrowRight size={18}/>}</button>
      <button aria-pressed={route==='explore'} onClick={()=>onRoute('explore')} className={`mission-route ${route==='explore'?'selected':''}`}><Compass/><span><strong>Utforsk</strong><small>Ta høyveien. Finn relikvier og åpne observatorier.</small></span>{route==='explore'?<Check size={18}/>:<ArrowRight size={18}/>}</button>
      <p className="campaign-explain">Hold øktens wattmål for å lade neste port. Du kan velge ny retning ved portene — eller la turen fortsette automatisk.</p>
      <div className="campaign-inventory" aria-label="Åpnede landemerker">
        {[...progress.structures,...progress.relics].filter(x=>x.unlocked).slice(-4).map(x=><span key={x.name}><Sparkles size={12}/>{x.name}</span>)}
        {!progress.restored&&!progress.discovered&&<span><LockKeyhole size={12}/>Din første tur åpner den første delen.</span>}
      </div>
    </div>
  </section>;
}

export function ExpeditionHUD({state,progress,onChoice,paused,demo}: {state:ExpeditionState;progress:CampaignProgress;onChoice:(route:ExpeditionRoute)=>void;paused:boolean;demo:boolean}) {
  const goal=(route:ExpeditionRoute)=>{
    const count=route==='restore'?state.worldRestored:state.worldDiscovered;
    const next=(route==='restore'?progress.structures:progress.relics).find(item=>item.cost>count);
    return next?`${next.name} · ${count}/${next.cost}`:'Alle landemerker åpnet';
  };
  const fresh=state.eventSerial>0 && state.elapsed-state.eventAt<5;
  return <>
    <section className="expedition-hud" aria-label="Aktivt ekspedisjonsoppdrag">
      <span className="expedition-icon">{state.route==='restore'?<Zap size={18}/>:<Compass size={18}/>}</span>
      <div className="expedition-text"><span>{demo?'PRØVEEKSPEDISJON':'EKSPEDISJON'} · {state.route==='restore'?'GJENREIS':'UTFORSK'}</span><strong>{fresh?state.event:goal(state.route)}</strong><div className="expedition-charge" role="progressbar" aria-label="Portens energi" aria-valuenow={Math.round(state.charge*100)} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${state.charge*100}%`}}/></div></div>
      <div className="expedition-count"><strong>{state.completed}</strong><span>porter</span></div>
    </section>
    {state.choiceOpen&&<section className="expedition-choice" aria-label="Velg vei ved porten">
      <div><span className="eyebrow">PORTEN ER ÅPEN</span><strong>Velg neste veiskille</strong><small>{paused?'Valget venter mens økten er pauset.':`Samme retning velges automatisk om ${Math.ceil(state.choiceRemaining)} sek.`}</small></div>
      <div className="expedition-choices"><button onClick={()=>onChoice('restore')}><kbd>1</kbd><Zap size={17}/><span><strong>Gjenreis</strong><small>{goal('restore')} · 30 målsekunder</small></span></button><button onClick={()=>onChoice('explore')}><kbd>2</kbd><Compass size={17}/><span><strong>Utforsk</strong><small>{goal('explore')} · 40 målsekunder</small></span></button></div>
    </section>}
  </>;
}

export function ExpeditionSummary({result,progress,demo}: {result:ExpeditionResult;progress:CampaignProgress;demo:boolean}) {
  const opened=[...progress.structures,...progress.relics].filter(x=>x.unlocked);
  const newlyOpened=demo?[]:[...progress.structures.filter(x=>x.unlocked&&x.cost>progress.restored-result.restored),...progress.relics.filter(x=>x.unlocked&&x.cost>progress.discovered-result.discovered)];
  return <section className="expedition-summary"><div className="eyebrow"><Layers3 size={14}/> {demo?'PRØVETURENS SPOR':'DETTE SATTE DU I BEVEGELSE'}</div><div className="expedition-loot"><span><strong>{result.restored}</strong>energikjerner</span><span><strong>{result.discovered}</strong>funn</span><span><strong>{result.completed}</strong>åpnede porter</span></div><p>{demo?'Prøveturen lar deg oppleve valgene. Ekspedisjoner med sykkelen bygger videre på den lagrede verdenen din.':`${opened.length} landemerker og relikvier er nå åpnet i denne verdenen. Du fortsetter herfra neste gang.`}</p>{newlyOpened.length>0&&<p className="expedition-unlocks">Åpnet denne turen: {newlyOpened.map(x=>x.name).join(', ')}.</p>}{result.discoveries.length>0&&<div className="found-relics">{result.discoveries.slice(0,5).map((name,i)=><span key={`${name}-${i}`}><Sparkles size={12}/>{name}</span>)}</div>}</section>;
}
