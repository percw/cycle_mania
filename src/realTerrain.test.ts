import {describe,it,expect} from 'vitest';
import {REAL_LAP_METERS,routeAt,terrainHeight} from './realTerrain';
describe('naturalistic road geometry',()=>{
 it('has a continuous closed8.4km circuit without a position/heading jump',()=>{
  const start=routeAt(0),end=routeAt(1);expect(end).toEqual(start);
  let length=0,last=start;for(let i=1;i<=8400;i++){const p=routeAt(i/8400);length+=Math.hypot(p.x-last.x,p.z-last.z);last=p;}
  expect(Math.abs(length-REAL_LAP_METERS)).toBeLessThan(.1);
  const nearEnd=routeAt(1-1/8400);expect(Math.hypot(nearEnd.x-start.x,nearEnd.z-start.z)).toBeCloseTo(1,2);
 });
 it('keeps ground just below the whole asphalt and the camera above water',()=>{
  for(let i=0;i<840;i++){const center=routeAt(i/840);expect(center.y).toBeGreaterThan(0);for(const offset of [-3.1,0,3.1]){const p=routeAt(i/840,offset);expect(terrainHeight(p.x,p.z)).toBeLessThan(p.y+.01);expect(p.y-terrainHeight(p.x,p.z)).toBeLessThan(.4);}}
 });
 it('keeps slope comfortable and repeatability independent of elapsed time',()=>{
  for(let i=0;i<8400;i+=10){const a=routeAt(i/8400),b=routeAt((i+10)/8400);expect(Math.abs(b.y-a.y)/10).toBeLessThan(.08);expect(a).toEqual(routeAt(i/8400));}
 });
});
