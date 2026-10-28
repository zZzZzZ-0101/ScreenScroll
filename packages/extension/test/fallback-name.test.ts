import { describe, expect, it } from 'vitest';
import { fallbackName } from '../src/studio/engine/export';

describe('fallback download name', () => {
  it.each([
    ['报告_2026-10-28_0915.pdf', '2026-10-28_0915.pdf'],
    ['My Page 🙂_2026-10-28_0915.pdf', 'My Page _2026-10-28_0915.pdf'],
    ['🙂🙂.zip', 'capture.zip'],
    ['עברית_2026-01-02.png', '2026-01-02.png'],
    ['noext', 'noext.bin'],
  ])('%s → %s', (input, out) => {
    const name = fallbackName(input);
    expect(name).toBe(out);
    expect(name).toMatch(/^[\x20-\x7e]+$/);
  });
});
