import { analyzeExecution } from './analytics';
import type { RideRecord } from './storage';

export type AchievementId = 'precision' | 'endurance' | 'recovery' | 'consistency';
export interface Achievement {
  id: AchievementId; name: string; requirement: string; reward: string;
  earned: boolean; ready: boolean; progress: number; evidence: string;
}
const definitions = [
  {id:'precision',name:'Presisjon',requirement:'5 målte minutter i arbeidsdrag, minst 90 % innenfor wattmålet.',reward:'Cyan hjulkrans'},
  {id:'endurance',name:'Utholdenhet',requirement:'20 målte minutter i én økt, minst 80 % innenfor wattmålet.',reward:'Opplyste grid-tårn'},
  {id:'recovery',name:'Pausekontroll',requirement:'3 målte minutter i aktive pauser, minst 90 % innenfor pausens wattmål.',reward:'Systembuer i kjernen'},
  {id:'consistency',name:'Kontinuitet',requirement:'3 ulike treningsdager med minst 10 målte minutter og 80 % innenfor wattmålet.',reward:'Forlenget lysspor og karosserilys'},
] as const;

/** All rewards are derived from saved measurement evidence; never score, RNG, or raw watts. */
export function performanceAchievements(history: RideRecord[], live?: RideRecord): Achievement[] {
  const unique=new Map<string,RideRecord>();
  for (const ride of history) if(ride.demo===false && !unique.has(ride.id)) unique.set(ride.id,ride);
  const saved=[...unique.values()];
  const candidates=live?.demo===false && !unique.has(live.id)?[...saved,live]:saved;
  const cache=new Map<RideRecord,ReturnType<typeof analyzeExecution>>();
  const metrics=(r:RideRecord)=>{let a=cache.get(r);if(!a){a=analyzeExecution(r);cache.set(r,a)}return a};
  const eligible=(r:RideRecord)=>{const a=metrics(r);return a.coverage>=.95 && a.measuredSeconds>0 && a.overall.targetSeconds===a.measuredSeconds};
  const outcome=(id:AchievementId,rides:RideRecord[])=>{
    if(id==='consistency') {
      const days=new Set(rides.filter(r=>eligible(r)&&metrics(r).measuredSeconds>=600&&metrics(r).overall.inTargetSeconds>=metrics(r).overall.targetSeconds*.8)
        .map(r=>Number.isFinite(Date.parse(r.date))?new Date(r.date).toLocaleDateString('sv-SE'):null).filter(Boolean));
      return {qualified:days.size>=3,progress:Math.min(1,days.size/3),evidence:`${days.size}/3 treningsdager med dokumentert måloppnåelse`};
    }
    let best={qualified:false,progress:0,evidence:'Ingen kvalifiserende målinger ennå'};
    for(const r of rides){
      const a=metrics(r),group=id==='precision'?a.work:id==='recovery'?a.recovery:a.overall;
      const required=id==='precision'?300:id==='recovery'?180:1200,accuracy=id==='endurance'?80:90;
      const known=id==='endurance'||a.executionKnown;
      const qualified=eligible(r)&&known&&group.observedSeconds>=required&&group.inTargetSeconds>=group.targetSeconds*accuracy/100;
      const progress=eligible(r)&&known?Math.min(1,group.observedSeconds/required,(group.adherence??0)/accuracy):0;
      if(qualified||progress>best.progress)best={qualified,progress,evidence:`${Math.floor(group.observedSeconds)}/${required} målsekunder · ${group.adherence??0} % presisjon · ${Math.round(a.coverage*100)} % datadekning`};
      if(qualified)break;
    }
    return best;
  };
  return definitions.map(d=>{const previous=outcome(d.id,saved),current=outcome(d.id,candidates);return {...d,earned:previous.qualified,ready:current.qualified,progress:current.progress,evidence:current.evidence}});
}
