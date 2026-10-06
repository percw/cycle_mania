/** Deterministic fictional coastal circuit. Coordinates and heights are metres. */
export const REAL_LAP_METERS=8400;
const TAU=Math.PI*2;
export const seedRandom=(seed:number)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const hash=(x:number,z:number)=>{let n=Math.imul(x,374761393)+Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295};
export function noise(x:number,z:number){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;}
export function relief(x:number,z:number){return noise(x/260,z/260)*.52+noise(x/110,z/110)*.26+noise(x/43,z/43)*.14+noise(x/17,z/17)*.08;}
const radiusRaw=(a:number)=>1260+100*Math.sin(a*3)+36*Math.sin(a*7+.4);
const rawPoint=(a:number)=>({x:radiusRaw(a)*Math.sin(a),z:radiusRaw(a)*Math.cos(a)});
const samples=4096,arc=[0];let last=rawPoint(0);
for(let i=1;i<=samples;i++){const p=rawPoint(i/samples*TAU);arc.push(arc[i-1]+Math.hypot(p.x-last.x,p.z-last.z));last=p;}
const rawLength=arc[samples],scale=REAL_LAP_METERS/rawLength;
export const roadRadius=(angle:number)=>radiusRaw(angle)*scale;
export const roadHeight=(a:number)=>20+9*Math.sin(a*2-.6)+7*Math.sin(a*3+.4)+5*Math.cos(a);
export function angleAtProgress(progress:number){const target=((progress%1)+1)%1*rawLength;let low=0,high=samples;while(high-low>1){const mid=(low+high)>>1;if(arc[mid]<target)low=mid;else high=mid;}return (low+(target-arc[low])/(arc[high]-arc[low]))/samples*TAU;}
export function routeAt(progress:number,offset=0){const a=angleAtProgress(progress),r=roadRadius(a),da=.0001;const x=r*Math.sin(a),z=r*Math.cos(a),p2=rawPoint(a+da),p1=rawPoint(a-da),dx=p2.x-p1.x,dz=p2.z-p1.z,len=Math.hypot(dx,dz);const rightX=-dz/len,rightZ=dx/len;return {x:x+rightX*offset,y:roadHeight(a),z:z+rightZ*offset,dx:dx/len,dz:dz/len,rightX,rightZ,angle:a};}
export function terrainHeight(x:number,z:number){const a=Math.atan2(x,z),radius=Math.hypot(x,z),offset=radius-roadRadius(a),road=roadHeight(a),rough=relief(x,z);
 if(Math.abs(offset)<5.2)return road-.09;
 if(offset>0){const shelf=68+40*(1+Math.sin(a*3-1)),s=(offset-5.2)/shelf;return road-.12-road*Math.min(1.35,s*s*.9)+Math.min(3,(offset-5.2)*.1)*(rough-.5);}
 const inland=-offset-5.2,foothill=Math.min(1,inland/320);return road-.1+inland*.46*foothill+(rough-.38)*Math.min(390,inland*.8)+90*Math.sin(a*4+.6)**2*foothill;
}
