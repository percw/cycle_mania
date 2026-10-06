import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=JSON.parse(await readFile('evaluation-v2/report.json','utf8'));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5192/report.html');assert.equal(await page.locator('article').count(),20);assert.equal(data.summary.n_scenarios,20);
 await page.locator('#search').fill('Konkurransesyklisten');assert.equal(await page.locator('article:visible').count(),1);await page.locator('#search').fill('');
 await page.locator('#return').selectOption('yes');assert.equal(await page.locator('article:visible').count(),data.summary.return_intentions.yes??0);await page.locator('#return').selectOption('all');
 await mkdir('output/evaluation-v2',{recursive:true});await page.screenshot({path:'output/evaluation-v2/report-desktop.png',fullPage:false});
 if(await page.locator('article details').count()){await page.locator('article details summary').first().click();assert.ok(await page.locator('article details[open]').count())}
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'output/evaluation-v2/report-mobile.png',fullPage:false});assert.deepEqual(errors,[]);
 await writeFile('evaluation-v2/report-check.json',JSON.stringify({ok:true,checks:['20valid scenarios','all20cards displayed','persona search','return filter exact count','detail expansion','390px no horizontal overflow','zero browser errors'],errors},null,2));
}finally{await browser.close()}
