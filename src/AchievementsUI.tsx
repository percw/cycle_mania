import { useEffect, useState } from 'react';
import { Check, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Achievement } from './achievements';
import './achievements.css';

export function AchievementBoard({items}: {items:Achievement[]}) {
  return <section className="achievement-board" aria-label="Prestasjonsbaserte belønninger">
    <div className="section-heading"><div><span className="eyebrow">OPPTJENT GJENNOM TRENING</span><h2>Prestasjonen setter spor.</h2></div><ShieldCheck size={23}/></div>
    <p>Alle krav bruker ditt foreskrevne wattmål, med ±10 % slingringsmonn og minst 95 % datadekning. Det gir ingen fordel å tråkke hardere enn planen. Lagrede ekte økter i alle verdener teller.</p>
    <div className="achievement-grid">{items.map(item=><article key={item.id} className={item.earned?'earned':''}><span className="achievement-state">{item.earned?<Check size={16}/>:<LockKeyhole size={15}/>} {item.earned?'ÅPNET':'TREN MOT'}</span><h3>{item.name}</h3><p>{item.requirement}</p><div className="achievement-meter"><i style={{width:`${item.progress*100}%`}}/></div><small>{item.evidence}</small><strong>{item.reward} <span>i The Grid</span></strong></article>)}</div>
  </section>;
}

export function PerformanceHUD({items,demo}: {items:Achievement[];demo:boolean}) {
  const allReady=items.every(x=>x.ready);
  const next=items.find(x=>!x.ready)??items[0];
  const readyKey=items.filter(x=>x.ready&&!x.earned).map(x=>x.id).join(',');
  const [fresh,setFresh]=useState<Achievement|null>(null);
  useEffect(()=>{
    setFresh(items.filter(x=>x.ready&&!x.earned).at(-1)??null);
    const timer=setTimeout(()=>setFresh(null),5000);
    return ()=>clearTimeout(timer);
  },[readyKey]);
  return <section className="performance-hud" aria-label="Prestasjonsmål"><span>{demo?'DEMO · FORHÅNDSVISNING':'THE GRID · TRENINGSOPPDRAG'}</span><strong>{fresh?`${fresh.name} oppnådd`:next.ready?'Alle fire prestasjoner oppnådd':next.name}</strong><p>{fresh?`${fresh.reward} aktivert${demo?' i prøveturen':'. Beholdes når du lagrer'}.`:allReady?'Følg øktplanen videre. Watt, intervaller og analyse er fortsatt målet.':next.requirement}</p><div className="achievement-meter"><i style={{width:`${(fresh??next).progress*100}%`}}/></div><small>{allReady&&!fresh?(items.every(x=>x.earned)?'Fire dokumenterte prestasjoner i lagret historikk':demo?'Forhåndsvisning – lagret historikk er uendret':'Oppnådd i økten – beholdes når du lagrer'):(fresh??next).evidence}</small></section>;
}

export function AchievementReceipt({items,demo}: {items:Achievement[];demo:boolean}) {
  if(demo||!items.length)return null;
  return <section className="achievement-receipt"><h3><ShieldCheck size={18}/> Prestasjoner dokumentert i denne økten</h3>{items.map(x=><p key={x.id}><strong>{x.name} → {x.reward}</strong><span>{x.evidence}</span></p>)}</section>;
}
