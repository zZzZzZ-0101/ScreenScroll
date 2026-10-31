import { describe, expect, it } from 'vitest';
import { narrowWindowTo } from '../src/capture-width.js';

describe('capture at width W', () => {
  it('shrinks the window by what the page must lose, frame and scrollbar kept', () => {
    // 1920 window showing a 1905 px page (15 px scrollbar): to 1200 → 1215.
    expect(narrowWindowTo(1200, { width: 1920 }, 1905)).toBe(1215);
    // At 125% zoom a CSS px is 1.25 window px.
    expect(narrowWindowTo(1000, { width: 1600 }, 1270, 1.25)).toBe(1263); // 1600 − 270 · 1.25 = 1262.5, rounded
  });
  it('never widens, and does nothing when off', () => {
    expect(narrowWindowTo(1200, { width: 1100 }, 1085)).toBeNull();
    expect(narrowWindowTo(1200, { width: 1216 }, 1201)).toBeNull();
    expect(narrowWindowTo(0, { width: 1920 }, 1905)).toBeNull();
  });
  it('stops at the narrowest window a browser allows', () => {
    expect(narrowWindowTo(1000, { width: 700 }, 1400, 0.5)).toBe(500);
  });
});
