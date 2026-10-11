/**
 * Compresses a workout's block list into readable repeats for the static workout pages:
 * "4 × 10 min på 98 % FTP, 3 min på 50 % mellom" instead of seven separate rows.
 * Pure and dependency-free so both Vitest and the Node build script can import it.
 */
import type { Workout, WorkoutBlock } from './training.ts';

export type StructureNode =
  | { type: 'block'; block: WorkoutBlock }
  | { type: 'repeat'; count: number; body: StructureNode[]; rest: WorkoutBlock | null };

const same = (a: WorkoutBlock, b: WorkoutBlock) => a.seconds === b.seconds && a.intensity === b.intensity && a.kind === b.kind;

/**
 * Finds the shortest unit that repeats over the whole sequence, either exactly (A B A B)
 * or with a trailing rest left out after the final repetition (W R W R W). Recurses into the unit.
 */
export function compressBlocks(blocks: WorkoutBlock[]): StructureNode[] {
  const n = blocks.length;
  for (let period = 1; period <= n / 2; period++) {
    // Unit ends in a block (usually a rest) that is omitted after the last repetition.
    if ((n + 1) % period === 0 && period >= 2 && (n + 1) / period >= 2) {
      const rest = blocks[period - 1];
      if (blocks.every((b, i) => same(b, blocks[i % period]))) {
        return [{ type: 'repeat', count: (n + 1) / period, body: compressBlocks(blocks.slice(0, period - 1)), rest }];
      }
    }
    if (n % period === 0 && n / period >= 2 && blocks.every((b, i) => same(b, blocks[i % period]))) {
      return [{ type: 'repeat', count: n / period, body: compressBlocks(blocks.slice(0, period)), rest: null }];
    }
  }
  return blocks.map(block => ({ type: 'block', block }));
}

export interface WorkoutParts { warmup: WorkoutBlock[]; main: StructureNode[]; cooldown: WorkoutBlock[] }

export function workoutParts(workout: Pick<Workout, 'blocks'>): WorkoutParts {
  const blocks = workout.blocks;
  let start = 0, end = blocks.length;
  while (start < end && blocks[start].kind === 'warmup') start++;
  while (end > start && blocks[end - 1].kind === 'cooldown') end--;
  return { warmup: blocks.slice(0, start), main: compressBlocks(blocks.slice(start, end)), cooldown: blocks.slice(end) };
}

export function formatBlockDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s % 60 === 0) return `${s / 60} min`;
  if (s < 120) return `${s} sek`;
  return `${Math.floor(s / 60)} min ${s % 60} sek`;
}

export const percent = (intensity: number) => `${Math.round(intensity * 100)} %`;

/** "10 min på 98 % FTP" */
export function describeBlock(block: WorkoutBlock): string {
  return `${formatBlockDuration(block.seconds)} på ${percent(block.intensity)} FTP`;
}

/** One line for a node whose body contains only blocks; null when it needs a nested list. */
export function describeNode(node: StructureNode): string | null {
  if (node.type === 'block') return describeBlock(node.block);
  if (node.body.some(child => child.type !== 'block')) return null;
  const body = node.body.map(describeNode).join(' + ');
  const rest = node.rest ? `, ${formatBlockDuration(node.rest.seconds)} på ${percent(node.rest.intensity)} mellom` : '';
  return `${node.count} × ${node.body.length > 1 ? `(${body})` : body}${rest}`;
}

/** Heading for a repeat with nested repeats: "3 ganger, 3 min på 50 % mellom:" */
export function describeOuter(node: Extract<StructureNode, { type: 'repeat' }>): string {
  return `${node.count} ganger${node.rest ? `, ${formatBlockDuration(node.rest.seconds)} på ${percent(node.rest.intensity)} mellom` : ''}:`;
}

/** Highest work target, for "Hoveddel 98 % FTP" style summaries. */
export function mainTarget(workout: Pick<Workout, 'blocks'>): { min: number; max: number } {
  const work = workout.blocks.filter(b => b.kind === 'work');
  const values = (work.length ? work : workout.blocks).map(b => Math.round(b.intensity * 100));
  return { min: Math.min(...values), max: Math.max(...values) };
}
