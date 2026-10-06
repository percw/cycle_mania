import {workoutDuration, type Workout} from './training';

export interface PlanCursor {
  index:number; seconds:number; meters:number;
  blockSeconds:number[]; blockMeters:number[]; skippedBlocks:number[];
}
export function createPlanCursor(workout:Workout):PlanCursor {
  return {index:0,seconds:0,meters:0,blockSeconds:workout.blocks.map(()=>0),blockMeters:workout.blocks.map(()=>0),skippedBlocks:[]};
}
export function validPlanCursor(workout:Workout,cursor:PlanCursor|undefined):cursor is PlanCursor {
  return !!cursor && Number.isInteger(cursor.index)&&cursor.index>=0&&cursor.index<=workout.blocks.length
    &&[cursor.seconds,cursor.meters].every(n=>Number.isFinite(n)&&n>=0)
    &&[cursor.blockSeconds,cursor.blockMeters].every(a=>Array.isArray(a)&&a.length===workout.blocks.length&&a.every(n=>Number.isFinite(n)&&n>=0))
    &&Array.isArray(cursor.skippedBlocks)&&cursor.skippedBlocks.every(n=>Number.isInteger(n)&&n>=0&&n<workout.blocks.length);
}
export function planState(workout:Workout,cursor:PlanCursor) {
  const completed=cursor.index>=workout.blocks.length;
  const index=Math.min(cursor.index,workout.blocks.length-1),block=workout.blocks[index];
  const fraction=completed?1:Math.min(1,block.distanceMeters?cursor.meters/block.distanceMeters:cursor.seconds/block.seconds);
  const remaining=completed?0:block.seconds*(1-fraction);
  const remainingMeters=block.distanceMeters===undefined?undefined:completed?0:Math.max(0,block.distanceMeters-cursor.meters);
  const prior=workout.blocks.slice(0,cursor.index).reduce((sum,b)=>sum+b.seconds,0);
  const total=workoutDuration(workout);
  return {block,index,remaining,remainingMeters,totalRemaining:completed?0:Math.max(0,total-prior-block.seconds*fraction),completed,progress:completed?1:(prior+block.seconds*fraction)/total};
}
/** Root consumes at most a second and stops exactly at the actual unit boundary. */
export function planStepLimit(workout:Workout,cursor:PlanCursor,metersPerSecond:number) {
  const state=planState(workout,cursor);
  if(state.completed)return 0;
  return state.remainingMeters===undefined?state.remaining:metersPerSecond>0?state.remainingMeters/metersPerSecond:Infinity;
}
export function advancePlan(workout:Workout,cursor:PlanCursor,seconds:number,meters:number):PlanCursor {
  if(cursor.index>=workout.blocks.length||!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(meters)||meters<0)return cursor;
  const next={...cursor,seconds:cursor.seconds+seconds,meters:cursor.meters+meters,blockSeconds:[...cursor.blockSeconds],blockMeters:[...cursor.blockMeters]};
  next.blockSeconds[cursor.index]+=seconds;next.blockMeters[cursor.index]+=meters;
  const b=workout.blocks[cursor.index];
  if(b.distanceMeters!==undefined?next.meters>=b.distanceMeters-1e-6:next.seconds>=b.seconds-1e-6){next.index++;next.seconds=0;next.meters=0;}
  return next;
}
export function skipPlan(workout:Workout,cursor:PlanCursor):{cursor:PlanCursor;skippedSeconds:number} {
  const s=planState(workout,cursor);
  if(s.completed)return {cursor,skippedSeconds:0};
  return {cursor:{...cursor,index:cursor.index+1,seconds:0,meters:0,skippedBlocks:[...new Set([...cursor.skippedBlocks,cursor.index])]},skippedSeconds:s.remainingMeters===undefined?s.remaining:0};
}
