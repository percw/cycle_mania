import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const seed=(id,worldId,restored,discovered)=>({id,name:'Tidligere ekspedisjon',workoutId:'recovery-10',worldId,date:'2026-01-01T12:00:00Z',seconds:2000,distance:12,avgPower:125,energy:250,zoneSeconds:[2000,0,0,0,0,0,0],completed:true,demo:false,ftp:250,expedition:{version:1,restored,discovered,completed:restored+discovered,choices:[],discoveries:Array.from({length:discovered},(_,i)=>`Testfunn ${i}`)}});
const records=[seed('fixture-neon','neon',4,3),seed('fixture-sky','sky',15,4)];
const checks=[],errors=[];
await context.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body={};if(path==='/api/health')body={ok:true,storage:'sqlite',rides:records.length};else if(path==='/api/rides'){if(route.request().method()==='POST'){body=route.request().postDataJSON();records.push(body);}else body=records;}else if(path==='/api/profile')body={ftp:250,updatedAt:null};else if(path==='/api/ant/status')body={status:'disconnected',power:null,heartRate:null,error:null};return route.fulfill({json:body})});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const advance=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
const check=name=>{checks.push(name);console.log('PASS '+name)};
async function start(){await page.locator('.demo-start').click();await page.locator('.ride-view canvas').waitFor();await page.waitForTimeout(1200);}
async function arriveAtChoice(){let s=await state();if(!s.session.expedition.choiceOpen){const e=s.session.expedition;await advance(Math.max(100,((1-e.charge)*e.targetSeconds+.3)*1000));}assert.equal((await state()).session.expedition.choiceOpen,true);}
await mkdir('output/expedition',{recursive:true});
try{
 await page.goto(process.env.SUMMIT_UI_URL||'http://127.0.0.1:3001');await page.waitForFunction(()=>!!window.render_game_to_text);await page.waitForTimeout(1200);
 // History now loads asynchronously (IndexedDB, then the local API); wait for the saved campaign instead of a fixed delay.
 await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).campaign.restored===4,null,{timeout:15000});
 assert.ok(await page.locator('.featured').getByText('10 min lett tråkk',{exact:true}).isVisible());assert.equal((await state()).campaign.restored,4);
 await page.screenshot({path:'output/expedition/launcher.png',fullPage:true});check('20-minute easy first choice, selectable missions and real saved campaign loaded');
 await start();let s=await state();assert.equal(s.session.expedition.worldRestored,4);await arriveAtChoice();
 s=await state();assert.equal(s.session.expedition.restored,1);assert.equal(s.session.expedition.worldRestored,5);assert.equal(s.session.expedition.completed,1);
 assert.ok((await page.locator('.expedition-choices').innerText()).includes('Ekkomodulen'));
 await page.getByRole('button',{name:'Pause',exact:true}).focus();await page.keyboard.press('2');assert.equal((await state()).session.expedition.route,'explore');assert.equal((await state()).session.expedition.branch,1);
 await page.waitForTimeout(900);await page.screenshot({path:'output/expedition/neon-fork.png',fullPage:true});check('first gate restores next campaign landmark; exploration choice changes branch and mission');
 await arriveAtChoice();s=await state();assert.equal(s.session.expedition.discovered,1);assert.equal(s.session.expedition.worldDiscovered,4);assert.ok(s.session.expedition.discoveries[0].includes('Ekkomodulen'));
 await page.getByRole('button',{name:'Pause',exact:true}).click();const paused=(await state()).session.expedition;await advance(30000);assert.deepEqual((await state()).session.expedition,paused);
 await page.getByRole('button',{name:'Fortsett økten',exact:true}).click();await advance(13000);assert.equal((await state()).session.expedition.choiceOpen,false);assert.equal((await state()).session.expedition.route,'explore');check('exploration earns correct relic; pause freezes mission and default route continues without interaction');
 await page.getByRole('button',{name:'Pause',exact:true}).click();const beforeSkip=(await state()).session.expedition.completed;await page.keyboard.press('Escape');
 // Warmup skip remains available while paused behind overlay via ordinary resume first.
 await page.getByRole('button',{name:'Fortsett økten',exact:true}).click();await page.getByRole('button',{name:'Jeg er ferdig oppvarmet'}).click();assert.equal((await state()).session.expedition.completed,beforeSkip);
 await page.getByRole('button',{name:'Avslutt økt',exact:true}).click();await page.getByRole('button',{name:'Lagre og avslutt'}).click();await page.waitForTimeout(200);
 const saved=records.find(x=>!x.id.startsWith('fixture'));assert.ok(saved.expedition.restored>=1&&saved.expedition.discovered>=1);assert.ok(saved.expedition.choices.length>=3);assert.equal(saved.demo,true);assert.equal(await page.getByRole('button',{name:'Last ned FIT-fil'}).isDisabled(),true);
 await page.screenshot({path:'output/expedition/result.png',fullPage:true});await page.getByRole('button',{name:'Lukk',exact:true}).click();assert.equal((await state()).campaign.restored,4);assert.equal((await state()).campaign.discovered,3);check('skip gives no mission credit; summary stores choices and loot; demo cannot change real campaign or export FIT');
 await page.locator('.world-option').filter({hasText:'Skybound'}).click();await page.locator('.campaign-plan button').filter({hasText:'Utforsk'}).click();await start();s=await state();assert.equal(s.session.expedition.route,'explore');assert.equal(s.session.expedition.worldRestored,15);assert.equal(s.session.expedition.worldDiscovered,4);
 await advance(20000);await page.waitForTimeout(900);await page.screenshot({path:'output/expedition/sky-fork.png',fullPage:true});check('Skybound loads persisted temples and relics with selected physical exploration path');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const box=await page.getByRole('button',{name:'Avslutt økt',exact:true}).boundingBox();assert.ok(box.height>=44&&box.y+box.height<=844);await page.screenshot({path:'output/expedition/mobile.png',fullPage:true});check('compact390px HUD keeps end-workout44px button in viewport and leaves scene visible');
 await page.getByRole('button',{name:'Pause',exact:true}).click();const before=(await state()).session.expedition;await page.reload();await page.waitForFunction(()=>!!window.render_game_to_text);s=await state();assert.equal(s.mode,'paused');assert.deepEqual(s.session.expedition,before);check('reload retains paused expedition, choice history, route and persistent world totals');
 assert.deepEqual(errors,[]);check('no browser exceptions or console errors');await writeFile('output/expedition/report.json',JSON.stringify({ok:true,checks,errors},null,2));
}catch(error){console.error(error);console.error(await state().catch(()=>null));await page.screenshot({path:'output/expedition/failure.png',fullPage:true}).catch(()=>{});throw error}finally{await browser.close()}
