import {describe,it,expect} from 'vitest';
import {createPlanCursor,advancePlan,planState,planStepLimit,skipPlan} from './workoutRuntime';
import type {Workout} from './training';
const workout:Workout={id:'test',name:'Mixed',subtitle:'',description:'',category:'Egen',difficulty:1,custom:true,blocks:[{label:'Drag',kind:'work',seconds:10,intensity:1},{label:'Meterpause',kind:'recovery',seconds:12,distanceMeters:100,intensity:.5},{label:'Drag2',kind:'work',seconds:10,intensity:1}]};
describe('unit-aware workout cursor',()=>{
 it('distance follows actual virtual meters, not the preview time',()=>{
  let c=advancePlan(workout,createPlanCursor(workout),10,90);expect(c.index).toBe(1);
  c=advancePlan(workout,c,12,60);expect(planState(workout,c).remainingMeters).toBe(40);expect(c.index).toBe(1);
  expect(planStepLimit(workout,c,5)).toBe(8);c=advancePlan(workout,c,8,40);expect(c.index).toBe(2);expect(c.blockSeconds).toEqual([10,20,0]);expect(c.blockMeters).toEqual([90,100,0]);
 });
 it('stopped distance does not complete a rest; a time rest still counts time',()=>{
  let c=advancePlan(workout,createPlanCursor(workout),10,0);expect(planStepLimit(workout,c,0)).toBe(Infinity);
  c=advancePlan(workout,c,100,0);expect(c.index).toBe(1);expect(planState(workout,c).remainingMeters).toBe(100);
 });
 it('skip gives no elapsed time or meters and preserves exact checkpoint progress',()=>{
  let c=advancePlan(workout,createPlanCursor(workout),10,90);c=advancePlan(workout,c,5,25);
  expect(planState(workout,JSON.parse(JSON.stringify(c)))).toEqual(planState(workout,c));
  const skipped=skipPlan(workout,c);expect(skipped.skippedSeconds).toBe(0);expect(skipped.cursor.blockSeconds).toEqual([10,5,0]);expect(skipped.cursor.skippedBlocks).toEqual([1]);expect(skipped.cursor.index).toBe(2);
 });
 it('time skip uses actual remaining time and final completion has no phantom block',()=>{
  const partial=advancePlan(workout,createPlanCursor(workout),3,4);let next=skipPlan(workout,partial);expect(next.skippedSeconds).toBe(7);
  next=skipPlan(workout,next.cursor);const c=advancePlan(workout,next.cursor,10,90);expect(planState(workout,c).completed).toBe(true);expect(planStepLimit(workout,c,10)).toBe(0);
 });
});
