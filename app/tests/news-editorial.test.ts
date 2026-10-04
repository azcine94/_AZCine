import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorialSnapshot, parseConfig, readingEvents } from '../src/news-editorial-contract.ts';
import type { NewsEvent } from '../src/news-editorial-contract.ts';
const config = { model: null, domains: (['frontiers', 'industry', 'visual'] as const).map(domain => ({ domain, enabled: true, rule: 'explicit fixture', minScore: 50, dailyLimit: 5 })), featuredScore: 75, overviewLimit: 3, autoCollect: false, autoDaily: false, dailyTime: '09:00' };
test('Given malicious enum names or invalid quantities When decode Then retain prior UI data by rejecting snapshot', () => {
  assert.throws(() => parseConfig({ ...config, domains: [{ ...config.domains[0], domain: 'constructor' }, ...config.domains.slice(1)] }));
  assert.throws(() => parseConfig({ ...config, overviewLimit: 4 }));
  assert.throws(() => parseConfig({ ...config, domains: config.domains.map(r => ({ ...r, dailyLimit: 6 })) }));
  const run = { id: 'aabbccdd-1111-2222-3333-000000000001', kind: 'organize', status: 'constructor', startedAt: '2026-10-04T00:00:00Z', finishedAt: null, windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z', configRevision: 1, config, total: 1, processed: 0, error: null, scheduleDate: null };
  assert.throws(() => parseEditorialSnapshot({ preferences: { config, revision: 1 }, events: [], editions: [], runs: [run], pending: 1, nextDailyAt: null }));
});
test('Given low score and repeated same-source materials When filtering Then all dynamics retain content and hot uses distinct source count', () => {
  const make = (id: string, featured: boolean, sources: string[]) => ({ id, latestAt: '2026-10-04T00:00:00Z', featured, draft: { domain: 'frontiers' }, materials: sources.map(sourceId => ({ sourceId })) }) as NewsEvent;
  const low = make('low', false, ['source-one', 'source-one']); const hot = make('hot', true, ['source-one', 'source-two']);
  assert.equal(readingEvents([low, hot], 'all', '').length, 2);
  assert.deepEqual(readingEvents([low, hot], 'featured', '').map(e => e.id), ['hot']);
  assert.deepEqual(readingEvents([low, hot], 'hot', '').map(e => e.id), ['hot']);
});
