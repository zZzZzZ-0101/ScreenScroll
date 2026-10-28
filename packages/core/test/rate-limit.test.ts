import { describe, expect, it } from 'vitest';
import { Pacer, isQuotaError, type Clock } from '../src/rate-limit.js';

function fakeClock(): Clock & { t: number; sleeps: number[] } {
  const c = {
    t: 1000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const quota = () =>
  new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');

describe('Pacer', () => {
  it('spaces consecutive calls by the minimum interval', async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ minIntervalMs: 550, backoffMs: 600, maxRetries: 5 }, clock);
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) await pacer.run(async () => void starts.push(clock.t));
    expect(starts).toEqual([1000, 1550, 2100]);
  });

  it('does not wait when enough time has already passed', async () => {
    const clock = fakeClock();
    const pacer = new Pacer(undefined, clock);
    await pacer.run(async () => 1);
    clock.t += 2000;
    await pacer.run(async () => 2);
    expect(clock.sleeps).toEqual([]);
  });

  it('backs off and retries on quota errors', async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ minIntervalMs: 550, backoffMs: 600, maxRetries: 5 }, clock);
    let calls = 0;
    const result = await pacer.run(async () => {
      if (++calls < 3) throw quota();
      return 'frame';
    });
    expect(result).toBe('frame');
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries quota errors', async () => {
    const pacer = new Pacer({ minIntervalMs: 0, backoffMs: 1, maxRetries: 2 }, fakeClock());
    let calls = 0;
    await expect(
      pacer.run(async () => {
        calls++;
        throw quota();
      }),
    ).rejects.toThrow(/quota/);
    expect(calls).toBe(3);
  });

  it('rethrows other errors immediately', async () => {
    const pacer = new Pacer(undefined, fakeClock());
    let calls = 0;
    await expect(
      pacer.run(async () => {
        calls++;
        throw new Error('Cannot access contents of url "chrome://settings"');
      }),
    ).rejects.toThrow(/chrome:/);
    expect(calls).toBe(1);
  });

  it('recognises quota errors', () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError(new Error('Tabs cannot be edited right now'))).toBe(false);
  });
});
