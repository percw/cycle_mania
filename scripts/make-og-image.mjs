#!/usr/bin/env node
/**
 * Regenerates public/og.jpg (1200×630 social preview) from docs/screenshots/hero-vestland.jpg:
 * the ride cockpit, a quiet ink gradient, the SUMMIT wordmark and one line of copy.
 * Run manually when the hero screenshot changes: node scripts/make-og-image.mjs
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hero = (await readFile(join(root, 'docs/screenshots/hero-vestland.jpg'))).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=DM+Sans:wght@500;700&display=block">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0c0f14}
.frame{position:relative;width:1200px;height:630px}
img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 100%}
.shade{position:absolute;inset:0;background:
  linear-gradient(180deg,rgba(12,15,20,.88) 0%,rgba(12,15,20,.6) 30%,rgba(12,15,20,.1) 50%,rgba(12,15,20,0) 58%),
  linear-gradient(90deg,rgba(12,15,20,.55) 0%,rgba(12,15,20,0) 55%)}
.copy{position:absolute;left:64px;top:52px;right:64px;color:#f2eee8}
.brand{display:flex;align-items:center;gap:16px;font:700 40px "DM Sans";letter-spacing:10px}
.brand svg{width:54px;height:44px;color:#f48468}
h1{margin:22px 0 0;font:600 64px/1 "Barlow Condensed";letter-spacing:.005em;max-width:900px}
</style></head><body><div class="frame">
<img src="data:image/jpeg;base64,${hero}" alt="">
<div class="shade"></div>
<div class="copy">
  <div class="brand"><svg viewBox="0 0 42 34" fill="none"><path d="M2 30 17 4l8 14 5-9 11 21H2Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m11 15 6 5 5-5" stroke="currentColor" stroke-width="2"/></svg>SUMMIT</div>
  <h1>Intervalltrening på sykkel,<br>rett i nettleseren</h1>
</div></div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'public/og.jpg'), type: 'jpeg', quality: 86 });
  console.log('Wrote public/og.jpg');
} finally {
  await browser.close();
}
