import { describe, expect, it } from 'vitest';
import { isStuck, nextStep, type LoopState } from '../src/capture-plan.js';

const base: LoopState = {
  viewportHeight: 800,
  scrollHeight: 2000,
  lastOffset: null,
  framesTaken: 0,
  initialScrollHeight: 2000,
};

/** Runs the planner against a page whose scrollHeight follows `heightAt(frames)`. */
function simulate(
  heightAt: (frames: number) => number,
  limits = { maxScreens: 300, maxHeight: 200_000 },
) {
  let s: LoopState = { ...base, scrollHeight: heightAt(0), initialScrollHeight: heightAt(0) };
  const ys: number[] = [];
  for (;;) {
    const step = nextStep(s, limits);
    if (step.kind === 'stop') return { ys, step };
    ys.push(step.y);
    s = {
      ...s,
      lastOffset: step.y,
      framesTaken: s.framesTaken + 1,
      scrollHeight: heightAt(s.framesTaken + 1),
    };
  }
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

describe('isStuck', () => {
  it('flags a scroll that did not move', () => {
    expect(isStuck(1600, 800, 800)).toBe(true);
    expect(isStuck(1600, 1600, 800)).toBe(false);
    expect(isStuck(0, 0, null)).toBe(false);
  });
});
