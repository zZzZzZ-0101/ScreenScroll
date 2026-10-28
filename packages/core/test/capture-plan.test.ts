import { describe, expect, it } from 'vitest';
import {
  isStuck,
  nextStep,
  type LoopState,
  type NextStep,
  type PillReserve,
} from '../src/capture-plan.js';

const base: LoopState = {
  viewportHeight: 800,
  scrollHeight: 2000,
  coveredTo: null,
  framesTaken: 0,
  initialScrollHeight: 2000,
};

type Frame = Extract<NextStep, { kind: 'scroll' }>;

/** Runs the planner against a page whose scrollHeight follows `heightAt(frames)`. */
function simulate(
  heightAt: (frames: number) => number,
  limits = { maxScreens: 300, maxHeight: 200_000 },
  reserve?: PillReserve,
  extra: Partial<LoopState> = {},
) {
  let s: LoopState = {
    ...base,
    scrollHeight: heightAt(0),
    initialScrollHeight: heightAt(0),
    ...extra,
  };
  const frames: Frame[] = [];
  for (;;) {
    const step = nextStep(s, limits, reserve);
    if (step.kind === 'stop') return { ys: frames.map((f) => f.y), frames, step };
    frames.push(step);
    const covered = step.y + step.keep.bottom;
    s = {
      ...s,
      coveredTo: Math.max(s.coveredTo ?? 0, covered),
      framesTaken: s.framesTaken + 1,
      scrollHeight: heightAt(s.framesTaken + 1),
    };
  }
}

/** Every content row in [from, to) is kept by some frame, and no kept row is under the pill. */
function expectCovered(frames: Frame[], from: number, to: number) {
  const bands = frames
    .map((f) => [f.y + f.keep.top, f.y + f.keep.bottom] as const)
    .sort((a, b) => a[0] - b[0]);
  let at = from;
  for (const [a, b] of bands) {
    expect(a).toBeLessThanOrEqual(at);
    at = Math.max(at, b);
  }
  expect(at).toBeGreaterThanOrEqual(to);
}

describe('nextStep', () => {
  it('steps one viewport at a time and clamps the last frame to the bottom', () => {
    const { ys, step } = simulate(() => 2000);
    expect(ys).toEqual([0, 800, 1200]);
    expect(step).toEqual({ kind: 'stop', reason: 'done', warning: null });
  });

  it('takes a single frame when the page fits', () => {
    const { ys, step } = simulate(() => 600);
    expect(ys).toEqual([0]);
    expect(step.kind === 'stop' && step.reason).toBe('done');
  });

  it('stops infinite pages at the screen cap with a loud warning', () => {
    const { ys, step } = simulate((n) => 2000 + n * 800, { maxScreens: 10, maxHeight: 1e9 });
    expect(ys).toHaveLength(10);
    expect(step).toMatchObject({ kind: 'stop', reason: 'max-screens' });
    expect(step.kind === 'stop' && step.warning).toMatch(
      /kept loading more content; captured the first 10 screens/,
    );
  });

  it('stops at the height cap on a long static page', () => {
    const { ys, step } = simulate(() => 1_000_000, { maxScreens: 1e6, maxHeight: 4000 });
    expect(ys).toEqual([0, 800, 1600, 2400, 3200]);
    expect(step).toMatchObject({ kind: 'stop', reason: 'max-height' });
    expect(step.kind === 'stop' && step.warning).toMatch(/longer than the capture limit/);
  });
});

describe('nextStep with the pill always on screen', () => {
  const pill = { top: 56, bottom: 56 };

  it('keeps the rows above the pill, then moves the pill up for the last rows', () => {
    const { frames } = simulate(() => 2000, undefined, pill);
    expect(frames.map((f) => [f.y, f.pill])).toEqual([
      [0, 'bottom'],
      [744, 'bottom'],
      [1200, 'top'],
    ]);
    expect(frames.at(-1)!.keep).toEqual({ top: 56, bottom: 800 });
    expectCovered(frames, 0, 2000);
  });

  it('adds a frame when the rows under the top pill were not captured yet', () => {
    // Captured to 1488: past the last screen's top (1450) but not past 1450 + 56.
    const { frames } = simulate(() => 2250, undefined, pill);
    expect(frames.map((f) => [f.y, f.pill])).toEqual([
      [0, 'bottom'],
      [744, 'bottom'],
      [762, 'bottom'],
      [1450, 'top'],
    ]);
    expectCovered(frames, 0, 2250);
    const tight = simulate(() => 1550, undefined, pill).frames;
    expectCovered(tight, 0, 1550);
    expect(tight.filter((f) => f.pill === 'top')).toHaveLength(1);
  });

  it('a page that fits: two frames in place, the pill below then above', () => {
    const { frames } = simulate(() => 600, undefined, pill, { viewportHeight: 600 });
    expect(frames.map((f) => [f.y, f.pill])).toEqual([
      [0, 'bottom'],
      [0, 'top'],
    ]);
    expectCovered(frames, 0, 600);
  });

  it('covers every row for many page heights and pill sizes', () => {
    for (const h of [800, 801, 900, 1544, 1545, 1600, 2345, 9999])
      for (const r of [
        { top: 56, bottom: 56 },
        { top: 0, bottom: 40 },
        { top: 120, bottom: 10 },
      ]) {
        const { frames, step } = simulate(() => h, undefined, r);
        expect(step).toMatchObject({ reason: 'done' });
        expectCovered(frames, 0, h);
        for (const f of frames) {
          if (f.pill === 'bottom') expect(f.keep.bottom).toBe(800 - r.bottom);
          if (f.pill === 'top') expect(f.keep.top).toBe(r.top);
        }
      }
  });

  it('a region lower on the page starts there', () => {
    const { frames } = simulate(() => 3300, undefined, pill, {
      start: 2500,
      maxScroll: 4200,
    });
    expect(frames[0]!.y).toBe(2500);
    expectCovered(frames, 2500, 3300);
  });

  it('hides the pill for each grab when the box is too small to share', () => {
    const { frames } = simulate(() => 1000, undefined, { top: 40, bottom: 40 }, {
      viewportHeight: 100,
    });
    expect(frames.every((f) => f.pill === 'hidden' && f.keep.bottom === 100)).toBe(true);
    expectCovered(frames, 0, 1000);
  });
});

describe('isStuck', () => {
  it('flags a scroll that did not move', () => {
    expect(isStuck(1600, 800, 800)).toBe(true);
    expect(isStuck(1600, 1600, 800)).toBe(false);
    expect(isStuck(0, 0, null)).toBe(false);
  });
});
