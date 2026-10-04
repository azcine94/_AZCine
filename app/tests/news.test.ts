// Synthetic contract/route cases, written only; execution needs separate user authorization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equalConfig, normalizedConfig, parseFeedPreview, parseMaterialPage, parseNewsSnapshot, publicationLabel, validateSource } from '../src/news-contract.ts';
import type { NewsSource, SourceConfig } from '../src/news-contract.ts';
import { navigationPage, newsSourceTarget, pageTitle, resolveRoute } from '../src/routes.ts';

const config: SourceConfig = { id: 'rss-fixture', name: 'Fixture source', feedUrl: 'https://example.org/feed.xml', identity: 'official', domains: [], usage: 'editorial', intervalMinutes: 120, enabled: true };
const source: NewsSource = { config, revision: 1, createdAt: '2026-10-04T00:00:00.000Z', feedKind: null, lastAttemptAt: null, lastSuccessAt: null, lastStatus: null, lastError: null };
const entry = { externalId: null, title: 'Fixture title', url: 'https://example.org/article', publishedAt: null, publishedRaw: null, summary: 'Only subscription summary', summaryTruncated: false };

test('Given资讯管理及信源二级页 When解析路由 Then设置导航高亮且有正常标题', () => {
  for (const hash of ['#settings/news', '#settings/news/sources/new', '#settings/news/sources/rss-fixture']) assert.equal(navigationPage(resolveRoute(hash)), 'settings');
  assert.equal(newsSourceTarget(resolveRoute('#settings/news/sources/rss-fixture')), 'rss-fixture');
  assert.equal(pageTitle(resolveRoute('#settings/news/sources/new')), '新增信源');
  assert.equal(resolveRoute('#settings/news/sources/../../data'), 'missing');
});

test('Given完整或缺字段回执 When读取资讯 Then有效数据保留且无效响应拒绝', () => {
  assert.equal(parseNewsSnapshot({ sources: [source], runs: [] }).sources[0].config.id, config.id);
  assert.throws(() => parseNewsSnapshot({ sources: [source, source], runs: [] }));
  assert.throws(() => parseNewsSnapshot({ sources: [{ ...source, revision: 0 }], runs: [] }));
  assert.throws(() => parseNewsSnapshot({ sources: [{ ...source, config: { ...config, feedUrl: 'file:///local' } }], runs: [] }));
});

test('Given空名重复名坏URL与频率 When校验 Then明确拒绝且不修改原配置', () => {
  assert.ok(validateSource({ ...config, name: '' }, [source]));
  assert.ok(validateSource({ ...config, id: 'rss-other' }, [source]));
  assert.ok(validateSource({ ...config, feedUrl: 'https://user:pass@example.org/feed' }, []));
  assert.ok(validateSource({ ...config, intervalMinutes: 1.5 }, []));
  assert.equal(validateSource(config, [source]), null);
  assert.equal(config.name, 'Fixture source');
});

test('Given预览和无发布时间 When读取 Then只保留订阅事实不猜发布时间', () => {
  const preview = parseFeedPreview({ fetchedAt: source.createdAt, kind: 'rss', total: 1, skipped: 0, warning: null, entries: [entry] });
  assert.equal(publicationLabel(preview.entries[0]), '信源未提供发布时间');
  assert.equal(publicationLabel({ publishedAt: null, publishedRaw: 'not a date' }), '原时间无法解析：not a date');
  assert.throws(() => parseFeedPreview({ fetchedAt: source.createdAt, kind: 'rss', total: 21, skipped: 0, warning: null, entries: Array(21).fill(entry) }));
});

test('Given分页资料 When读取 Then数量与唯一ID有效且摘要不是全文', () => {
  const material = { ...entry, id: 'a'.repeat(32), sourceId: config.id, sourceName: config.name, sourceRevision: 1, discoveredAt: source.createdAt };
  const result = parseMaterialPage({ items: [material], total: 1, page: 0, pageSize: 50 });
  assert.equal(result.items[0].summary, entry.summary);
  assert.throws(() => parseMaterialPage({ items: [material, material], total: 2, page: 0, pageSize: 50 }));
});

test('Given保存时的快照与后续手改 When比较配置 Then忽略领域顺序但保留新输入', () => {
  const saved = normalizedConfig({ ...config, name: ' Fixture source ' });
  assert.equal(equalConfig(saved, config), true);
  assert.equal(equalConfig({ ...saved, domains: ['visual', 'industry'] }, { ...saved, domains: ['industry', 'visual'] }), true);
  assert.equal(equalConfig(saved, { ...saved, name: 'Later edit' }), false);
});
