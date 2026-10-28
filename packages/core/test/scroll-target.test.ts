import { describe, expect, it } from 'vitest';
import { chooseScrollTarget, type ScrollCandidate } from '../src/scroll-target.js';

const viewport = { width: 1000, height: 800 };
const cand = (
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  sh = h * 5,
): ScrollCandidate => ({
  id,
  rect: { x, y, width: w, height: h },
  scrollHeight: sh,
  clientHeight: h,
});

describe('chooseScrollTarget', () => {
  it('scrolls the document when it overflows and nothing large scrolls inside', () => {
    expect(chooseScrollTarget({ viewport, docScrollHeight: 5000, candidates: [] })).toEqual({
      kind: 'document',
    });
  });

  it('picks the largest inner scroller when the document does not overflow', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 800,
      candidates: [cand(1, 0, 60, 240, 740), cand(2, 240, 60, 760, 740)],
    });
    expect(r).toEqual({ kind: 'element', id: 2, crop: { x: 240, y: 60, width: 760, height: 740 } });
  });

  it('ignores scrollers below 30% of the viewport', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 800,
      candidates: [cand(1, 0, 0, 200, 300)],
    });
    expect(r).toEqual({ kind: 'document' });
  });

  it('ignores elements that do not really overflow', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 800,
      candidates: [cand(1, 0, 0, 1000, 800, 801)],
    });
    expect(r).toEqual({ kind: 'document' });
  });

  it('prefers a large inner scroller when the document overflows by under one viewport', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 900,
      candidates: [cand(3, 0, 50, 1000, 700)],
    });
    expect(r.kind).toBe('element');
  });

  it('prefers the document when it overflows by more than one viewport', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 4000,
      candidates: [cand(3, 0, 50, 1000, 700)],
    });
    expect(r).toEqual({ kind: 'document' });
  });

  it('crops to the visible part of a scroller that extends past the viewport', () => {
    const r = chooseScrollTarget({
      viewport,
      docScrollHeight: 800,
      candidates: [cand(4, 100, 100, 900, 1200)],
    });
    expect(r).toEqual({
      kind: 'element',
      id: 4,
      crop: { x: 100, y: 100, width: 900, height: 700 },
    });
  });
});
