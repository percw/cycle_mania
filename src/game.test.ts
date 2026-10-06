import { describe, it, expect } from "vitest";
import {
  createGame,
  stepGame,
  completeGameBlock,
  gameResult,
  ghostScore,
  careerLevel,
} from "./game";
import type { WorkoutBlock } from "./training";
const block: WorkoutBlock = {
  label: "Drag",
  seconds: 60,
  intensity: 1,
  kind: "work",
};
function ride(
  power: number,
  seconds = 60,
  kind: WorkoutBlock["kind"] = "work",
) {
  let game = createGame();
  for (let n = 0; n < seconds; n++)
    game = stepGame(game, {
      seconds: 1,
      power,
      target: 200,
      block: { ...block, kind },
      index: 0,
      remaining: 60 - n,
      elapsed: n,
    });
  return game;
}
describe("interval mastery", () => {
  it("rewards prescribed power and recovery equally, never excess power", () => {
    const good = ride(200);
    expect(good.pulses).toBe(5);
    expect(good.combo).toBe(4);
    expect(ride(300).score).toBe(0);
    expect(ride(200, 60, "recovery").score).toBe(good.score);
  });
  it("grants stars only for sufficient observed duration", () => {
    expect(completeGameBlock(ride(200), block).stars).toBe(3);
    expect(completeGameBlock(ride(200, 10), block).stars).toBe(0);
  });
  it("does not earn points without sensor data", () => {
    const s = stepGame(createGame(), {
      seconds: 1,
      power: undefined,
      target: 200,
      block,
      index: 0,
      remaining: 60,
      elapsed: 0,
    });
    expect(s.score).toBe(0);
    expect(s.observed).toBe(0);
  });
  it("starts new block coverage and chain afresh after a skip", () => {
    const s = stepGame(ride(200, 5), {
      seconds: 1,
      power: 200,
      target: 200,
      block,
      index: 3,
      remaining: 60,
      elapsed: 5,
    });
    expect(s.blockObserved).toBe(1);
    expect(s.chainSeconds).toBe(1);
    expect(s.stars).toBe(0);
  });
  it("allows brief deviations before resetting combo", () => {
    let s = ride(200, 20);
    for (let i = 0; i < 3; i++)
      s = stepGame(s, {
        seconds: 1,
        power: 240,
        target: 200,
        block,
        index: 0,
        remaining: 30,
        elapsed: 20 + i,
      });
    expect(s.combo).toBe(2);
    s = stepGame(s, {
      seconds: 1,
      power: 240,
      target: 200,
      block,
      index: 0,
      remaining: 27,
      elapsed: 23,
    });
    expect(s.combo).toBe(0);
  });
  it("compares ghost at same elapsed time and stops after end", () => {
    const result = gameResult(ride(200));
    expect(ghostScore(result, 0)).toBe(0);
    expect(ghostScore(result, 30)).toBeGreaterThan(0);
    expect(ghostScore(result, 61)).toBeNull();
  });
  it("levels are monotone with bounded progress", () => {
    expect(careerLevel(0).level).toBe(1);
    expect(careerLevel(600).level).toBe(2);
    expect(careerLevel(2400).level).toBe(3);
    expect(careerLevel(1000).progress).toBeLessThan(1);
  });
});
