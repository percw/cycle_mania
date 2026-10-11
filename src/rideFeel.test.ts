import { describe, expect, it } from 'vitest';
import { approachSpeed, ArcadeMotion, feelProfile, targetSpeed } from './rideFeel';

describe('speed models', () => {
  it('maps worlds to road and arcade feel', () => {
    expect(feelProfile('vestland')).toBe('road');
    expect(feelProfile('fjord')).toBe('road');
    expect(feelProfile('tron')).toBe('arcade');
    expect(feelProfile('sky')).toBe('arcade');
  });
  it('keeps road speeds believable but clearly responsive', () => {
    expect(targetSpeed('road', 250, 250)).toBeCloseTo(40, 5);
    const easy = targetSpeed('road', 125, 250), hard = targetSpeed('road', 400, 250);
    expect(easy).toBeGreaterThan(25);
    expect(easy).toBeLessThan(30);
    expect(hard / easy).toBeGreaterThan(1.8); // a real bike gives ~1.47 for this step
    expect(targetSpeed('road', 2000, 250)).toBeLessThanOrEqual(80);
  });
  it('makes arcade speed big and steep', () => {
    expect(targetSpeed('arcade', 250, 250)).toBeCloseTo(300, 5);
    expect(targetSpeed('arcade', 375, 250)).toBeGreaterThan(500);
    expect(targetSpeed('arcade', 125, 250)).toBeLessThan(140);
  });
  it('coasts to zero without power and ignores bad input', () => {
    expect(targetSpeed('road', 0, 250)).toBe(0);
    expect(targetSpeed('arcade', undefined, 250)).toBe(0);
    expect(targetSpeed('road', 200, 0)).toBe(0);
  });
  it('accelerates faster than it rolls out', () => {
    const up = approachSpeed(0, 300, 0.5, 'arcade');
    const down = 300 - approachSpeed(300, 0, 0.5, 'arcade');
    expect(up).toBeGreaterThan(down);
    expect(approachSpeed(100, 100, 1, 'road')).toBe(100);
  });
});

describe('arcade motion', () => {
  it('integrates travel from speed and reports acceleration', () => {
    const m = new ArcadeMotion(0);
    for (let i = 0; i < 120; i++) m.update(1 / 60, true, 360, 0);
    expect(m.speed).toBeGreaterThan(300);
    // 360 km/h is 100 m/s: two seconds of easing in covers a little under 200 m.
    expect(m.travel).toBeGreaterThan(150);
    expect(m.travel).toBeLessThan(200);
  });
  it('freezes on pause and follows large recorded jumps', () => {
    const m = new ArcadeMotion(100);
    m.update(0.1, true, 300, 100);
    const before = m.travel;
    m.update(0.1, false, 300, 100);
    expect(m.travel).toBe(before);
    expect(m.speed).toBe(0);
    expect(m.update(0.016, false, 300, 1100)).toBe(true);
    expect(m.travel).toBeCloseTo(before + 1000, 5);
  });
});
