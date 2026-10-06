/**
 * Share card: a 1080×1350 PNG drawn on a canvas, entirely on the device.
 * Pure helpers (model, stats, power line, wrapping) are separated from drawing for tests.
 */
import { measuredSamples } from './analytics';
import type { Tone } from './reportInsights';
import type { RideRecord, RideSample } from './storage';
import { getZone } from './training';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PAD = 88;

const ink = {
  bg: '#0c0f14', panel: '#151a22', line: '#262e3b', text: '#f2eee8', text2: '#b8bec8', muted: '#8d95a2',
  accent: '#f48468', warn: '#f2b356',
};
export const toneColor: Record<Tone, string> = { great: '#6ed3a6', good: '#97dbc0', mixed: '#f5ce68', off: '#ff9a6b', neutral: '#a8adb6' };

export interface ShareCardInput {
  ride: Pick<RideRecord, 'name' | 'date' | 'demo' | 'seconds' | 'avgPower' | 'energy' | 'distance' | 'ftp'>;
  samples: RideSample[];
  verdict: string;
  tone: Tone;
  np: number | null;
  tss: number | null;
  /** Share of the main set within ±10 % of target; null when not judged (demo, FTP test). */
  adherence: number | null;
  worldName?: string;
  /** Printed host, e.g. "summit-sykkel.vercel.app". */
  site: string;
}
export interface ShareStat { label: string; value: string; unit?: string }
export interface LinePoint { x: number; y: number; color: string }
export interface ShareCardModel {
  title: string; eyebrow: string; verdict: string; verdictColor: string; demo: boolean;
  stats: ShareStat[]; line: LinePoint[][]; site: string; fileName: string;
}

/** 45:07 below an hour, 1:05:00 above. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export function formatShareDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Up to four numbers in priority order: time, average power, TSS, on target, then fallbacks. */
export function pickStats(input: Pick<ShareCardInput, 'ride' | 'np' | 'tss' | 'adherence'>): ShareStat[] {
  const { ride } = input;
  const candidates: (ShareStat | null)[] = [
    { label: 'Tid', value: formatClock(ride.seconds) },
    ride.avgPower > 0 ? { label: 'Snitteffekt', value: String(Math.round(ride.avgPower)), unit: 'W' } : null,
    !ride.demo && input.tss !== null ? { label: 'TSS', value: String(input.tss) } : null,
    !ride.demo && input.adherence !== null ? { label: 'I målet', value: String(input.adherence), unit: '%' } : null,
    !ride.demo && input.np !== null ? { label: 'Normalisert', value: String(input.np), unit: 'W' } : null,
    ride.energy > 0 ? { label: 'Arbeid', value: String(Math.round(ride.energy)), unit: 'kJ' } : null,
    { label: 'Distanse', value: ride.distance.toFixed(1).replace('.', ','), unit: 'km' },
  ];
  return candidates.filter((stat): stat is ShareStat => stat !== null).slice(0, 4);
}

/**
 * Bucketed power trace scaled into a width×height box, split into runs at data gaps.
 * Each point carries the training-zone colour of its bucket. Demo rides use simulated watts.
 */
export function powerLine(samples: RideSample[], seconds: number, ftp: number, opts: { width: number; height: number; buckets?: number; simulated?: boolean }): LinePoint[][] {
  const duration = Math.max(1, Math.round(seconds));
  const source = opts.simulated
    ? samples.filter(s => Number.isInteger(s.second) && s.second >= 1 && s.second <= duration && Number.isFinite(s.power) && s.power >= 0)
    : measuredSamples(samples, duration);
  const count = Math.max(1, Math.min(opts.buckets ?? 180, duration));
  const sums = new Array<number>(count).fill(0), hits = new Array<number>(count).fill(0);
  for (const sample of source) {
    const index = Math.min(count - 1, Math.floor(((sample.second - 1) / duration) * count));
    sums[index] += sample.power; hits[index]++;
  }
  const means = sums.map((sum, i) => hits[i] ? sum / hits[i] : null);
  const peak = Math.max(0, ...means.map(v => v ?? 0));
  if (!peak) return [];
  const top = Math.max(peak, ftp > 0 ? ftp * 0.8 : 0) * 1.08;
  const runs: LinePoint[][] = [];
  let run: LinePoint[] | null = null;
  means.forEach((mean, i) => {
    if (mean === null) { run = null; return; }
    if (!run) runs.push(run = []);
    run.push({
      x: Math.round(((i + 0.5) / count) * opts.width * 10) / 10,
      y: Math.round((opts.height - (mean / top) * opts.height) * 10) / 10,
      color: getZone(mean, ftp).color,
    });
  });
  return runs;
}

/** Greedy word wrap with a measuring function; the last allowed line gets an ellipsis if needed. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

export function shareFileName(ride: Pick<RideRecord, 'name' | 'date'>): string {
  const day = Number.isNaN(Date.parse(ride.date)) ? 'okt' : new Date(ride.date).toISOString().slice(0, 10);
  const slug = ride.name.toLowerCase().normalize('NFKD').replace(/[×x]/g, 'x').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `summit-${day}${slug ? `-${slug}` : ''}.png`;
}

/** The power line is computed in this box and scaled to the space left on the card. */
export const LINE_BOX = { width: CARD_WIDTH - PAD * 2, height: 120 };

export function shareCardModel(input: ShareCardInput): ShareCardModel {
  const date = formatShareDate(input.ride.date);
  return {
    title: input.ride.name,
    eyebrow: [date, input.worldName].filter(Boolean).join(' · ').toUpperCase(),
    verdict: input.verdict,
    verdictColor: toneColor[input.tone],
    demo: input.ride.demo,
    stats: pickStats(input),
    line: powerLine(input.samples, input.ride.seconds, input.ride.ftp, { ...LINE_BOX, simulated: input.ride.demo }),
    site: input.site,
    fileName: shareFileName(input.ride),
  };
}

/* ---------- drawing (browser only) ---------- */

type Ctx = CanvasRenderingContext2D;
const font = (weight: number, size: number, family: 'Barlow Condensed' | 'DM Sans') => `${weight} ${size}px "${family}", ${family === 'DM Sans' ? 'system-ui, sans-serif' : '"Arial Narrow", sans-serif'}`;

/** Letter-spaced text without relying on ctx.letterSpacing (missing in some browsers). */
function spaced(ctx: Ctx, text: string, x: number, y: number, spacing: number, align: 'left' | 'right' = 'left') {
  const width = [...text].reduce((w, ch) => w + ctx.measureText(ch).width + spacing, -spacing);
  let cursor = align === 'right' ? x - width : x;
  for (const ch of text) { ctx.fillText(ch, cursor, y); cursor += ctx.measureText(ch).width + spacing; }
  return width;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** The SUMMIT mountain mark (same path as the app logo, 42×34 units). */
function logoPath(ctx: Ctx, x: number, y: number, scale: number) {
  ctx.beginPath();
  const p = (px: number, py: number) => [x + px * scale, y + py * scale] as const;
  ctx.moveTo(...p(2, 30)); ctx.lineTo(...p(17, 4)); ctx.lineTo(...p(25, 18)); ctx.lineTo(...p(30, 9)); ctx.lineTo(...p(41, 30)); ctx.closePath();
  ctx.moveTo(...p(11, 15)); ctx.lineTo(...p(17, 20)); ctx.lineTo(...p(22, 15));
}

async function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts) return;
  const wanted = [font(600, 120, 'Barlow Condensed'), font(500, 30, 'DM Sans'), font(600, 26, 'DM Sans'), font(700, 40, 'DM Sans')];
  const timeout = new Promise(resolve => setTimeout(resolve, 2500));
  await Promise.race([Promise.all(wanted.map(f => document.fonts.load(f).catch(() => []))).then(() => document.fonts.ready), timeout]);
}

export function drawShareCard(ctx: Ctx, model: ShareCardModel) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  ctx.textBaseline = 'alphabetic';
  // Fjord ink with a low alpenglow at the top-left and a cool hint at the top-right.
  ctx.fillStyle = ink.bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(120, -40, 0, 120, -40, 980);
  glow.addColorStop(0, 'rgba(244,132,104,0.20)'); glow.addColorStop(1, 'rgba(244,132,104,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const cool = ctx.createRadialGradient(W, 160, 0, W, 160, 760);
  cool.addColorStop(0, 'rgba(121,184,238,0.07)'); cool.addColorStop(1, 'rgba(121,184,238,0)');
  ctx.fillStyle = cool; ctx.fillRect(0, 0, W, H);
  // A large, faint ridge from the logo, as a quiet backdrop.
  ctx.save(); ctx.strokeStyle = 'rgba(242,238,232,0.035)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  logoPath(ctx, 470, 40, 15); ctx.stroke(); ctx.restore();

  // Header: mark + wordmark, demo label on the right.
  ctx.save(); ctx.strokeStyle = ink.accent; ctx.lineWidth = 4.5; ctx.lineJoin = 'round';
  logoPath(ctx, PAD, 92, 1.45); ctx.stroke(); ctx.restore();
  ctx.fillStyle = ink.text; ctx.font = font(700, 38, 'DM Sans');
  spaced(ctx, 'SUMMIT', PAD + 76, 134, 9);
  if (model.demo) {
    ctx.font = font(700, 22, 'DM Sans');
    const label = 'DEMO · SIMULERTE WATT';
    const width = [...label].reduce((w, ch) => w + ctx.measureText(ch).width + 3, -3);
    roundRect(ctx, W - PAD - width - 40, 92, width + 40, 52, 14);
    ctx.fillStyle = 'rgba(242,179,86,0.10)'; ctx.fill(); ctx.strokeStyle = 'rgba(242,179,86,0.55)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = ink.warn; spaced(ctx, label, W - PAD - 20, 126, 3, 'right');
  }

  // Date and world, workout name (shrinks to fit two lines), verdict.
  ctx.fillStyle = ink.muted; ctx.font = font(600, 24, 'DM Sans');
  spaced(ctx, model.eyebrow, PAD, 286, 3);
  const maxWidth = W - PAD * 2;
  let size = 132, lines: string[] = [];
  for (; size >= 84; size -= 8) {
    ctx.font = font(600, size, 'Barlow Condensed');
    lines = wrapLines(model.title, maxWidth, s => ctx.measureText(s).width, 2);
    if (lines.length === 1 || size <= 104) break;
  }
  ctx.fillStyle = ink.text;
  let baseline = 286 + size * 0.98;
  lines.forEach((line, i) => ctx.fillText(line, PAD, baseline + i * size * 0.92));
  baseline += (lines.length - 1) * size * 0.92;
  ctx.fillStyle = model.verdictColor; ctx.font = font(600, 58, 'Barlow Condensed');
  const verdictBaseline = baseline + 82;
  ctx.fillText(wrapLines(model.verdict, maxWidth, s => ctx.measureText(s).width, 1)[0] ?? '', PAD, verdictBaseline);

  // Key numbers, 2×2, flowing from the verdict.
  const gap = 20, cellW = (maxWidth - gap) / 2, cellH = 176, top = verdictBaseline + 78;
  model.stats.forEach((stat, i) => {
    const x = PAD + (i % 2) * (cellW + gap), y = top + Math.floor(i / 2) * (cellH + gap);
    roundRect(ctx, x, y, cellW, cellH, 22);
    ctx.fillStyle = 'rgba(242,238,232,0.035)'; ctx.fill(); ctx.strokeStyle = ink.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = ink.muted; ctx.font = font(600, 22, 'DM Sans');
    spaced(ctx, stat.label.toUpperCase(), x + 30, y + 50, 2.5);
    ctx.fillStyle = ink.text; ctx.font = font(600, 100, 'Barlow Condensed');
    ctx.fillText(stat.value, x + 28, y + 146);
    if (stat.unit) {
      const valueWidth = ctx.measureText(stat.value).width;
      ctx.fillStyle = ink.muted; ctx.font = font(500, 32, 'DM Sans');
      ctx.fillText(stat.unit, x + 28 + valueWidth + 10, y + 144);
    }
  });

  // Power through the ride, line in zone colours over a neutral graphite area; fills the space left.
  const statsBottom = top + Math.ceil(model.stats.length / 2) * (cellH + gap) - gap;
  const chartTop = statsBottom + 92, chartBottom = H - 168;
  const c = { x: PAD, y: chartTop, width: LINE_BOX.width, height: Math.max(90, chartBottom - chartTop) };
  const sy = c.height / LINE_BOX.height;
  ctx.fillStyle = ink.muted; ctx.font = font(600, 20, 'DM Sans');
  spaced(ctx, 'WATT GJENNOM ØKTEN', c.x, c.y - 22, 2.5);
  ctx.strokeStyle = 'rgba(242,238,232,0.08)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c.x, c.y + c.height + 0.5); ctx.lineTo(c.x + c.width, c.y + c.height + 0.5); ctx.stroke();
  for (const run of model.line) {
    if (!run.length) continue;
    ctx.beginPath(); ctx.moveTo(c.x + run[0].x, c.y + c.height);
    run.forEach(p => ctx.lineTo(c.x + p.x, c.y + p.y * sy));
    ctx.lineTo(c.x + run[run.length - 1].x, c.y + c.height); ctx.closePath();
    ctx.fillStyle = 'rgba(242,238,232,0.05)'; ctx.fill();
    ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (run.length === 1) { ctx.fillStyle = run[0].color; ctx.beginPath(); ctx.arc(c.x + run[0].x, c.y + run[0].y * sy, 3, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 1; i < run.length; i++) {
      ctx.strokeStyle = run[i].color; ctx.beginPath();
      ctx.moveTo(c.x + run[i - 1].x, c.y + run[i - 1].y * sy); ctx.lineTo(c.x + run[i].x, c.y + run[i].y * sy); ctx.stroke();
    }
  }

  // Footer.
  ctx.strokeStyle = ink.line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, H - 128); ctx.lineTo(W - PAD, H - 128); ctx.stroke();
  ctx.fillStyle = ink.text2; ctx.font = font(600, 28, 'DM Sans');
  ctx.fillText(model.site, PAD, H - 72);
  ctx.fillStyle = ink.muted; ctx.font = font(500, 24, 'DM Sans');
  ctx.textAlign = 'right'; ctx.fillText('Intervalltrening i nettleseren', W - PAD, H - 72); ctx.textAlign = 'left';
}

export async function renderShareCard(model: ShareCardModel): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH; canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nettleseren kan ikke tegne bildet.');
  drawShareCard(ctx, model);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Kunne ikke lage bildet.')), 'image/png'));
}

/** Native share sheet with the image when the browser supports files; otherwise a download. */
export async function shareOrDownload(blob: Blob, model: ShareCardModel): Promise<'share' | 'download' | 'cancelled'> {
  const file = new File([blob], model.fileName, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: model.title, text: `${model.title} – syklet med SUMMIT` });
      return 'share';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = model.fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'download';
}
