import {describe,it,expect} from 'vitest';
import {performanceAchievements} from './achievements';
import {workouts,getWorkoutState} from './training';
import type {RideRecord} from './storage';
const workout=workouts.find(w=>w.id==='threshold-4x10')!;
const offset=(kind:string)=>{let n=0;for(const block of workout.blocks){if(block.kind===kind)return n;n+=block.seconds}return n};
function ride(seconds=300,skip=offset('work'),ftp=250):RideRecord{return {id:'r',name:workout.name,workoutId:workout.id,date:'2026-10-01T12:00:00Z',seconds,distance:0,avgPower:0,energy:0,zoneSeconds:[0,0,0,0,0,0,0],completed:false,demo:false,ftp,skippedSeconds:skip,samples:Array.from({length:seconds},(_,i)=>{const second=i+1,target=getWorkoutState(workout,skip+i).block.intensity*ftp;return {second,workoutSecond:skip+second,wallSecond:second,power:target,targetPower:target,cadence:null,heartRate:null,measured:true}})}}
const earned=(r:RideRecord[])=>performanceAchievements(r).filter(a=>a.earned).map(a=>a.id);
describe('evidence-based performance unlocks',()=>{
 it('earns precision from actual work data at any FTP, not skipped time or watts',()=>{expect(earned([ride()])).toContain('precision');expect(earned([ride(300,offset('work'),100)])).toContain('precision');expect(earned([ride(299)])).not.toContain('precision');const excessive=ride();excessive.samples!.forEach(s=>s.power*=1.5);expect(earned([excessive])).not.toContain('precision')});
 it('excludes demo, gaps and unmeasured telemetry',()=>{const r=ride();expect(earned([{...r,demo:true}])).toEqual([]);expect(earned([{...r,seconds:600}])).toEqual([]);expect(earned([{...r,samples:r.samples!.map(s=>({...s,measured:false}))}])).toEqual([])});
 it('requires exact accuracy rather than rounding up below threshold',()=>{const r=ride(600);r.samples!.forEach((s,i)=>{if(i<61)s.power*=1.5});expect(earned([r])).not.toContain('precision')});
 it('recovery rewards controlled recovery samples and no guessed skipped legacy positions',()=>{const r=ride(180,offset('recovery'));expect(earned([r])).toContain('recovery');expect(earned([{...r,samples:r.samples!.map(({workoutSecond,...s})=>s)}])).not.toContain('recovery')});
 it('endurance requires1200 measured seconds; score or expedition count alone cannot earn it',()=>{expect(earned([ride(1200,0)])).toContain('endurance');expect(earned([ride(1199,0)])).not.toContain('endurance')});
 it('consistency counts unique recorded training days and de-duplicates IDs',()=>{const a=ride(600),b={...a,id:'b',date:'2026-10-02T12:00:00Z'},c={...a,id:'c',date:'2026-10-03T12:00:00Z'};expect(earned([a,b,c])).toContain('consistency');expect(earned([a,a,a])).not.toContain('consistency');expect(earned([a,{...b,date:a.date},{...c,date:a.date}])).not.toContain('consistency')});
 it('live milestones are provisional until the measured ride is saved',()=>{const result=performanceAchievements([],ride()).find(x=>x.id==='precision')!;expect(result.ready).toBe(true);expect(result.earned).toBe(false);expect(performanceAchievements([], {...ride(),demo:true}).some(x=>x.ready)).toBe(false)});
});
