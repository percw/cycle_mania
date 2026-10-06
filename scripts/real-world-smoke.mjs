/** Real WebGL scene; isolated Vite and intercepted APIs never touch the rider database. */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'output/real-world');
const captureOnly=process.env.REAL_WORLD_CAPTURE_ONLY==='1';
const checks=[],errors=[],records=[];
let vite,browser,page;
const check=name=>{checks.push(name);console.log(`PASS ${name}`)};
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const click=locator=>locator.evaluate(el=>el.click());
const frames=()=>page.clock.runFor(34);
const advance=seconds=>page.evaluate(s=>window.advanceTime(s*1000),seconds);
const pause=async()=>{if((await state()).mode==='riding')await click(page.getByRole('button',{name:'Pause',exact:true}))};
const resume=async()=>{if((await state()).mode==='paused')await click(page.getByRole('button',{name:'Fortsett økten',exact:true}))};
const scene=()=>page.locator('.ride-view .real-world');
async function capture(name){await frames();await page.screenshot({path:resolve(out,`${name}.png`)});}
async function distanceMatches(){
  await frames();
  const s=await state(),meters=Number(await scene().getAttribute('data-distance'));
  assert.ok(Math.abs(meters-s.session.distanceKm*1000)<2.5,`Scene ${meters} m disagrees with ride ${s.session.distanceKm*1000} m`);
  const visual=Number(await scene().getAttribute('data-visual-distance'));
  assert.ok(Number.isFinite(visual)&&visual>=0&&visual<=meters+.001,`Visual position ${visual} must not run ahead of measured ${meters}`);
  return s;
}
async function rideTo(km){
  for(let i=0;i<120;i++){
    if((await state()).session.distanceKm>=km)return;
    await advance(20);
  }
  throw Error(`Did not reach ${km} km`);
}
try {
  await mkdir(out,{recursive:true});
  if(!captureOnly)await rm(resolve(out,'report.json'),{force:true});
  vite=await createServer({root,configFile:false,plugins:[react()],logLevel:'error',server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,watch:null}});
  await vite.listen();
  const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.ok(!['3001','5186'].includes(new URL(url).port));
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:captureOnly?{width:390,height:844}:{width:1440,height:1000}});
  page.setDefaultTimeout(60000);
  await page.clock.install({time:new Date('2026-10-04T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-04T12:00:01Z'));
  await page.addInitScript(()=>localStorage.setItem('summit-last-workout',JSON.stringify('endurance-60')));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.on('request',r=>{if(['3001','5186'].includes(new URL(r.url()).port))errors.push(`User runtime request: ${r.url()}`)});
  await page.route('**/api/**',async r=>{
    const p=new URL(r.request().url()).pathname;let data={};
    if(p==='/api/rides'){
      if(r.request().method()==='POST'){data=r.request().postDataJSON();const at=records.findIndex(x=>x.id===data.id);if(at<0)records.push(data);else records[at]=data;}
      else data=records;
    }else if(p==='/api/workouts')data=[];
    else if(p==='/api/profile')data={ftp:250,updatedAt:null};
    else if(p==='/api/health')data={ok:true,storage:'sqlite',rides:records.length};
    else if(p==='/api/ant/status')data={status:'disconnected',error:null};
    else throw Error(`Unexpected API request ${r.request().method()} ${p}`);
    await r.fulfill({json:data});
  });
  await page.goto(url);
  await page.waitForFunction(()=>!!window.render_game_to_text);
  await click(page.locator('.world-option').filter({hasText:'Vestlandsveien'}));
  assert.equal((await state()).route,'vestland');
  if(!captureOnly){
  await page.clock.runFor(500);
  await page.locator('.world-vestland .real-world canvas').waitFor();
  await page.locator('.world-vestland .real-world-caption').waitFor();
  await capture('launcher');
  check('Vestlandsveien is selectable from the world shelf and loads a real 3D canvas');
  }
  await click(page.locator('.demo-start'));
  if(captureOnly)await page.clock.runFor(500);
  await scene().locator('canvas').waitFor();
  await scene().locator('.real-world-caption').waitFor();
  if(captureOnly){
    const servedSource=await (await page.request.get(`${url}/src/RealWorld.tsx`)).text();
    assert.match(servedSource,/aero-cockpit-v1\.png/,'Fresh Vite must serve photographic cockpit');
    await page.setViewportSize({width:390,height:844});
    await click(page.getByRole('button',{name:'Armer og styre',exact:true}));
    await frames();await frames();
    assert.equal(await scene().getAttribute('data-camera'),'cockpit');
    assert.equal(await page.evaluate(()=>innerWidth),390);
    await capture('aero-cockpit-mobile');
    for(const name of ['Sykkelkamera','Utsiktskamera','Armer og styre']){
      const box=await page.getByRole('button',{name,exact:true}).boundingBox();
      assert.ok(box&&box.height>=44&&box.x>=0&&box.x+box.width<=390);
    }
    assert.deepEqual(errors,[]);
    check('Photographic cockpit renders on mobile with all three camera controls');
    await page.setViewportSize({width:1440,height:1000});await frames();await frames();
    await capture('aero-cockpit-desktop');
    for(const [name,id] of [['Sykkelkamera','bike'],['Utsiktskamera','scenic'],['Armer og styre','cockpit']]){
      await click(page.getByRole('button',{name,exact:true}));await frames();
      assert.equal(await scene().getAttribute('data-camera'),id);
    }
    await pause();const paused=(await state()).session;await advance(15);await frames();
    assert.equal((await state()).session.elapsed,paused.elapsed);
    assert.equal((await state()).session.distanceKm,paused.distanceKm);
    check('All camera modes switch on desktop and pause retains exact session state');
    assert.deepEqual(errors,[]);
    await Promise.all(['failure.json','failure.png'].map(name=>rm(resolve(out,name),{force:true})));
    await writeFile(resolve(out,'mobile-report.json'),JSON.stringify({ok:true,checks,errors},null,2));
  }else{
  let s=await distanceMatches();
  assert.equal(s.session.world,'vestland');
  assert.equal(s.session.workout,'60 min utholdenhet');
  assert.equal(s.session.expedition,null);
  assert.equal(Number(await scene().getAttribute('data-sector')),0);
  await capture('fjord-desktop');
  check('Long endurance demo starts in Fjordkanten with normal interval timing and classic scoring');
  const beforeSkip=(await state()).session;
  await click(page.getByRole('button',{name:'Jeg er ferdig oppvarmet',exact:true}));
  const afterSkip=(await state()).session;
  assert.equal(afterSkip.distanceKm,beforeSkip.distanceKm);
  assert.equal(afterSkip.elapsed,beforeSkip.elapsed);
  check('Skipping warmup advances the workout without teleporting along the road');
  await advance(25);s=await distanceMatches();
  assert.ok(s.session.distanceKm>.1);
  await pause();await frames();const stopped=(await state()).session;
  const stoppedVisual=await scene().getAttribute('data-visual-distance');
  await advance(100);await frames();
  assert.equal((await state()).session.distanceKm,stopped.distanceKm);
  assert.equal((await state()).session.elapsed,stopped.elapsed);
  assert.ok(Math.abs(Number(await scene().getAttribute('data-distance'))-stopped.distanceKm*1000)<.2);
  assert.equal(await scene().getAttribute('data-visual-distance'),stoppedVisual);
  check('Pause exactly freezes visual position, workout time and authoritative route distance');
  await resume();
  await click(page.getByRole('button',{name:'Utsiktskamera',exact:true}));
  await frames();assert.equal(await scene().getAttribute('data-camera'),'scenic');
  await capture('fjord-scenic');
  await click(page.getByRole('button',{name:'Sykkelkamera',exact:true}));
  await frames();assert.equal(await scene().getAttribute('data-camera'),'bike');
  await click(page.getByRole('button',{name:'Armer og styre',exact:true}));
  await frames();assert.equal(await scene().getAttribute('data-camera'),'cockpit');
  assert.equal(await page.getByRole('button',{name:'Armer og styre',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal((await state()).session.workout,'60 min utholdenhet');
  await capture('fjord-cockpit-desktop');
  check('Road, scenic and arms-and-handlebar cameras switch without altering the interval plan');
  const renderStats={triangles:Number(await scene().getAttribute('data-triangles')),drawCalls:Number(await scene().getAttribute('data-draw-calls')),sceneChunks:Number(await scene().getAttribute('data-scene-chunks'))};
  assert.ok(renderStats.triangles>0&&renderStats.drawCalls>0&&renderStats.sceneChunks>1);
  console.log('Scene render counters',renderStats);
  check('Spatially partitioned scenery exposes active renderer and chunk counters');
  await rideTo(3.3);s=await distanceMatches();
  assert.equal(Number(await scene().getAttribute('data-sector')),1);
  await capture('birch-desktop');
  check('Distance, rather than elapsed scene animation, carries the rider into Bjørkelia');
  await rideTo(6.2);await distanceMatches();
  assert.equal(Number(await scene().getAttribute('data-sector')),2);
  await capture('village-desktop');
  await pause();const checkpoint=(await state()).session;
  await page.reload();await page.locator('.pause-overlay').waitFor();
  await scene().locator('.real-world-caption').waitFor();
  s=await distanceMatches();
  assert.equal(s.mode,'paused');assert.equal(s.session.distanceKm,checkpoint.distanceKm);
  assert.equal(s.session.elapsed,checkpoint.elapsed);assert.equal(s.session.world,'vestland');
  assert.equal(Number(await scene().getAttribute('data-sector')),2);
  assert.equal(await scene().getAttribute('data-camera'),'cockpit');
  check('Cockpit camera, Bygda and exact ride distance survive reload with the session paused');
  await page.setViewportSize({width:390,height:844});await resume();await capture('village-cockpit-mobile');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const name of ['Pause','Neste segment','Avslutt økt','Sykkelkamera','Utsiktskamera','Armer og styre']){
    const box=await page.getByRole('button',{name,exact:true}).boundingBox();
    assert.ok(box&&box.height>=44&&box.x>=0&&box.x+box.width<=390,`${name} accessible at 390px`);
  }
  const canvas=await scene().locator('canvas').boundingBox();assert.ok(canvas&&canvas.width>300&&canvas.height>200);
  check('390px cockpit view retains the canvas and all three 44px camera controls without horizontal overflow');
  await page.setViewportSize({width:1440,height:1000});
  await rideTo(8.5);await distanceMatches();assert.equal(Number(await scene().getAttribute('data-sector')),0);
  await capture('second-lap');check('The 8.4 km loop wraps to Fjordkanten while total ride distance keeps increasing');
  await pause();const final=(await state()).session;
  await click(page.getByRole('button',{name:'Avslutt økt',exact:true}));
  await click(page.getByRole('button',{name:'Lagre og avslutt',exact:true}));
  await page.locator('.session-analysis').waitFor();
  assert.equal(records.length,1);assert.equal(records[0].worldId,'vestland');assert.equal(records[0].demo,true);
  assert.equal(records[0].seconds,final.elapsed);assert.equal(records[0].distance,final.distanceKm);
  assert.ok(records[0].samples.length>1000);assert.equal(records[0].distanceMeasured,false);
  assert.equal(records[0].expedition,undefined);
  await capture('analysis');check('Summary saves world identity, samples and exact ride totals to an isolated API mock');
  assert.deepEqual(errors,[]);
  await Promise.all(['failure.json','failure.png'].map(name=>rm(resolve(out,name),{force:true})));
  await writeFile(resolve(out,'report.json'),JSON.stringify({ok:true,checks,errors,last:await state()},null,2));
  }
} catch(error) {
  if(page){await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),errors,state:await state().catch(()=>null)},null,2));}
  throw error;
} finally {
  await browser?.close();await vite?.close();
}
