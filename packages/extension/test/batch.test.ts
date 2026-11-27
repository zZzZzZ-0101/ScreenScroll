import { describe, expect, it } from 'vitest';
import {
  cancelRemainingItems,
  failedTargets,
  parseUrls,
  type BatchItem,
} from '../src/shared/batch';

describe('batch addresses', () => {
  it('one per line or space; adds https://; keeps web and file addresses only; no repeats', () => {
    const { urls, rejected } = parseUrls(
      'https://a.example/x\n  example.org/page  \nhttp://b.example\nhttps://a.example/x\nchrome://settings\njavascript:alert(1)\nfile:///tmp/a.html',
    );
    expect(urls).toEqual([
      'https://a.example/x',
      'https://example.org/page',
      'http://b.example/',
      'file:///tmp/a.html',
    ]);
    expect(rejected).toEqual(['chrome://settings', 'javascript:alert(1)']);
  });
});

describe('batch cancel and retry', () => {
  it('cancelRemainingItems marks waiting and capturing items skipped while preserving finished ones', () => {
    const items: BatchItem[] = [
      { label: 'One', url: 'https://a.example/1', status: 'done', sessionId: 's1' },
      { label: 'Two', url: 'https://a.example/2', status: 'failed', reason: 'Timed out.' },
      { label: 'Three', url: 'https://a.example/3', status: 'skipped', reason: 'Blocked.' },
      { label: 'Four', url: 'https://a.example/4', status: 'capturing' },
      { label: 'Five', url: 'https://a.example/5', status: 'waiting' },
    ];
    const next = cancelRemainingItems(items);
    expect(next).toEqual([
      { label: 'One', url: 'https://a.example/1', status: 'done', sessionId: 's1' },
      { label: 'Two', url: 'https://a.example/2', status: 'failed', reason: 'Timed out.' },
      { label: 'Three', url: 'https://a.example/3', status: 'skipped', reason: 'Blocked.' },
      { label: 'Four', url: 'https://a.example/4', status: 'skipped', reason: 'Cancelled.' },
      { label: 'Five', url: 'https://a.example/5', status: 'skipped', reason: 'Cancelled.' },
    ]);
    // Input array is not mutated.
    expect(items[4]!.status).toBe('waiting');
  });

  it('failedTargets returns retryable targets only for failed items', () => {
    const items: BatchItem[] = [
      {
        label: 'Done tab',
        url: 'https://a.example/1',
        status: 'done',
        sessionId: 's1',
        target: { kind: 'tab', tabId: 10 },
      },
      {
        label: 'Failed tab',
        url: 'https://a.example/2',
        status: 'failed',
        reason: 'Capture failed.',
        target: { kind: 'tab', tabId: 11 },
      },
      {
        label: 'Failed URL with stored target',
        url: 'https://a.example/3',
        status: 'failed',
        reason: 'Timed out.',
        target: { kind: 'url', url: 'https://a.example/3' },
      },
      {
        label: 'Legacy failed item without target',
        url: 'https://a.example/4',
        status: 'failed',
        reason: 'Error.',
      },
      {
        label: 'Failed blocked URL without target',
        url: 'chrome://settings',
        status: 'failed',
        reason: 'Blocked.',
      },
      {
        label: 'Skipped',
        url: 'https://a.example/5',
        status: 'skipped',
        reason: 'Cancelled.',
        target: { kind: 'url', url: 'https://a.example/5' },
      },
    ];
    expect(failedTargets(items)).toEqual([
      { kind: 'tab', tabId: 11 },
      { kind: 'url', url: 'https://a.example/3' },
      { kind: 'url', url: 'https://a.example/4' },
    ]);
  });
});
