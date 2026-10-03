import { validDate } from './workspace-contract.ts';

export const MODEL_BOARDS = ['agent', 'text-to-image'] as const;
export type ModelBoard = typeof MODEL_BOARDS[number];
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const RANKING_DATASET = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset';
export const RANKING_PRICE_SOURCE = 'https://models.dev/';
export const BOARD_INFO: Record<ModelBoard, { title: string; url: string }> = {
  agent: { title: 'Agent 综合榜', url: 'https://arena.ai/leaderboard/agent' },
  'text-to-image': { title: '文生图综合榜', url: 'https://arena.ai/leaderboard/text-to-image' },
};
export interface RankingMetric { value: number; lower: number; upper: number }
interface RankingRowBase {
  rank: number; rankLow: number | null; rankHigh: number | null;
  model: string; organization: string | null; license: string | null;
}
export interface AgentRankingRow extends RankingRowBase {
  kind: 'agent'; netImprovement: RankingMetric; confirmedSuccess: RankingMetric;
  praiseVsComplaint: RankingMetric; steerability: RankingMetric;
}
export interface ImageRankingRow extends RankingRowBase {
  kind: 'text-to-image'; score: number; scoreLower: number; scoreUpper: number; votes: number; preliminary: boolean | null;
}
export type RankingRow = AgentRankingRow | ImageRankingRow;
export interface RankingPrice {
  input: number; output: number; providerId: string; providerName: string;
  modelId: string; canonicalModelId: string; kind: 'first-party' | 'third-party';
}
export interface RankingPrices {
  sourceUrl: typeof RANKING_PRICE_SOURCE; capturedAt: string | null;
  rows: { model: string; price: RankingPrice | null }[];
}
export interface ModelSnapshot {
  version: 2; board: ModelBoard; category: 'overall'; sourceUrl: string;
  datasetUrl: string; datasetRevision: string; datasetLicense: 'CC BY 4.0';
  dataUpdatedAt: string; capturedAt: string;
  totalModels: number; totalSamples: number | null; rows: RankingRow[];
  // Optional extension preserves existing snapshots and their content hashes.
  pricing?: RankingPrices;
}
export interface ModelBoardState {
  board: ModelBoard; snapshotId: string | null; savedAt: string | null;
  snapshot: ModelSnapshot | null;
  sourceCheck: { day: string | null; attemptedAt: string | null };
  error: { code: string; message: string } | null;
}

function invalid(): never {
  throw new Error('快照格式或字段不完整，需要对应 Overall 榜官方原序的完整 50 行；已保存榜单未改变。');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !(key in value))) invalid();
}
function text(value: unknown, limit = 250): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return invalid();
  return value;
}
function optionalText(value: unknown, limit: number): string | null { return value === null ? null : text(value, limit); }
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
  return value;
}
function integer(value: unknown, min = 0): number {
  const result = number(value);
  if (!Number.isSafeInteger(result) || result < min) return invalid();
  return result;
}
function board(value: unknown): ModelBoard { return value === 'agent' || value === 'text-to-image' ? value : invalid(); }
function metric(value: unknown): RankingMetric {
  const v = object(value); keys(v, ['value', 'lower', 'upper']);
  const result = { value: number(v.value), lower: number(v.lower), upper: number(v.upper) };
  if (result.lower > result.value || result.value > result.upper) return invalid();
  return result;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return invalid();
  return value;
}
function date(value: unknown): string { return typeof value === 'string' && validDate(value) ? value : invalid(); }

function parsePrices(value: unknown, rows: RankingRow[], selected: ModelBoard): RankingPrices {
  const v = object(value); keys(v, ['sourceUrl', 'capturedAt', 'rows']);
  if (selected !== 'agent' || v.sourceUrl !== RANKING_PRICE_SOURCE || !Array.isArray(v.rows) || v.rows.length !== rows.length) return invalid();
  const capturedAt = v.capturedAt === null ? null : timestamp(v.capturedAt);
  const prices = v.rows.map((raw, index) => {
    const item = object(raw); keys(item, ['model', 'price']);
    if (item.model !== rows[index].model) return invalid();
    if (item.price === null) return { model: rows[index].model, price: null };
    const p = object(item.price);
    keys(p, ['input', 'output', 'providerId', 'providerName', 'modelId', 'canonicalModelId', 'kind']);
    const input = number(p.input), output = number(p.output);
    if (capturedAt === null || input <= 0 || output <= 0 || (p.kind !== 'first-party' && p.kind !== 'third-party')) return invalid();
    return { model: rows[index].model, price: { input, output, providerId: text(p.providerId, 150), providerName: text(p.providerName, 150),
      modelId: text(p.modelId, 250), canonicalModelId: text(p.canonicalModelId, 250), kind: p.kind } as RankingPrice };
  });
  return { sourceUrl: RANKING_PRICE_SOURCE, capturedAt, rows: prices };
}

export function parseModelSnapshot(value: unknown): ModelSnapshot {
  const v = object(value);
  keys(v, ['version', 'board', 'category', 'sourceUrl', 'datasetUrl', 'datasetRevision', 'datasetLicense', 'dataUpdatedAt', 'capturedAt', 'totalModels', 'totalSamples', 'rows', ...('pricing' in v ? ['pricing'] : [])]);
  const selected = board(v.board);
  if (v.version !== 2 || v.category !== 'overall' || v.sourceUrl !== BOARD_INFO[selected].url || v.datasetUrl !== RANKING_DATASET
    || typeof v.datasetRevision !== 'string' || !/^[0-9a-f]{40}$/.test(v.datasetRevision) || v.datasetLicense !== 'CC BY 4.0'
    || !Array.isArray(v.rows) || v.rows.length !== 50) return invalid();
  const totalModels = integer(v.totalModels, 50);
  const baseKeys = ['kind', 'rank', 'rankLow', 'rankHigh', 'model', 'organization', 'license'];
  const rows = v.rows.map((raw): RankingRow => {
    const r = object(raw);
    if (r.kind !== selected) return invalid();
    keys(r, [...baseKeys, ...(selected === 'agent' ? ['netImprovement', 'confirmedSuccess', 'praiseVsComplaint', 'steerability'] : ['score', 'scoreLower', 'scoreUpper', 'votes', 'preliminary'])]);
    const base = { rank: integer(r.rank, 1), rankLow: r.rankLow === null ? null : integer(r.rankLow, 1), rankHigh: r.rankHigh === null ? null : integer(r.rankHigh, 1),
      model: text(r.model), organization: optionalText(r.organization, 150), license: optionalText(r.license, 150) };
    if (base.rank > 50 || (base.rankLow === null) !== (base.rankHigh === null)
      || base.rankLow !== null && base.rankHigh !== null && (base.rankLow > base.rankHigh || base.rankHigh > totalModels)) return invalid();
    if (selected === 'agent') return { ...base, kind: 'agent', netImprovement: metric(r.netImprovement), confirmedSuccess: metric(r.confirmedSuccess), praiseVsComplaint: metric(r.praiseVsComplaint), steerability: metric(r.steerability) };
    if (r.preliminary !== null && typeof r.preliminary !== 'boolean') return invalid();
    const score = number(r.score), scoreLower = number(r.scoreLower), scoreUpper = number(r.scoreUpper);
    if (scoreLower > score || score > scoreUpper) return invalid();
    return { ...base, kind: 'text-to-image', score, scoreLower, scoreUpper, votes: integer(r.votes), preliminary: r.preliminary };
  });
  if (rows[0].rank !== 1 || new Set(rows.map(row => row.model)).size !== 50 || rows.some((row, index) => index > 0 && row.rank < rows[index - 1].rank)) return invalid();
  return { version: 2, board: selected, category: 'overall', sourceUrl: BOARD_INFO[selected].url,
    datasetUrl: RANKING_DATASET, datasetRevision: v.datasetRevision, datasetLicense: 'CC BY 4.0',
    dataUpdatedAt: date(v.dataUpdatedAt), capturedAt: timestamp(v.capturedAt), totalModels,
    totalSamples: v.totalSamples === null ? null : integer(v.totalSamples), rows,
    ...('pricing' in v ? { pricing: parsePrices(v.pricing, rows, selected) } : {}) };
}
export function parseModelBoardState(value: unknown): ModelBoardState {
  const v = object(value); keys(v, ['board', 'snapshotId', 'savedAt', 'snapshot', 'sourceCheck', 'error']);
  const selected = board(v.board);
  const snapshot = v.snapshot === null ? null : parseModelSnapshot(v.snapshot);
  const snapshotId = v.snapshotId === null ? null : text(v.snapshotId);
  const savedAt = v.savedAt === null ? null : timestamp(v.savedAt);
  if (snapshotId !== null && !/^[0-9a-f]{64}$/.test(snapshotId) || snapshot !== null && snapshot.board !== selected
    || (snapshot === null) !== (snapshotId === null) || (snapshot === null) !== (savedAt === null)) return invalid();
  const c = object(v.sourceCheck); keys(c, ['day', 'attemptedAt']);
  const sourceCheck = { day: c.day === null ? null : date(c.day), attemptedAt: c.attemptedAt === null ? null : timestamp(c.attemptedAt) };
  if ((sourceCheck.day === null) !== (sourceCheck.attemptedAt === null)) return invalid();
  const e = v.error === null ? null : object(v.error);
  const error = e ? { code: text(e.code), message: text(e.message, 1000) } : null;
  return { board: selected, snapshotId, savedAt, snapshot, sourceCheck, error };
}
export function parseModelBoards(value: unknown): Record<ModelBoard, ModelBoardState> {
  if (!Array.isArray(value) || value.length !== 2) return invalid();
  const rows = value.map(parseModelBoardState);
  const agent = rows.find(row => row.board === 'agent');
  const image = rows.find(row => row.board === 'text-to-image');
  if (!agent || !image) return invalid();
  return { agent, 'text-to-image': image };
}
export function emptyModelBoards(): Record<ModelBoard, ModelBoardState> {
  const empty = (board: ModelBoard): ModelBoardState => ({ board, snapshotId: null, savedAt: null, snapshot: null, sourceCheck: { day: null, attemptedAt: null }, error: null });
  return { agent: empty('agent'), 'text-to-image': empty('text-to-image') };
}
export function beijingDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
export function rankingTime(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}
