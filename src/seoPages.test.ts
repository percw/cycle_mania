import { describe, expect, it } from 'vitest';
import { workouts, type Workout } from './training';
import { compressBlocks, describeNode, describeOuter, formatBlockDuration, workoutParts } from './workoutStructure';
import {
  ctaHref, profileSvg, publicWorkouts, renderIndexPage, renderPrivacyPage, renderRobots, renderSitemap,
  renderWorkoutPage, workoutDescription, workoutHeading, workoutTitle,
} from './seoPages';

const byId = (id: string) => workouts.find(w => w.id === id)!;
const opts = { site: 'https://summit-sykkel.vercel.app', analytics: false };

describe('workout structure', () => {
  it('formats block durations', () => {
    expect([30, 45, 90, 600, 150, 5400].map(formatBlockDuration)).toEqual(['30 sek', '45 sek', '90 sek', '10 min', '2 min 30 sek', '90 min']);
  });
  it('compresses work/rest repeats', () => {
    const { warmup, main, cooldown } = workoutParts(byId('threshold-4x10'));
    expect(warmup).toHaveLength(2);
    expect(cooldown).toHaveLength(1);
    expect(main).toHaveLength(1);
    expect(describeNode(main[0])).toBe('4 × 10 min på 98 % FTP, 3 min på 50 % mellom');
  });
  it('compresses nested sets', () => {
    const [sets] = workoutParts(byId('micro-30-15-3')).main;
    expect(sets.type).toBe('repeat');
    expect(describeNode(sets)).toBeNull();
    expect(describeOuter(sets as Extract<typeof sets, { type: 'repeat' }>)).toBe('3 ganger, 3 min på 50 % mellom:');
    expect(describeNode((sets as Extract<typeof sets, { type: 'repeat' }>).body[0])).toBe('10 × 30 sek på 120 % FTP, 15 sek på 50 % mellom');
    const [overUnder] = workoutParts(byId('over-under-3x12')).main;
    expect(describeNode((overUnder as Extract<typeof overUnder, { type: 'repeat' }>).body[0])).toBe('4 × (2 min på 95 % FTP + 1 min på 105 % FTP)');
  });
  it('keeps irregular sequences as separate blocks and never loses time', () => {
    expect(workoutParts(byId('threshold-pyramid')).main).toHaveLength(9);
    const seconds = (nodes: ReturnType<typeof compressBlocks>): number => nodes.reduce((sum, n) => sum + (n.type === 'block' ? n.block.seconds
      : n.count * seconds(n.body) + (n.rest ? (n.count - 1) * n.rest.seconds : 0)), 0);
    for (const w of workouts) {
      const parts = workoutParts(w);
      const total = [...parts.warmup, ...parts.cooldown].reduce((s, b) => s + b.seconds, 0) + seconds(parts.main);
      expect(total, w.id).toBe(w.blocks.reduce((s, b) => s + b.seconds, 0));
    }
  });
});

describe('static workout pages', () => {
  it('publishes the 100 built-in workouts only', () => {
    const custom: Workout = { ...byId('vo2-4x4'), id: 'custom-1', custom: true };
    const ramp: Workout = { ...byId('vo2-4x4'), id: 'ramp', ramp: { id: 'standard' } as never };
    expect(publicWorkouts([...workouts, custom, ramp])).toHaveLength(100);
  });
  it('writes Norwegian titles and descriptions', () => {
    expect(workoutTitle(byId('threshold-4x10'))).toBe('4 × 10 min terskel – gratis intervalløkt i nettleseren | SUMMIT');
    expect(workoutHeading(byId('sweetspot-2x20'))).toBe('2 × 20 sweet spot');
    expect(workoutHeading(byId('vo2-4x4'))).toBe('4 × 4 min VO₂ maks');
    expect(workoutHeading(byId('anaerobic-6x1'))).toBe('6 × 1 min kraft (anaerob)');
    expect(workoutTitle(byId('endurance-60'))).toContain('gratis sykkeløkt');
    expect(workoutDescription(byId('threshold-4x10'))).toMatch(/^4 × 10 min terskel: 4 × 10 min på 98 % FTP, 3 min på 50 % mellom\. \d+ min, ca\. \d+ TSS\./);
  });
  it('renders a complete, honest page with a CTA into the app', () => {
    const w = byId('threshold-4x10');
    const html = renderWorkoutPage(w, workouts, opts);
    expect(html).toContain('<link rel="canonical" href="https://summit-sykkel.vercel.app/okter/threshold-4x10/">');
    expect(html).toContain(`href="${ctaHref(w).replace('&', '&amp;')}"`);
    expect(ctaHref(w)).toBe('/?workout=threshold-4x10&ref=okt');
    expect(html).toContain('Sykle økten nå');
    expect(html).toContain('FTMS eller Cycling Power');
    expect(html).not.toMatch(/\bERG\b/);
    expect(html).toContain('<svg viewBox');
    expect(html).not.toContain('_vercel/insights');
    expect(renderWorkoutPage(w, workouts, { ...opts, analytics: true })).toContain('/_vercel/insights/script.js');
  });
  it('loads analytics from the static pages only on real hosts without opt-out signals', () => {
    const html = renderWorkoutPage(byId('vo2-4x4'), workouts, { ...opts, analytics: true });
    const code = html.match(/<script>(\(function\(\)\{try\{var h=location[\s\S]*?)<\/script>/)![1];
    const run = (hostname: string, extra: { optOut?: boolean; gpc?: boolean; dnt?: string; webdriver?: boolean } = {}) => {
      const appended: unknown[] = [];
      const env = {
        location: { hostname },
        navigator: { globalPrivacyControl: extra.gpc ?? false, doNotTrack: extra.dnt ?? null, webdriver: extra.webdriver ?? false },
        localStorage: { getItem: () => extra.optOut ? 'true' : null },
        document: { createElement: () => ({}), head: { appendChild: (el: unknown) => appended.push(el) } },
      };
      new Function('location', 'navigator', 'localStorage', 'document', code)(env.location, env.navigator, env.localStorage, env.document);
      return appended.length;
    };
    expect(run('summit-sykkel.vercel.app')).toBe(1);
    expect(run('x.locale.no')).toBe(1);
    for (const host of ['localhost', '127.0.0.1', '192.168.0.4', '10.1.2.3', '172.16.0.1', 'pc.local', '[::1]', ''])
      expect(run(host), host).toBe(0);
    expect(run('summit-sykkel.vercel.app', { optOut: true })).toBe(0);
    expect(run('summit-sykkel.vercel.app', { gpc: true })).toBe(0);
    expect(run('summit-sykkel.vercel.app', { dnt: '1' })).toBe(0);
    expect(run('summit-sykkel.vercel.app', { webdriver: true })).toBe(0);
  });
  it('escapes text and colours the profile by zone', () => {
    const evil: Workout = { ...byId('vo2-4x4'), name: '<b>x</b>', description: '"&' };
    const html = renderWorkoutPage(evil, workouts, opts);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(profileSvg(byId('vo2-4x4'))).toContain('#ff9866');
  });
  it('renders the index, privacy page, sitemap and robots', () => {
    const list = publicWorkouts(workouts);
    const index = renderIndexPage(list, opts);
    expect((index.match(/class="card"/g) ?? []).length).toBe(100);
    expect(index).toContain('id="vo2-maks"');
    expect(renderPrivacyPage(opts)).toContain('Personvern');
    const sitemap = renderSitemap('https://example.no/', ['/', '/okter/']);
    expect(sitemap).toContain('<loc>https://example.no/okter/</loc>');
    expect(renderRobots('https://example.no')).toContain('Sitemap: https://example.no/sitemap.xml');
  });
});
