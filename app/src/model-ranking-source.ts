import { BOARD_INFO, parseModelSnapshot, RANKING_DATASET } from './model-ranking-contract.ts';
import type { ModelBoard, ModelSnapshot, RankingMetric } from './model-ranking-contract.ts';
import { validDate } from './workspace-contract.ts';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
type SourceRow = Record<string, unknown>;
interface SourcePage { revision: string; total: number; rows: SourceRow[] }
function invalid(): never { throw new Error('官方公开数据不完整或各项版本不一致，已保留原榜单，请稍后刷新。'); }
function object(value: unknown): SourceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as SourceRow;
}
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(); return value; }
function integer(value: unknown): number { const n = number(value); if (!Number.isSafeInteger(n) || n < 0) return invalid(); return n; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) return invalid(); return value; }
function optionalText(value: unknown): string | null { return value === null ? null : text(value); }

// Fixed public publisher/API only. No Arena page scraping, account, local-file
// fallback or third-party mirror. Rust remains the only business DB writer.
async function requestPage(config: string, signal: AbortSignal, offset: number): Promise<SourcePage> {
  const query = new URLSearchParams({ dataset: 'lmarena-ai/leaderboard-dataset', config, split: 'latest',
    offset: String(offset), length: '100' });
  const response = await fetch(`https://datasets-server.huggingface.co/rows?${query}`, {
    signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error(`官方公开数据请求失败（HTTP ${response.status}），原榜单未改变。`);
  const revision = response.headers.get('x-revision');
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) return invalid();
  const reader = response.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder(); let body = '', size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('官方数据响应超过大小限制，原榜单未改变。');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = object(JSON.parse(body));
  const total = integer(result.num_rows_total);
  if (result.partial !== false || total < 50 || total > 10_000 || !Array.isArray(result.rows)
    || result.rows.length !== Math.min(total - offset, 100)) return invalid();
  const rows = result.rows.map((raw, index) => {
    const wrapper = object(raw);
    if (wrapper.row_idx !== offset + index || !Array.isArray(wrapper.truncated_cells) || wrapper.truncated_cells.length) return invalid();
    const row = object(wrapper.row);
    if (typeof row.category !== 'string' || typeof row.leaderboard_publish_date !== 'string'
      || !validDate(row.leaderboard_publish_date)) return invalid();
    return row;
  });
  return { revision, total, rows };
}
async function page(config: string, signal: AbortSignal): Promise<SourcePage> {
  // The public /filter service intermittently fails even when /rows is healthy.
  // Read the bounded latest split and select Overall locally; never infer the
  // category total from a truncated page or mix a changing publication revision.
  const first = await requestPage(config, signal, 0), all = [...first.rows];
  for (let offset = 100; offset < first.total; offset += 100) {
    const next = await requestPage(config, signal, offset);
    if (next.revision !== first.revision || next.total !== first.total) return invalid();
    all.push(...next.rows);
  }
  const rows = all.filter(row => row.category === 'overall');
  if (rows.length < 50 || new Set(rows.map(row => text(row.model_name))).size !== rows.length
    || rows.some((row, index) => integer(row.rank) < 1 || index > 0 && integer(row.rank) < integer(rows[index - 1].rank))) return invalid();
  return { revision: first.revision, total: rows.length, rows };
}
function metric(row: SourceRow): RankingMetric {
  const value = number(row.score), lower = number(row.score_ci_lower), upper = number(row.score_ci_upper);
  if (lower > value || value > upper) return invalid();
  return { value: value * 100, lower: lower * 100, upper: upper * 100 };
}

export async function fetchRanking(board: ModelBoard, signal: AbortSignal): Promise<ModelSnapshot> {
  const configs = board === 'agent' ? ['agent', 'agent_task_outcome_explicit', 'agent_praise_complaint', 'agent_steerability'] : ['text_to_image'];
  const pages = await Promise.all(configs.map(config => page(config, signal)));
  signal.throwIfAborted();
  const base = pages[0], date = text(base.rows[0].leaderboard_publish_date);
  if (pages.some(p => p.revision !== base.revision || p.rows.some(row => row.leaderboard_publish_date !== date))) return invalid();
  const maps = pages.slice(1).map(p => new Map(p.rows.map(row => [text(row.model_name), row])));
  const rows = base.rows.slice(0, 50).map(row => {
    const common = { kind: board, rank: integer(row.rank), rankLow: null, rankHigh: null,
      model: text(row.model_name), organization: optionalText(row.organization), license: optionalText(row.license) };
    if (board === 'text-to-image') return { ...common, score: number(row.rating), scoreLower: number(row.rating_lower),
      scoreUpper: number(row.rating_upper), votes: integer(row.vote_count), preliminary: null };
    const details = maps.map(map => {
      const detail = map.get(common.model);
      if (!detail || detail.organization !== row.organization || detail.license !== row.license) return invalid();
      return metric(detail);
    });
    return { ...common, netImprovement: metric(row), confirmedSuccess: details[0], praiseVsComplaint: details[1], steerability: details[2] };
  });
  // Keep source ranks, dates, full precision and CI endpoints. The dataset does
  // not publish rank spreads, preliminary flags or distinct global sample totals.
  return parseModelSnapshot({ version: 2, board, category: 'overall', sourceUrl: BOARD_INFO[board].url,
    datasetUrl: RANKING_DATASET, datasetRevision: base.revision, datasetLicense: 'CC BY 4.0',
    dataUpdatedAt: date, capturedAt: new Date().toISOString(), totalModels: base.total, totalSamples: null, rows });
}
