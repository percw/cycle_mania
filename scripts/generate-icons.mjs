/**
 * Renders public/favicon.svg into the PNG app icons used by the PWA manifest
 * and iOS. Run after changing the logo: node scripts/generate-icons.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
const svg = await readFile(resolve(root, 'public/favicon.svg'), 'utf8');
const background = '#0c0f14';
// purpose "any" keeps the rounded logo; maskable/apple icons fill the square and
// keep the mountain inside the 80 % safe zone that launchers may crop to.
const icons = [
  { file: 'icon-192.png', size: 192, padding: 0, fill: false },
  { file: 'icon-512.png', size: 512, padding: 0, fill: false },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.12, fill: true },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.06, fill: true },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const icon of icons) {
    const dataUrl = await page.evaluate(async ({ svg, size, padding, fill, background }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (fill) { context.fillStyle = background; context.fillRect(0, 0, size, size); }
      const inner = size * (1 - 2 * padding);
      context.drawImage(image, size * padding, size * padding, inner, inner);
      return canvas.toDataURL('image/png');
    }, { svg, ...icon, background });
    await writeFile(resolve(out, icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`public/icons/${icon.file} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
