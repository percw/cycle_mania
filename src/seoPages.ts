/**
 * Static, crawlable pages for the built-in workouts (/okter/ and /okter/<id>/), the privacy
 * note (/personvern/), sitemap.xml and robots.txt. Plain HTML + inline CSS, no React.
 * Rendered by scripts/build-seo.mjs after `vite build`; pure functions so Vitest can check them.
 * Imports use explicit .ts extensions so Node can load this file directly.
 */
import { getZone, workoutDuration, workoutTss, type Workout, type WorkoutBlock } from './training.ts';
import { describeBlock, describeNode, describeOuter, mainTarget, workoutParts, type StructureNode } from './workoutStructure.ts';
import { privacyLead, privacyOptOutLabel, privacySections, privacyTitle } from './privacyCopy.ts';

export interface SeoOptions { site: string; analytics: boolean }

export const categoryInfo: Record<string, { slug: string; keyword: string; noun: string; intro: string; who: string }> = {
  'Restitusjon': { slug: 'restitusjon', keyword: 'restitusjon', noun: 'sykkeløkt', intro: 'Svært rolige økter som holder beina i gang uten å bygge tretthet.', who: 'Dagen etter en hard økt, eller når kroppen trenger bevegelse uten belastning. Passer alle nivåer.' },
  'Utholdenhet': { slug: 'utholdenhet', keyword: 'utholdenhet', noun: 'sykkeløkt', intro: 'Jevn sykling i sone 2, grunnmuren i utholdenhetstrening.', who: 'Alle som vil bygge utholdenhet. Fin som første økt på en ny sykkel eller trainer, og som rolig volum mellom harde dager.' },
  'Tempo': { slug: 'tempo', keyword: 'tempo', noun: 'intervalløkt', intro: 'Stødige drag mellom rolig langkjøring og terskel.', who: 'Syklister som vil tåle lengre perioder med jevnt trykk, for eksempel før turritt eller lange turer.' },
  'Sweet spot': { slug: 'sweet-spot', keyword: 'sweet spot', noun: 'intervalløkt', intro: 'Drag like under terskel: mye trening for tiden du bruker.', who: 'Deg som har begrenset tid og vil heve terskelen. Krever litt erfaring med å holde jevn effekt.' },
  'Terskel': { slug: 'terskel', keyword: 'terskel', noun: 'intervalløkt', intro: 'Drag rundt FTP, effekten du omtrent kan holde i en time.', who: 'Syklister med noen uker jevn trening i beina som vil heve terskeleffekten (FTP). Legg den på en dag du er uthvilt.' },
  'VO₂ maks': { slug: 'vo2-maks', keyword: 'VO₂ maks', noun: 'intervalløkt', intro: 'Harde drag over terskel som trener det maksimale oksygenopptaket.', who: 'Erfarne syklister som vil heve toppen. Krevende: legg den på en uthvilt dag.' },
  'Anaerob': { slug: 'anaerob', keyword: 'anaerob', noun: 'intervalløkt', intro: 'Korte, harde drag for rykk, bakker og avslutninger.', who: 'Erfarne syklister som trenger kraft til rykk og korte bakker. Effekten er et veiledende startpunkt; tilpass etter egen kapasitet.' },
  'Sprint': { slug: 'sprint', keyword: 'sprint', noun: 'intervalløkt', intro: 'Korte akselerasjoner med lang pause.', who: 'Deg som vil bli raskere i spurten. Kort, men krever god oppvarming og full hvile mellom dragene.' },
};
const categoryOrder = ['Restitusjon', 'Utholdenhet', 'Tempo', 'Sweet spot', 'Terskel', 'VO₂ maks', 'Anaerob', 'Sprint'];
const difficultyLabel = { 1: 'Rolig', 2: 'Middels krevende', 3: 'Hard' } as const;
const COMPAT = 'Fungerer med Bluetooth-sykler og -trainere som sender watt (FTMS eller Cycling Power) i Chrome og Edge.';

/** Only curated, built-in workouts get public pages (never custom or FTP tests). */
export function publicWorkouts(all: Workout[]): Workout[] {
  return all.filter(w => !w.custom && !w.ramp && /^[a-z0-9-]+$/.test(w.id));
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
const e = escapeHtml;
/** Escaped text for Barlow headings (no ₂ glyph there) and prose that must not break after "og -". */
const display = (text: string) => e(text).replace(/₂/g, '<sub>2</sub>');
const prose = (text: string) => e(text).replace(/ -(trainere?)/g, ' <span class="nw">-$1</span>');
const trimSlash = (url: string) => url.replace(/\/+$/, '');
export const workoutPath = (w: Pick<Workout, 'id'>) => `/okter/${w.id}/`;
export const ctaHref = (w: Pick<Workout, 'id'>) => `/?workout=${encodeURIComponent(w.id)}&ref=okt`;

/** "4 × 10 min terskel", "30 min sweet spot", "6 × 1 min kraft (anaerob)". */
export function workoutHeading(w: Pick<Workout, 'name' | 'category'>): string {
  const keyword = categoryInfo[w.category]?.keyword ?? w.category.toLowerCase();
  if (w.name.toLowerCase().includes(keyword.toLowerCase())) return w.name;
  return /(\d|min|sek)$/.test(w.name) ? `${w.name} ${keyword}` : `${w.name} (${keyword})`;
}

export function workoutTitle(w: Workout): string {
  return `${workoutHeading(w)} – gratis ${categoryInfo[w.category]?.noun ?? 'sykkeløkt'} i nettleseren | SUMMIT`;
}

const totalMinutes = (w: Workout) => Math.round(workoutDuration(w) / 60);

export function workoutDescription(w: Workout): string {
  const { main } = workoutParts(w);
  const line = main.length === 1 ? describeNode(main[0]) : null;
  const core = line ? `${line}.` : w.description;
  return `${workoutHeading(w)}: ${core} ${totalMinutes(w)} min, ca. ${workoutTss(w)} TSS. Gratis i nettleseren med Bluetooth-sykkel eller -trainer, uten konto.`;
}

/** Zone-coloured profile of the planned targets. */
export function profileSvg(w: Workout, opts: { width?: number; height?: number; axis?: boolean; id?: string } = {}): string {
  const width = opts.width ?? 1000, plot = opts.height ?? 200, axis = opts.axis ?? true;
  const total = workoutDuration(w) || 1;
  const scale = Math.max(1.3, ...w.blocks.map(b => b.intensity)) * 1.08;
  const round = (n: number) => Math.round(n * 10) / 10;
  let t = 0;
  const rects = w.blocks.map(b => {
    const x = round((t / total) * width), wd = Math.max(0.6, round((b.seconds / total) * width)), h = round((b.intensity / scale) * plot);
    t += b.seconds;
    return `<rect x="${x}" y="${round(plot - h)}" width="${wd}" height="${h}" fill="${getZone(b.intensity, 1).color}"/>`;
  }).join('');
  if (!axis) return `<svg viewBox="0 0 ${width} ${plot}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${rects}</svg>`;
  const ftpY = round(plot - plot / scale);
  const step = total > 5400 ? 1800 : total > 2700 ? 900 : 600;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step)
    .map(s => `<text x="${round((s / total) * width)}" y="${plot + 24}" text-anchor="${s === 0 ? 'start' : 'middle'}">${s / 60} min</text>`).join('');
  const titleId = `${opts.id ?? 'profil'}-tittel`;
  return `<svg viewBox="0 -6 ${width} ${plot + 36}" role="img" aria-labelledby="${titleId}"><title id="${titleId}">Profil for ${e(workoutHeading(w))}: wattmål i prosent av FTP gjennom ${totalMinutes(w)} minutter</title>${rects}<line x1="0" x2="${width}" y1="${ftpY}" y2="${ftpY}" class="ftp"/><text x="${width}" y="${ftpY - 8}" text-anchor="end" class="ftp-label">100 % FTP</text><line x1="0" x2="${width}" y1="${plot}" y2="${plot}" class="base"/>${ticks}</svg>`;
}

const dot = (block: WorkoutBlock) => `<i class="dot" style="background:${getZone(block.intensity, 1).color}"></i>`;
const firstBlock = (node: StructureNode): WorkoutBlock => node.type === 'block' ? node.block : firstBlock(node.body.find(n => n.type !== 'block' || n.block.kind === 'work') ?? node.body[0]);

function nodeHtml(node: StructureNode): string {
  const line = describeNode(node);
  if (line) return `<li>${dot(firstBlock(node))}<span>${e(line)}</span></li>`;
  const repeat = node as Extract<StructureNode, { type: 'repeat' }>;
  return `<li>${dot(firstBlock(node))}<span>${e(describeOuter(repeat))}</span><ul>${repeat.body.map(nodeHtml).join('')}</ul></li>`;
}

export function structureHtml(w: Workout): string {
  const { warmup, main, cooldown } = workoutParts(w);
  const phase = (label: string, blocks: WorkoutBlock[]) => blocks.length ? `<li class="phase"><b>${label}</b><ul>${blocks.map(b => `<li>${dot(b)}<span>${e(describeBlock(b))}</span></li>`).join('')}</ul></li>` : '';
  return `<ol class="structure">${phase('Oppvarming', warmup)}<li class="phase"><b>Hoveddel</b><ul>${main.map(nodeHtml).join('')}</ul></li>${phase('Nedkjøring', cooldown)}</ol>`;
}

const logo = `<svg viewBox="0 0 42 34" fill="none" aria-hidden="true" width="30" height="24"><path d="M2 30 17 4l8 14 5-9 11 21H2Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m11 15 6 5 5-5" stroke="currentColor" stroke-width="2"/></svg>`;

/** Loads Vercel Web Analytics on real hosts only, honouring opt-out, GPC and Do Not Track (same rules as src/telemetry.ts). */
const analyticsSnippet = `<script>(function(){try{var h=location.hostname,n=navigator;if(!h||/^(localhost|.*\\.localhost|.*\\.local|0\\.0\\.0\\.0|\\[?::1\\]?)$|^(127|10|192\\.168|172\\.(1[6-9]|2\\d|3[01]))\\.\\d/.test(h)||localStorage.getItem('summit-telemetry-off')==='true'||n.globalPrivacyControl===true||n.doNotTrack==='1'||n.webdriver)return;var s=document.createElement('script');s.defer=true;s.src='/_vercel/insights/script.js';document.head.appendChild(s)}catch(_){}})();</script>`;

const css = `:root{--bg:#0c0f14;--panel:#151a22;--panel-2:#1b212b;--line:#262e3b;--text:#f2eee8;--text-2:#b8bec8;--muted:#8d95a2;--accent:#f48468;--accent-ink:#1e100c;--good:#6ed3a6;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font:400 16px/1.65 "DM Sans",system-ui,sans-serif}
a{color:inherit}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0;border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:4px;text-decoration:none;font-size:18px}.brand svg{color:var(--accent)}
.top nav{display:flex;gap:18px;align-items:center;font-size:14px}.top nav a{color:var(--text-2);text-decoration:none}.top nav a:hover{color:var(--text)}
main{padding:28px 0 40px}.crumbs{font-size:13px;color:var(--muted)}.crumbs a{color:var(--text-2)}
.eyebrow{margin:18px 0 0;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{margin:6px 0 0;font:600 clamp(40px,8vw,68px)/1 "Barlow Condensed",sans-serif;letter-spacing:.005em}
h2{margin:0 0 10px;font:600 28px/1.1 "Barlow Condensed",sans-serif;letter-spacing:.01em}
.lead{margin:14px 0 0;font-size:18px;color:var(--text-2);max-width:640px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);margin:24px 0 0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--panel)}
.facts div{padding:14px 18px;border-right:1px solid var(--line)}.facts div:last-child{border-right:0}
.facts dt{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.facts dd{margin:4px 0 0;font:600 30px/1.1 "Barlow Condensed",sans-serif}
.profile{margin:22px 0 0;padding:18px 18px 10px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
.profile svg{display:block;width:100%;height:auto}.profile text{fill:var(--muted);font:12px "DM Sans",sans-serif}.profile .ftp{stroke:rgba(242,238,232,.35);stroke-dasharray:4 6}.profile .ftp-label{fill:var(--text-2)}.profile .base{stroke:var(--line)}
.profile figcaption{margin-top:6px;font-size:13px;color:var(--muted)}
.cta-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:26px 0 0}
.cta{display:inline-flex;align-items:center;gap:10px;min-height:54px;padding:0 26px;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:650;font-size:17px;text-decoration:none}
.cta:hover{background:#f69a83}.cta-note{margin:0;font-size:14px;color:var(--muted)}
section{margin-top:34px}section p{margin:0;color:var(--text-2);max-width:680px}section p+p{margin-top:10px}
.structure{list-style:none;padding:0;margin:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.structure>li{padding:14px 18px;border-top:1px solid var(--line)}.structure>li:first-child{border-top:0}.structure b{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.structure ul{list-style:none;margin:6px 0 0;padding:0}.structure ul ul{margin-left:22px}.structure li li{display:block;padding:3px 0;color:var(--text)}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:10px;vertical-align:baseline}
.note{margin-top:10px;font-size:13px;color:var(--muted)}
h1 sub,h2 sub{font-size:.5em;vertical-align:baseline;position:relative;top:.12em;margin-left:.02em}.nw{white-space:nowrap}h2.plain{font:600 18px/1.4 "DM Sans",sans-serif;letter-spacing:0}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;list-style:none;padding:0;margin:0}
.card{display:block;height:100%;padding:14px 16px 12px;border:1px solid var(--line);border-radius:14px;background:var(--panel);text-decoration:none}
.card:hover{border-color:#3a4352;background:var(--panel-2)}.card strong{display:block;font:600 22px/1.1 "Barlow Condensed",sans-serif}.card span{display:block;margin-top:4px;font-size:13px;color:var(--muted)}
.card svg{display:block;width:100%;height:30px;margin-top:10px;border-radius:3px}
.cat{scroll-margin-top:16px}.cat>p{margin-bottom:14px}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 0;padding:0;list-style:none}.toc a{display:inline-block;padding:8px 14px;border:1px solid var(--line);border-radius:999px;font-size:14px;color:var(--text-2);text-decoration:none}.toc a:hover{color:var(--text);border-color:#3a4352}
.optout{display:flex;align-items:center;gap:12px;margin-top:22px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2);cursor:pointer}.optout input{width:18px;height:18px;accent-color:var(--accent)}
footer{padding:22px 0 34px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}footer a{color:var(--text-2)}
@media (max-width:640px){.facts{grid-template-columns:1fr 1fr}.facts div:nth-child(2){border-right:0}.facts div:nth-child(-n+2){border-bottom:1px solid var(--line)}.top nav a.hide-sm{display:none}.lead{font-size:16px}.profile{padding:14px 12px 8px}.profile text{font-size:30px}.cta{width:100%;justify-content:center}}`;

function shell(o: SeoOptions, page: { title: string; description: string; path: string; body: string; jsonLd?: object; ctaHref?: string }): string {
  const site = trimSlash(o.site);
  const url = site + page.path;
  return `<!doctype html>
<html lang="nb"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(page.title)}</title>
<meta name="description" content="${e(page.description)}">
<link rel="canonical" href="${e(url)}">
<meta name="theme-color" content="#0c0f14"><link rel="icon" href="/favicon.svg">
<meta property="og:type" content="website"><meta property="og:site_name" content="SUMMIT"><meta property="og:locale" content="nb_NO">
<meta property="og:title" content="${e(page.title)}"><meta property="og:description" content="${e(page.description)}"><meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(site)}/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=DM+Sans:wght@400;600;700&display=swap">
<style>${css}</style>
${page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}${o.analytics ? analyticsSnippet + '\n' : ''}</head>
<body><div class="wrap">
<header class="top"><a class="brand" href="/" aria-label="SUMMIT, til appen">${logo}SUMMIT</a><nav aria-label="Hovedmeny"><a href="/okter/" class="hide-sm">Alle økter</a><a href="${e(page.ctaHref ?? '/')}">Åpne appen</a></nav></header>
<main id="innhold">
${page.body}
</main>
<footer>SUMMIT – intervalltrening på sykkel, rett i nettleseren · <a href="/okter/">Alle økter</a> · <a href="/personvern/">Personvern</a></footer>
</div></body></html>
`;
}

export function renderWorkoutPage(w: Workout, all: Workout[], o: SeoOptions): string {
  const info = categoryInfo[w.category];
  const heading = workoutHeading(w);
  const target = mainTarget(w);
  const targetText = target.min === target.max ? `${target.max} %` : `${target.min}–${target.max} %`;
  const example = Math.round((target.max / 100) * 250);
  const related = all.filter(x => x.category === w.category && x.id !== w.id)
    .sort((a, b) => Math.abs(workoutDuration(a) - workoutDuration(w)) - Math.abs(workoutDuration(b) - workoutDuration(w))).slice(0, 4);
  const site = trimSlash(o.site);
  const body = `<nav class="crumbs" aria-label="Brødsmuler"><a href="/okter/">Økter</a> / <a href="/okter/#${info?.slug ?? ''}">${e(w.category)}</a></nav>
<p class="eyebrow">${e(w.category)} · ${difficultyLabel[w.difficulty]}</p>
<h1>${display(heading)}</h1>
<p class="lead">${e(w.description)}</p>
<dl class="facts"><div><dt>Total tid</dt><dd>${totalMinutes(w)} min</dd></div><div><dt>Hoveddel</dt><dd>${targetText} <small>FTP</small></dd></div><div><dt>TSS, anslag</dt><dd>${workoutTss(w)}</dd></div><div><dt>Nivå</dt><dd>${difficultyLabel[w.difficulty].split(' ')[0]}</dd></div></dl>
<figure class="profile">${profileSvg(w)}<figcaption>Wattmål i prosent av FTP gjennom økten, farget etter treningssone.</figcaption></figure>
<div class="cta-row"><a class="cta" href="${e(ctaHref(w))}">Sykle økten nå <span aria-hidden="true">→</span></a><p class="cta-note">Gratis, rett i nettleseren. Ingen konto.</p></div>
<section aria-labelledby="oppbygging"><h2 id="oppbygging">Slik er økten bygd opp</h2>${structureHtml(w)}
<p class="note">Prosentene gjelder din FTP. Eksempel: med FTP 250 W er målet ${target.min === target.max ? `i hoveddelen ${example} W` : `i det hardeste draget ${example} W`}. TSS-anslaget er regnet fra planen, ikke fra målte watt.</p></section>
<section aria-labelledby="passer"><h2 id="passer">Passer for</h2><p>${e(info?.who ?? w.description)}</p></section>
<section aria-labelledby="slik"><h2 id="slik">Slik sykler du den i SUMMIT</h2><p>${prose(COMPAT)} Wattmålene regnes ut fra FTP-en din, og skjermen viser hele tiden om du skal øke eller senke, og hvor mye. Har sykkelen ikke automatisk motstand, justerer du den selv.</p><p>Ingen sykkel tilkoblet? Prøv økten som demotur med simulerte watt.</p></section>
${related.length ? `<section aria-labelledby="lignende"><h2 id="lignende">Lignende økter</h2><ul class="related">${related.map(card).join('')}</ul></section>` : ''}`;
  return shell(o, {
    title: workoutTitle(w), description: workoutDescription(w), path: workoutPath(w), body, ctaHref: ctaHref(w),
    jsonLd: { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Økter', item: `${site}/okter/` },
      { '@type': 'ListItem', position: 2, name: heading, item: site + workoutPath(w) },
    ] },
  });
}

function card(w: Workout): string {
  const target = mainTarget(w);
  return `<li><a class="card" href="${workoutPath(w)}"><strong>${e(w.name)}</strong><span>${totalMinutes(w)} min · ${target.min === target.max ? target.max : `${target.min}–${target.max}`} % FTP · ${workoutTss(w)} TSS</span>${profileSvg(w, { width: 200, height: 30, axis: false })}</a></li>`;
}

export function renderIndexPage(all: Workout[], o: SeoOptions): string {
  const groups = categoryOrder.map(category => ({ category, items: all.filter(w => w.category === category) })).filter(g => g.items.length);
  const others = all.filter(w => !categoryOrder.includes(w.category));
  if (others.length) groups.push({ category: 'Andre', items: others });
  const body = `<p class="eyebrow">Øktbibliotek</p>
<h1>${all.length} gratis intervalløkter for sykkel</h1>
<p class="lead">Strukturerte økter fra rolig restitusjon til sprint. Wattmålene regnes ut fra din FTP, og du sykler dem rett i nettleseren. ${prose(COMPAT)}</p>
<ul class="toc">${groups.map(g => `<li><a href="#${categoryInfo[g.category]?.slug ?? 'andre'}">${e(g.category)} <span aria-hidden="true">·</span> ${g.items.length}</a></li>`).join('')}</ul>
${groups.map(g => `<section class="cat" id="${categoryInfo[g.category]?.slug ?? 'andre'}" aria-labelledby="h-${categoryInfo[g.category]?.slug ?? 'andre'}"><h2 id="h-${categoryInfo[g.category]?.slug ?? 'andre'}">${display(g.category)}</h2><p>${e(categoryInfo[g.category]?.intro ?? '')}</p><ul class="related">${g.items.map(card).join('')}</ul></section>`).join('\n')}`;
  return shell(o, {
    title: `${all.length} gratis intervalløkter for sykkel – rett i nettleseren | SUMMIT`,
    description: `Terskel, sweet spot, VO₂ maks og mer: ${all.length} strukturerte sykkeløkter med wattmål fra din FTP. Gratis i nettleseren med Bluetooth-sykkel eller -trainer.`,
    path: '/okter/', body,
  });
}

export function renderPrivacyPage(o: SeoOptions): string {
  const body = `<h1>${e(privacyTitle)}</h1>
<p class="lead">${e(privacyLead)}</p>
${privacySections.map(s => `<section><h2 class="plain">${e(s.heading)}</h2>${s.paragraphs.map(p => `<p>${e(p)}</p>`).join('')}</section>`).join('\n')}
<label class="optout"><input type="checkbox" id="optout"> ${e(privacyOptOutLabel)}</label>
<script>(function(){var b=document.getElementById('optout'),k='summit-telemetry-off';try{b.checked=localStorage.getItem(k)==='true'}catch(_){}b.addEventListener('change',function(){try{b.checked?localStorage.setItem(k,'true'):localStorage.removeItem(k)}catch(_){}})})();</script>`;
  return shell(o, { title: `${privacyTitle} | SUMMIT`, description: `${privacyLead} Slik måler SUMMIT bruk uten informasjonskapsler og uten å sende treningsdata.`, path: '/personvern/', body });
}

export function renderSitemap(site: string, paths: string[]): string {
  const base = trimSlash(site);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(p => `  <url><loc>${e(base + p)}</loc></url>`).join('\n')}
</urlset>
`;
}

export function renderRobots(site: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${trimSlash(site)}/sitemap.xml\n`;
}

