// Discard a ride without saving, and delete a saved ride from its report. API is mocked in memory.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let records = []; const deletes = [];
await context.route('**/api/**', async route => {
  const req = route.request(); const p = new URL(req.url()).pathname; let body = {};
  if (p === '/api/health') body = { ok: true, storage: 'sqlite', rides: records.length };
  else if (p === '/api/profile') body = { ftp: 250, updatedAt: null };
  else if (p === '/api/ant/status') body = { status: 'disconnected' };
  else if (p === '/api/workouts') body = [];
  else if (p === '/api/rides' && req.method() === 'POST') { body = req.postDataJSON(); records.push(body); }
  else if (p === '/api/rides') body = records;
  else if (p.startsWith('/api/rides/') && req.method() === 'DELETE') { const id = decodeURIComponent(p.split('/').pop()); deletes.push(id); const had = records.some(r => r.id === id); records = records.filter(r => r.id !== id); body = { ok: true, deleted: had }; }
  else return route.fulfill({ status: 404, json: {} });
  await route.fulfill({ json: body });
});
const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const click = (name) => page.evaluate(n => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === n || x.getAttribute('aria-label') === n); if (!b) throw new Error('no button ' + n); b.click(); }, name);
await page.goto(process.env.SUMMIT_UI_URL || 'http://127.0.0.1:5186'); await page.waitForFunction(() => !!window.render_game_to_text); await page.waitForTimeout(1200);
// Discard
await click('Ta en demotur'); await page.waitForTimeout(800); await page.evaluate(() => window.advanceTime(30000));
await click('Avslutt økt'); await page.waitForTimeout(300);
await click('Forkast økten uten å lagre'); await page.waitForTimeout(200);
assert.ok(await page.getByText('Økten blir ikke lagret.', { exact: false }).isVisible());
await click('Forkast økten'); await page.waitForTimeout(600);
let s = await state();
assert.equal(s.mode, 'browse'); assert.equal(s.summary, null); assert.equal(records.length, 0);
assert.equal(await page.evaluate(() => localStorage.getItem('summit-active-session')), 'null');
console.log('PASS discard: no ride saved, no checkpoint, back on home');
// Save, then delete from the report
await click('Ta en demotur'); await page.waitForTimeout(800); await page.evaluate(() => window.advanceTime(30000));
await click('Avslutt økt'); await page.waitForTimeout(300); await click('Lagre og avslutt'); await page.waitForTimeout(900);
assert.equal(records.length, 1); const id = records[0].id;
assert.ok(await page.locator('.ride-report').isVisible());
await click('Slett økten'); await page.waitForTimeout(200);
assert.ok(await page.locator('.report-confirm').isVisible());
await page.locator('.report-confirm .report-danger').click(); await page.waitForTimeout(900);
assert.equal(await page.locator('.ride-report').count(), 0);
assert.deepEqual(deletes, [id]); assert.equal(records.length, 0);
s = await state(); assert.equal(s.summary, null);
await page.evaluate(() => [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Min utvikling')).click()); await page.waitForTimeout(500);
assert.equal(await page.locator('.history-list > button').count(), 0);
await page.reload(); await page.waitForFunction(() => !!window.render_game_to_text); await page.waitForTimeout(1500);
await page.evaluate(() => [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Min utvikling')).click()); await page.waitForTimeout(500);
assert.equal(await page.locator('.history-list > button').count(), 0);
console.log('PASS delete: confirm strip, DELETE sent once, gone from history and after reload');
assert.deepEqual(errors, []); console.log('PASS no page errors');
await browser.close();
