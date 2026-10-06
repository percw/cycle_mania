#!/usr/bin/env node
/**
 * Writes static SEO pages into dist/ after `vite build`:
 *   dist/okter/index.html, dist/okter/<id>/index.html (built-in workouts only),
 *   dist/personvern/index.html, dist/sitemap.xml, dist/robots.txt
 * Canonical URLs use SITE_URL (default https://summit-sykkel.vercel.app).
 * The workout data comes straight from src/training.ts.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Node 22.18+ strips TypeScript natively; older Node falls back to Vite's module runner. */
async function load(file) {
  try {
    return await import(pathToFileURL(join(root, file)).href);
  } catch (error) {
    if (!['ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'].includes(error?.code)) throw error;
    const { runnerImport } = await import('vite');
    return (await runnerImport(join(root, file), { configFile: false, logLevel: 'silent' })).module;
  }
}

const { DEFAULT_SITE_URL } = await load('src/site.ts');
const seo = await load('src/seoPages.ts');
const { workouts } = await load('src/training.ts');

const site = (process.env.SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^/\s]+$/.test(site)) throw new Error(`SITE_URL must be an origin like https://example.com, got "${site}"`);
const options = { site, analytics: (process.env.VITE_ANALYTICS || 'vercel') === 'vercel' };

try { await access(join(dist, 'index.html')); } catch { throw new Error('dist/index.html is missing. Run `vite build` first.'); }

async function write(path, content) {
  const file = join(dist, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const list = seo.publicWorkouts(workouts);
const ids = new Set(list.map(w => w.id));
if (ids.size !== list.length) throw new Error('Duplicate workout ids would overwrite each other.');

for (const workout of list) await write(`okter/${workout.id}/index.html`, seo.renderWorkoutPage(workout, list, options));
await write('okter/index.html', seo.renderIndexPage(list, options));
await write('personvern/index.html', seo.renderPrivacyPage(options));
const paths = ['/', '/okter/', ...list.map(seo.workoutPath), '/personvern/'];
await write('sitemap.xml', seo.renderSitemap(site, paths));
await write('robots.txt', seo.renderRobots(site));

// index.html carries absolute social-preview URLs for the default site; point them at SITE_URL.
if (site !== DEFAULT_SITE_URL) {
  const index = join(dist, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replaceAll(DEFAULT_SITE_URL, site));
}

console.log(`build-seo: ${list.length} workout pages, index, privacy, sitemap (${paths.length} URLs) and robots.txt for ${site}`);
