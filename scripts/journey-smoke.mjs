import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out='output/journey';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1360,height:900}});page.setDefaultTimeout(60000);
await page.clock.install({time:new Date('2026-10-04T12:00:00Z')});
await page.clock.pauseAt(new Date('2026-10-04T12:00:01Z'));
const records=[],errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;let data={};if(p==='/api/rides'){if(r.request().method()==='POST'){data=r.request().postDataJSON();records.push(data)}else data=records}else if(p==='/api/profile')data={ftp:250,updatedAt:null};else if(p==='/api/health')data={ok:true,storage:'sqlite',rides:records.length};else if(p==='/api/ant/status')data={status:'disconnected',error:null};return r.fulfill({json:data})});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const click=locator=>locator.evaluate(el=>el.click());
const pause=async()=>{if((await state()).mode==='riding')await click(page.getByRole('button',{name:'Pause',exact:true}))};
const resume=async()=>{if((await state()).mode==='paused')await click(page.getByRole('button',{name:'Fortsett økten',exact:true}))};
const advance=seconds=>page.evaluate(s=>window.advanceTime(s*1000),seconds);
const frames=()=>page.clock.runFor(80);
const check=name=>{checks.push(name);console.log('PASS '+name)};
async function capture(name){await frames();await page.screenshot({path:`${out}/${name}.png`})}
async function gate(){await page.evaluate(()=>{for(let n=0;n<45;n++){if(JSON.parse(window.render_game_to_text()).session.expedition.choiceOpen)return;window.advanceTime(1000)}throw Error('No earned gate')});await pause();assert.equal((await state()).session.expedition.choiceOpen,true)}
async function choose(route){await page.keyboard.press(route==='restore'?'1':'2');assert.equal((await state()).session.expedition.route,route);await resume()}
try{
 await page.goto(process.env.SUMMIT_UI_URL||'http://127.0.0.1:3001/');await page.waitForFunction(()=>!!window.render_game_to_text);
 await click(page.locator('.world-option').filter({hasText:'TRON / The Grid'}));await page.locator('.journey-board').waitFor();
 assert.ok((await page.locator('.journey-board').innerText()).includes('Den tause byen'));await page.locator('.journey-board').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/launcher.png`});
 await click(page.locator('.quick-duration button').filter({hasText:'4 × 10 min'}));await click(page.locator('.demo-start'));await page.locator('.ride-view canvas').waitFor();await click(page.getByRole('button',{name:'Jeg er ferdig oppvarmet'}));
 assert.equal((await state()).session.expedition.completed,0);check('Tron starts a three-stage chapter; skipping warmup earns no destinations');
 await advance(11);assert.equal((await state()).journey.variant,'bridge');await capture('bridge');
 await gate();const one=await state();assert.equal(one.journey.completed,1);assert.equal(one.journey.step,2);assert.equal(await page.locator('.tron-world').getAttribute('data-journey-variant'),'bridge');
 const paused=one.session.expedition;await advance(60);assert.deepEqual((await state()).session.expedition,paused);check('Earned place stays visible at route choice; pause freezes choices and progress');
 await choose('explore');assert.equal((await state()).journey.variant,'garden');await advance(14);await capture('garden');
 await gate();assert.equal((await state()).journey.step,3);assert.ok((await page.locator('.journey-choice').innerText()).includes('Bevar frøene'));
 await choose('explore');assert.equal((await state()).journey.variant,'vault');await advance(14);await capture('vault');
 await gate();let s=await state();assert.equal(s.journey.chapter,2);assert.equal(s.journey.log.at(-1).name,'Arkivet · frøsamlingen');check('Bridge → garden → seed vault produces the selected chapter finale');
 await choose('restore');await gate();await choose('restore');assert.equal((await state()).journey.variant,'beacon');await advance(12);await capture('beacon');check('All four physical destinations render through normal mission choices');
 await pause();const before=await state();await page.reload();await page.locator('.pause-overlay').waitFor();const after=await state();assert.equal(after.mode,'paused');assert.deepEqual(after.journey,before.journey);assert.deepEqual(after.session.expedition,before.session.expedition);check('Reload restores paused exact route history, destination and partial charge');
 await page.setViewportSize({width:390,height:844});await resume();await frames();await page.screenshot({path:`${out}/mobile.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const hud=await page.locator('.journey-hud').boundingBox();assert.ok(hud.height<95,`Compact HUD ${hud.height}px`);for(const name of ['Pause','Neste segment','Avslutt økt']){const box=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box&&box.height>=44&&box.x>=0&&box.x+box.width<=390)}check('390px compact HUD and44px ride controls retain viewport space');
 await resume();await gate();await resume();await frames();await page.screenshot({path:`${out}/mobile-choice.png`});await pause();await choose('restore');await pause();
 await click(page.getByRole('button',{name:'Avslutt økt',exact:true}));await click(page.getByRole('button',{name:'Lagre og avslutt',exact:true}));await page.locator('.session-analysis').waitFor();
 assert.equal(await page.locator('.summary-game-details').getAttribute('open'),null);assert.equal(records.length,1);assert.equal(records[0].demo,true);await click(page.locator('.summary-game-details>summary'));await page.locator('.journey-receipt').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/receipt.png`});assert.ok((await page.locator('.journey-receipt').innerText()).includes('lagrede reisen er uendret'));check('Route receipt follows training analysis and explicitly keeps demo progress temporary');
 assert.deepEqual(errors,[]);await writeFile(`${out}/report.json`,JSON.stringify({ok:true,checks,errors,last:await state()},null,2));
}catch(error){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),errors,state:await state().catch(()=>null)},null,2));throw error}finally{await browser.close()}
