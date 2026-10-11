import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three/webgpu';
import {texture,positionWorld,normalWorld,mix,smoothstep,float,vec3,triplanarTexture,distance,cameraPosition} from 'three/tsl';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import type {WorldSceneProps} from './worlds';
import {RideMotion} from './rideMotion';
import {partitionInstances} from './sceneChunks';
import {readStored,saveStored} from './storage';
import {REAL_LAP_METERS,routeAt,roadRadius,terrainHeight,noise,seedRandom} from './realTerrain';

const ASSETS='/assets/vestland/';
const SECTORS=['Fjordkanten','Bjørkelia','Bygda'];
type CameraView='bike'|'scenic'|'cockpit';
const CAMERA_VIEWS:{id:CameraView;label:string;aria:string}[]=[{id:'bike',label:'Vei',aria:'Sykkelkamera'},{id:'scenic',label:'Utsikt',aria:'Utsiktskamera'},{id:'cockpit',label:'Styre',aria:'Armer og styre'}];
/** Naturalistic, fictional West Norwegian road. Local CC0 photographic materials. */
export default function RealWorld(props:WorldSceneProps){
 const host=useRef<HTMLDivElement>(null),live=useRef(props);live.current=props;
 const [failed,setFailed]=useState(false),[loading,setLoading]=useState(true),[sector,setSector]=useState(0),[view,setView]=useState<CameraView>(()=>{const saved=readStored('summit-vestland-camera','bike');return CAMERA_VIEWS.some(v=>v.id===saved)?saved as CameraView:'bike'});const viewRef=useRef(view);viewRef.current=view;
 const motion=useRef<RideMotion|null>(null);if(!motion.current)motion.current=new RideMotion(props.progress*REAL_LAP_METERS,performance.now(),props.running);
 useEffect(()=>{motion.current!.ingest(props.progress*REAL_LAP_METERS,performance.now(),props.running)},[props.progress,props.running,props.game.elapsed]);
 useEffect(()=>{
  const container=host.current;if(!container)return;
  let dirty=true,lastShadow=-Infinity,drawnView='';
  let disposed=false,frame=0,observer:ResizeObserver|undefined,renderer:THREE.WebGPURenderer|undefined;
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g};
  const material=<T extends THREE.Material>(m:T)=>{materials.add(m);return m};
  const mat=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>material(new THREE.MeshStandardMaterial({color,roughness:.86,...extra}));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#bfced4');scene.fog=new THREE.FogExp2('#b2c2c9',.00019);
  const camera=new THREE.PerspectiveCamera(67,1,.08,14000);
  const rng=seedRandom(4319),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const cube=geo(new THREE.BoxGeometry(1,1,1));
  const mesh=(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D=scene)=>{const o=new THREE.Mesh(g,m);parent.add(o);return o};
  const box=(parent:THREE.Object3D,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const o=mesh(cube,m,parent);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;return o};
  const batch=(g:THREE.BufferGeometry,m:THREE.Material,count:number)=>{const o=new THREE.InstancedMesh(g,m,count);o.receiveShadow=true;scene.add(o);return o};
  const place=(o:THREE.InstancedMesh,i:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,yaw=0)=>{dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(0,yaw,0);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix)};
  const hemi=new THREE.HemisphereLight('#c8dced','#656143',1.2);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff0d9',2.8);scene.add(sun,sun.target);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=360;sun.shadow.bias=-.0003;sun.shadow.normalBias=.12;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
  const loader=new THREE.TextureLoader();
  async function tex(name:string,color=false){const t=await loader.loadAsync(ASSETS+name);if(disposed){t.dispose();throw Error('disposed')}textures.add(t);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(color)t.colorSpace=THREE.SRGBColorSpace;return t;}
  function strip(width:number,offset:number,height:number,m:THREE.Material){const positions:number[]=[],uvs:number[]=[],indices:number[]=[];const n=4096;for(let i=0;i<=n;i++){for(const side of [-1,1]){const p=routeAt(i/n,offset+side*width/2);positions.push(p.x,p.y+height,p.z);uvs.push((offset+side*width/2)/3,i/n*REAL_LAP_METERS/3);}if(i<n){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();const o=mesh(g,m);o.receiveShadow=true;return o;}
  const metal=mat('#9da5a4',{metalness:.83,roughness:.39});
  // Photographic cutout, deliberately a camera-facing foreground rather than
  // primitive limb geometry. Preserve its proportions on every screen shape.
  const cockpitMaterial=material(new THREE.MeshBasicMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
  const cockpit=mesh(geo(new THREE.PlaneGeometry(1,1)),cockpitMaterial,camera);
  cockpit.position.z=-.5;cockpit.renderOrder=1000;cockpit.frustumCulled=false;cockpit.visible=false;
  scene.add(camera);
  const cockpitPromise=loader.loadAsync('/assets/rider/aero-cockpit-v1.png').then(t=>{
   if(disposed){t.dispose();return;}textures.add(t);t.colorSpace=THREE.SRGBColorSpace;
   cockpitMaterial.map=t;cockpitMaterial.needsUpdate=true;
  });
  let waterNormal:THREE.Texture|undefined;
  async function build(){
   const [asphalt,asphaltNormal,ground,rock,rockNormal,grass]=await Promise.all([tex('asphalt_02_diff_1k.jpg',true),tex('asphalt_02_nor_gl_1k.jpg'),tex('aerial_grass_rock_diff_1k.jpg',true),tex('lichen_rock_diff_1k.jpg',true),tex('lichen_rock_nor_gl_1k.jpg'),tex('grass_ground_diff_1k.jpg',true)]);
   if(disposed)return;
   const roadMaterial=mat('#929899',{map:asphalt,normalMap:asphaltNormal,normalScale:new THREE.Vector2(.35,.35),roughness:.94});
   strip(6.2,0,0,roadMaterial);strip(1.2,-3.7,-.025,mat('#a9a698',{map:ground}));strip(1.2,3.7,-.025,mat('#a9a698',{map:ground}));
   const paint=mat('#e8e4cc',{roughness:.9});strip(.085,-2.88,.018,paint);strip(.085,2.88,.018,paint);
   const marks=batch(cube,mat('#d5b355'),700);for(let i=0;i<700;i++){const p=routeAt(i/700);place(marks,i,p.x,p.y+.018,p.z,.105,.015,3,Math.atan2(p.dx,p.dz));}
   // Terrain follows the exact road surface, from narrow verges to glacial ridges.
   const terrainMat=material(new THREE.MeshStandardNodeMaterial({roughness:1}));
   const rockMix=smoothstep(float(.25),float(.58),float(1).sub(normalWorld.y)).max(smoothstep(float(260),float(650),positionWorld.y));
   const macro=texture(ground,positionWorld.xz.mul(.0006)).r.mul(.7).add(.65);
   const nearSurface=mix(texture(grass,positionWorld.xz.mul(.12)).mul(vec3(.58,.95,.43)),triplanarTexture(texture(rock),null,null,float(.055)),rockMix);
   const farSurface=mix(vec3(.09,.16,.07),vec3(.27,.29,.25),rockMix).mul(macro);
   terrainMat.colorNode=mix(nearSurface,farSurface,smoothstep(float(450),float(2200),distance(cameraPosition,positionWorld)));
   const positions:number[]=[],indices:number[]=[],rows=768;
   const offsets=[-1250,-1180,-1090,-1010,-920,-830,-740,-650,-570,-490,-420,-350,-290,-240,-195,-150,-115,-85,-60,-42,-28,-18,-11,-6,-4.2,-3,0,3,4.2,6,11,18,28,42,60,85,115,150,200,270,350];
   for(let i=0;i<=rows;i++){const a=i/rows*Math.PI*2,r=roadRadius(a);for(const off of offsets){const rad=Math.max(0,r+off),x=rad*Math.sin(a),z=rad*Math.cos(a);positions.push(x,terrainHeight(x,z),z);}}
   const columns=offsets.length;for(let i=0;i<rows;i++)for(let j=0;j<columns-1;j++){const k=i*columns+j;indices.push(k,k+1,k+columns,k+1,k+columns+1,k+columns);}
   const terrainGeo=geo(new THREE.BufferGeometry());terrainGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));terrainGeo.setIndex(indices);terrainGeo.computeVertexNormals();const terrain=mesh(terrainGeo,terrainMat);terrain.receiveShadow=true;
   // Continuous layered mountain shores. Fine ridges are geometry, not silhouettes pasted onto the sky.
   for(let ring=0;ring<2;ring++){
    const pos:number[]=[],ind:number[]=[],n=768,bands=64;for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;for(let j=0;j<=bands;j++){const r=3400+ring*2800+j/bands*2000,x=Math.sin(a)*r,z=Math.cos(a)*r;const profile=Math.sin(j/bands*Math.PI)**.8;const h=profile*(440+noise(x/1100,z/1100)*760+noise(x/380,z/380)*190+noise(x/140,z/140)*48)+(j===0?-25:0);pos.push(x,h,z);}}
    for(let i=0;i<n;i++)for(let j=0;j<bands;j++){const k=i*(bands+1)+j;ind.push(k,k+1,k+bands+1,k+1,k+bands+2,k+bands+1);}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();mesh(g,terrainMat);
   }
   // Small-scale normal ripples and sky reflection keep the fjord calm.
   const size=128,data=new Uint8Array(size*size*4);for(let z=0;z<size;z++)for(let x=0;x<size;x++){const i=(z*size+x)*4;data[i]=128+Math.sin(x*.39+Math.sin(z*.2))*22;data[i+1]=128+Math.cos(z*.47+x*.11)*19;data[i+2]=250;data[i+3]=255;}
   waterNormal=new THREE.DataTexture(data,size,size);waterNormal.wrapS=waterNormal.wrapT=THREE.RepeatWrapping;waterNormal.repeat.set(1900,1900);waterNormal.needsUpdate=true;textures.add(waterNormal);
   const water=mesh(geo(new THREE.PlaneGeometry(26000,26000)),mat('#42666d',{roughness:.22,metalness:.48,normalMap:waterNormal,normalScale:new THREE.Vector2(.3,.3),envMapIntensity:1.1}));water.rotation.x=-Math.PI/2;water.position.y=-.8;
   const stones=batch(geo(new THREE.IcosahedronGeometry(1,1)),mat('#b5b8ac',{map:rock,normalMap:rockNormal,normalScale:new THREE.Vector2(.5,.5)}),1400);stones.castShadow=true;
   for(let i=0;i<1400;i++){const p=routeAt(rng(),(rng()<.7?-1:1)*(5.5+rng()*19)),r=.15+rng()**3*1.9;place(stones,i,p.x,terrainHeight(p.x,p.z)+r*.25,p.z,r*1.6,r*.7,r,rng()*6.28);}
   const rail=mat('#b9bfba',{metalness:.78,roughness:.48}),posts=batch(cube,rail,850);let post=0;
   // Guardrail in exposed stretches; split into real lengths with mounting posts.
   for(let i=0;i<850;i++){const f=i/850,p=routeAt(f,4.1);if(f>.34&&f<.71){place(posts,post++,0,-100,0,0,0,0);continue;}place(posts,post++,p.x,p.y+.47,p.z,.07,.92,.11,Math.atan2(p.dx,p.dz));}
   const railGeo=geo(new THREE.BoxGeometry(.065,.27,5.64)),rails=batch(railGeo,rail,1500);let ri=0;for(let i=0;i<1500;i++){const f=i/1500,p=routeAt(f,4.1);if(f>.34&&f<.71){place(rails,ri++,0,-100,0,0,0,0);continue;}place(rails,ri++,p.x,p.y+.77,p.z,1,1,1,Math.atan2(p.dx,p.dz));}
   const reflectors=batch(cube,mat('#e4e3d9'),168),reflectorBlack=batch(cube,mat('#292c29'),168);for(let i=0;i<168;i++){const p=routeAt(i/168,i%2?-3.85:3.85),yaw=Math.atan2(p.dx,p.dz);place(reflectors,i,p.x,p.y+.53,p.z,.09,1.06,.12,yaw);place(reflectorBlack,i,p.x,p.y+.84,p.z,.095,.19,.126,yaw);}
   await buildTrees();if(disposed)return;buildHomes();buildGrass();
  }
  async function buildTrees(){
   const [firColor,firAlpha,leafColor,leafAlpha]=await Promise.all([tex('fir_tree_01_twig_diff_1k.png',true),tex('fir_tree_01_twig_alpha_1k.png'),tex('tree_small_02_leaves_diff_1k.png',true),tex('tree_small_02_leaves_alpha_1k.png')]);if(disposed)return;
   function card(u0:number,v0:number,u1:number,v1:number){const g=geo(new THREE.PlaneGeometry(1,1)),uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,u0+uv.getX(i)*(u1-u0),v0+uv.getY(i)*(v1-v0));return g;}
   const firMat=mat('#d4dfbc',{map:firColor,alphaMap:firAlpha,alphaTest:.45,side:THREE.DoubleSide,roughness:1});
   const leafMat=mat('#b8c990',{map:leafColor,alphaMap:leafAlpha,alphaTest:.5,side:THREE.DoubleSide,roughness:1});
   const firCount=1400,firBranches=60,birchCount=190,leavesPerTree=180;
   const trunkGeo=geo(new THREE.CylinderGeometry(.05,.17,1,7));
   const trunks=batch(trunkGeo,mat('#514738'),firCount),firLeaves=batch(card(.65,.624,.965,.976),firMat,firCount*firBranches);trunks.castShadow=firLeaves.castShadow=true;
   for(let i=0;i<firCount;i++){const f=rng(),inForest=f>.3&&f<.73;const off=-(9+rng()**2.6*(inForest?190:310)),p=routeAt(f,off),h=7+rng()*11,y=terrainHeight(p.x,p.z);place(trunks,i,p.x,y+h*.46,p.z,1,h*.92,1);for(let j=0;j<firBranches;j++){const layer=Math.floor(j/4),angle=j*2.399+f*35,level=.14+layer*.058,w=(1-level)*h*.4;dummy.position.set(p.x+Math.sin(angle)*w*.45,y+h*level,p.z+Math.cos(angle)*w*.45);dummy.scale.set(w*1.6,w*1.2,1);dummy.rotation.set(-.18-rng()*.5,angle,rng()*.25-.12);dummy.updateMatrix();firLeaves.setMatrixAt(i*firBranches+j,dummy.matrix);}}
   // Fine-leaved roadside trees, with open crowns instead of solid green cones.
   const birchTrunks=batch(trunkGeo,mat('#d4d2b9',{roughness:1}),birchCount),leafBatch=batch(card(.008,.705,.195,.832),leafMat,birchCount*leavesPerTree);birchTrunks.castShadow=leafBatch.castShadow=true;
   const limbs=batch(geo(new THREE.CylinderGeometry(.015,.045,1,5)),mat('#756f57'),birchCount*4);limbs.castShadow=true;
   for(let i=0;i<birchCount;i++){const f=(i/birchCount*.48+.27)%1,side=i%5===0?1:-1,p=routeAt(f,side*(8+rng()*22)),y=terrainHeight(p.x,p.z),h=5+rng()*5;place(birchTrunks,i,p.x,y+h*.4,p.z,.7,h*.8,.7);for(let j=0;j<4;j++){const a=j*2.4,base=new THREE.Vector3(p.x,y+h*.4,p.z),tip=new THREE.Vector3(p.x+Math.sin(a)*h*.23,y+h*(.64+j*.08),p.z+Math.cos(a)*h*.23);dummy.position.copy(base).add(tip).multiplyScalar(.5);dummy.scale.set(1,base.distanceTo(tip),1);dummy.quaternion.setFromUnitVectors(up,tip.sub(base).normalize());dummy.updateMatrix();limbs.setMatrixAt(i*4+j,dummy.matrix);}
    for(let j=0;j<leavesPerTree;j++){const a=rng()*Math.PI*2,r=Math.sqrt(rng())*h*.27,yf=rng();dummy.position.set(p.x+Math.sin(a)*r*(.65+Math.sin(yf*Math.PI)*.35),y+h*(.53+yf*.52),p.z+Math.cos(a)*r);dummy.scale.set(.33+rng()*.24,.23+rng()*.14,1);dummy.rotation.set(rng()*Math.PI,rng()*6.28,rng()*6.28);dummy.updateMatrix();leafBatch.setMatrixAt(i*leavesPerTree+j,dummy.matrix);}
   }
  }
  function buildHomes(){
   const timber=mat('#873e32'),white=mat('#d8d6c6'),roofMat=mat('#494c48',{roughness:.85}),glass=mat('#536b71',{metalness:.3,roughness:.2}),wood=mat('#756548');
   for(let i=0;i<18;i++){const f=.72+i/18*.23,offset=(i%3===0?1:-1)*(20+(i*29%60)),p=routeAt(f,offset),y=terrainHeight(p.x,p.z);if(y<2)continue;const house=new THREE.Group();house.position.set(p.x,y,p.z);house.rotation.y=Math.atan2(p.dx,p.dz)+Math.PI/2;scene.add(house);const w=6+(i%3)*1.2,d=9+(i%2)*3,h=4.4;
    box(house,mat('#8a8880'),0,.35,0,w+.3,.7,d+.3);box(house,i%3?timber:white,0,h/2+.5,0,w,h,d);
    const roofG=geo(new THREE.BufferGeometry()),a=w/2+.4,l=d/2+.4;roofG.setAttribute('position',new THREE.Float32BufferAttribute([-a,h+.5,-l,0,h+3.3,-l,a,h+.5,-l,-a,h+.5,l,0,h+3.3,l,a,h+.5,l],3));roofG.setIndex([0,3,1,1,3,4,1,4,2,2,4,5,0,1,2,3,5,4]);roofG.computeVertexNormals();const roof=mesh(roofG,roofMat,house);roof.castShadow=true;
    for(const side of [-1,1])for(let j=0;j<3;j++){const z=(j-1)*d*.27;box(house,white,side*(w/2+.025),2.85,z,.085,1.6,1.35);box(house,glass,side*(w/2+.073),2.85,z,.035,1.38,1.13);box(house,white,side*(w/2+.095),2.85,z,.045,1.4,.055);box(house,white,side*(w/2+.095),2.85,z,.045,.055,1.18);}
    box(house,white,0,2.7,-d/2-.04,1.7,1.8,.08);box(house,glass,0,2.7,-d/2-.09,1.43,1.5,.04);box(house,white,0,2.7,-d/2-.12,.06,1.5,.03);box(house,roofMat,w*.2,h+3,0,.6,2,.65);
    // Timber siding catches low sunlight; modelled at a restrained, real-world pitch.
    for(let j=0;j<20;j++)for(const side of [-1,1])box(house,i%3?timber:white,side*(w/2+.013),.65+j*.2,0,.038,.025,d);
    for(const side of [-1,1])box(house,white,side*w/2,h/2+.5,-d/2-.03,.16,h,.08);
    for(let j=0;j<9;j++){const fp=routeAt(f+(j-4)*.0008,offset>0?9:-9);box(scene,wood,fp.x,terrainHeight(fp.x,fp.z)+.5,fp.z,.09,1,.09);}
   }
   // Modest local road sign, not a game billboard.
   const p=routeAt(.012,-4.9),pole=box(scene,metal,p.x,p.y+1.05,p.z,.07,2.1,.07);pole.castShadow=true;
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ece8d3';ctx.fillRect(0,0,512,128);ctx.strokeStyle='#242c29';ctx.lineWidth=8;ctx.strokeRect(8,8,496,112);ctx.fillStyle='#242c29';ctx.font='600 57px sans-serif';ctx.textAlign='center';ctx.fillText('FJORDVIK',256,85);const signTex=new THREE.CanvasTexture(canvas);signTex.colorSpace=THREE.SRGBColorSpace;textures.add(signTex);const sign=mesh(geo(new THREE.PlaneGeometry(2.2,.55)),mat('#ffffff',{map:signTex,side:THREE.DoubleSide}));sign.position.set(p.x,p.y+2.15,p.z);sign.rotation.y=Math.atan2(-p.dx,-p.dz);
  }
  function buildGrass(){
   const p:number[]=[],colors:number[]=[],idx:number[]=[];const count=24000,c=new THREE.Color();
   for(let i=0;i<count;i++){const f=rng(),side=i%2?1:-1,pt=routeAt(f,side*(4.5+rng()**2*7)),y=terrainHeight(pt.x,pt.z),h=.08+rng()*.4,a=rng()*Math.PI,w=.015+rng()*.026,dx=Math.sin(a)*w,dz=Math.cos(a)*w,k=i*3;p.push(pt.x-dx,y,pt.z-dz,pt.x+dx,y,pt.z+dz,pt.x+Math.sin(a)*h*.23,y+h,pt.z+Math.cos(a)*h*.23);c.setHSL(.17+rng()*.065,.2+rng()*.2,.18+rng()*.14);for(let j=0;j<3;j++)colors.push(c.r,c.g,c.b);idx.push(k,k+1,k+2);}
   const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();mesh(g,mat('#ffffff',{vertexColors:true,side:THREE.DoubleSide}));
  }
  let previous=0,travel=live.current.progress*REAL_LAP_METERS,currentSector=-1,waterTime=0;
  function animate(now:number){if(disposed||!renderer)return;const dt=previous?Math.min(.05,(now-previous)/1000):0;previous=now;const state=live.current;
   // Position belongs to the measured session. Render interpolation never accumulates a second ride clock.
   const expected=Math.max(0,state.progress)*REAL_LAP_METERS;
   const shouldDraw=dirty||state.running||Math.abs(travel-expected)>.001||drawnView!==viewRef.current;
   travel=motion.current!.update(now);if(state.running)waterTime+=dt;
   const p=routeAt(travel/REAL_LAP_METERS,1.3),ahead=routeAt((travel+22)/REAL_LAP_METERS,1.3),scenic=viewRef.current==='scenic',immersive=viewRef.current==='cockpit';
   camera.position.set(p.x,p.y+(scenic?3.8:immersive?1.9:1.72),p.z);camera.lookAt(ahead.x,ahead.y+(scenic?1.8:immersive?-.6:1.55),ahead.z);
   const fov=66+Math.min(1,Math.max(0,(state.speed-20)/45))*6;if(Math.abs(camera.fov-fov)>.02){camera.fov+=(fov-camera.fov)*Math.min(1,dt*3);camera.updateProjectionMatrix();}
   cockpit.visible=immersive;
   if(immersive){
    const visibleHeight=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const landscape=THREE.MathUtils.smoothstep(camera.aspect,.6,1.3);
    const width=visibleHeight*camera.aspect*THREE.MathUtils.lerp(1.25,.9,landscape);
    const height=width/1.5;
    cockpit.scale.set(width,height,1);
    cockpit.position.y=visibleHeight*(.5-THREE.MathUtils.lerp(.84,1.08,landscape))+height/2;
   }
   if(Math.abs(travel-lastShadow)>6){sun.position.set(p.x-90,p.y+145,p.z-65);sun.target.position.set(p.x,p.y,p.z);sun.target.updateMatrixWorld();sun.shadow.needsUpdate=true;lastShadow=travel;}
   if(waterNormal)waterNormal.offset.set(waterTime*.001,waterTime*.0007);
   const sec=Math.min(2,Math.floor(((travel/REAL_LAP_METERS)%1)*3));if(sec!==currentSector){currentSector=sec;setSector(sec);live.current.onSector?.(sec);}
   container!.dataset.distance=expected.toFixed(3);container!.dataset.visualDistance=travel.toFixed(3);container!.dataset.sector=String(sec);container!.dataset.camera=viewRef.current;
   try{if(shouldDraw){renderer.render(scene,camera);container!.dataset.triangles=String(renderer.info.render.triangles);container!.dataset.drawCalls=String(renderer.info.render.drawCalls);dirty=false;drawnView=viewRef.current;}}catch(error){if(!disposed){console.error('Vestlandsveien render failed',error);setFailed(true);}return;}frame=requestAnimationFrame(animate);
  }
  async function initialize(){try{
   renderer=new THREE.WebGPURenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
   await renderer.init();if(disposed){renderer.dispose();return;}
   renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block';renderer.domElement.setAttribute('aria-label','Vestlandsveien: naturtro fjordvei med fotografiske materialer, skog og vestlandske gårder');container!.appendChild(renderer.domElement);
   const resize=()=>{if(disposed||!renderer)return;const w=container!.clientWidth||900,h=container!.clientHeight||500;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;};observer=new ResizeObserver(resize);observer.observe(container!);resize();
   const hdrPromise=new HDRLoader().loadAsync(ASSETS+'kloofendal_48d_partly_cloudy_puresky_1k.hdr').then(hdr=>{if(disposed){hdr.dispose();return;}textures.add(hdr);hdr.mapping=THREE.EquirectangularReflectionMapping;scene.background=hdr;scene.environment=hdr;scene.backgroundIntensity=.8;scene.environmentIntensity=.45;scene.backgroundRotation.y=.65;scene.environmentRotation.y=.65;});
   await Promise.all([build(),hdrPromise,cockpitPromise]);if(disposed)return;
   // Whole-circuit instance batches defeated frustum culling. Preserve every tree,
   // but let Three.js submit only local chunks intersecting the camera or shadow view.
   const originalBatches:THREE.InstancedMesh[]=[];
   scene.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.count>100)originalBatches.push(o)});
   let totalInstances=0,totalChunks=0;
   for(const source of originalBatches){const parent=source.parent!;const chunks=partitionInstances(source);for(const chunk of chunks)parent.add(chunk);totalInstances+=source.count;totalChunks+=chunks.length;parent.remove(source);source.dispose();}
   container!.dataset.sceneInstances=String(totalInstances);container!.dataset.sceneChunks=String(totalChunks);
   live.current.onRenderer?.((renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL 2');setLoading(false);frame=requestAnimationFrame(animate);
  }catch(error){if(!disposed){console.error('Unable to open Vestlandsveien',error);setFailed(true);setLoading(false);live.current.onRenderer?.('2D');}}}
  void initialize();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();renderer?.domElement.remove();if(renderer?.hasInitialized())renderer.dispose();scene.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());scene.clear();};
 },[]);
 return <div ref={host} className="ride-scene real-world" style={{position:'absolute',inset:0,overflow:'hidden',background:'#b9cbd1'}}>
  {!loading&&!failed&&<div className="real-world-caption"><span>{SECTORS[sector]}</span><div className="real-camera-options" role="group" aria-label="Kameravinkel">{CAMERA_VIEWS.map(v=><button key={v.id} aria-label={v.aria} aria-pressed={view===v.id} onClick={()=>{setView(v.id);saveStored('summit-vestland-camera',v.id)}}>{v.label}</button>)}</div></div>}
  {loading&&<div className="real-world-loading">Åpner fjorden …</div>}
  {failed&&<div className="real-world-loading">Kunne ikke åpne 3D-verdenen. Økt og målinger fortsetter.</div>}
 </div>;
}
