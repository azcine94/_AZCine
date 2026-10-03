import { RANKING_PRICE_SOURCE } from './model-ranking-contract.ts';
import type { RankingPrice, RankingPrices, RankingRow } from './model-ranking-contract.ts';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const labs: Record<string, string> = { moonshot: 'moonshotai', zai: 'zhipuai', thinky: 'thinkingmachines' };
// Select a stable service endpoint, never the lowest price across services.
const directProviders: Record<string, string[]> = {
  anthropic: ['anthropic'], openai: ['openai'], google: ['google', 'google-vertex'],
  xai: ['xai'], deepseek: ['deepseek'], moonshot: ['moonshotai'], meta: ['meta'],
  tencent: ['tencent-tokenhub'], zai: ['zai', 'zhipuai'], xiaomi: ['xiaomi'],
  alibaba: ['alibaba', 'alibaba-cn'], stepfun: ['stepfun-ai', 'stepfun'],
  minimax: ['minimax', 'minimax-cn'], thinky: ['thinkingmachines'],
  mistral: ['mistral'], upstage: ['upstage'],
};
const thirdProviders = ['openrouter', 'deepinfra', 'togetherai', 'siliconflow', 'fireworks-ai', 'groq'];
type ObjectValue = Record<string, unknown>;
interface Canonical { id: string; name: string }
interface Candidate {
  providerId: string; providerName: string; modelId: string; name: string;
  canonicalId: string | null; input: number; output: number;
}
function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && !!value.trim() && [...value].length <= limit && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
// Reasoning settings share the underlying API model. Numeric/date versions stay
// in the identity; a generic model must not be guessed to match a dated one.
function normalize(value: string): string {
  return value.replace(/\s*\((?:max|high|xhigh|medium|low|minimal|none)\)\s*/gi, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function leaf(value: string): string { return value.slice(value.lastIndexOf('/') + 1); }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

async function request(url: string, signal: AbortSignal): Promise<ObjectValue> {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`Models.dev 请求失败（HTTP ${response.status}）。`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Models.dev 未返回价格数据。');
  const decoder = new TextDecoder(); let body = '', size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Models.dev 响应超过大小限制。');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = object(JSON.parse(body));
  if (!result || !Object.keys(result).length) throw new Error('Models.dev 数据格式不完整。');
  return result;
}

function candidates(catalog: ObjectValue): Candidate[] {
  const result: Candidate[] = [];
  for (const [providerId, raw] of Object.entries(catalog)) {
    const provider = object(raw), models = object(provider?.models);
    if (!provider || !models || !text(providerId, 150) || !text(provider.name, 150)) continue;
    for (const [modelId, rawModel] of Object.entries(models)) {
      const model = object(rawModel), cost = object(model?.cost);
      if (!model || !cost || !text(modelId, 250) || !text(model.name, 250)
        || typeof cost.input !== 'number' || !Number.isFinite(cost.input) || cost.input <= 0
        || typeof cost.output !== 'number' || !Number.isFinite(cost.output) || cost.output <= 0) continue;
      // A zero quote is not interpreted as a confirmed free API. Keep the base
      // token cost; contributor and special billing variants are not substitutes.
      if ([modelId, model.name].some(value => /(?:contributor|:peft:|:free|[-_:](?:priority|flex|batch)(?:$|[-_:]))/i.test(value))) continue;
      const canonicalId = text(model.canonical_model_id, 250) ? model.canonical_model_id : null;
      result.push({ providerId, providerName: provider.name, modelId, name: model.name,
        canonicalId, input: cost.input, output: cost.output });
    }
  }
  if (!result.length) throw new Error('Models.dev 未返回可用的输入 / 输出报价。');
  return result;
}
function match(row: RankingRow, canonicals: Canonical[], quotes: Candidate[]): RankingPrice | null {
  if (!row.organization) return null;
  const owner = row.organization.toLowerCase(), lab = labs[owner] ?? owner, target = normalize(row.model);
  const identities = canonicals.filter(model => model.id.startsWith(`${lab}/`)
    && (normalize(model.name) === target || normalize(leaf(model.id)) === target));
  if (identities.length !== 1) return null;
  const identity = identities[0], direct = directProviders[owner] ?? [];
  const matches = quotes.filter(quote => quote.canonicalId === identity.id
    || quote.canonicalId === null && direct.includes(quote.providerId)
      && (normalize(quote.name) === target || normalize(leaf(quote.modelId)) === target));
  const firstParty = matches.filter(quote => direct.includes(quote.providerId));
  const pool = firstParty.length ? firstParty : matches;
  const providers = firstParty.length ? direct : thirdProviders;
  const priority = (quote: Candidate) => { const index = providers.indexOf(quote.providerId); return index < 0 ? providers.length : index; };
  const exact = (quote: Candidate) => normalize(quote.name) === target || normalize(leaf(quote.modelId)) === target ? 0 : 1;
  pool.sort((a, b) => priority(a) - priority(b) || compare(a.providerId, b.providerId)
    || exact(a) - exact(b) || compare(a.modelId, b.modelId));
  const selected = pool[0]; if (!selected) return null;
  return { input: selected.input, output: selected.output, providerId: selected.providerId,
    providerName: selected.providerName, modelId: selected.modelId, canonicalModelId: identity.id,
    kind: firstParty.length ? 'first-party' : 'third-party' };
}

export async function fetchRankingPrices(rows: RankingRow[], signal: AbortSignal): Promise<RankingPrices> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(abort, 20_000);
  try {
    const [catalog, metadata] = await Promise.all([
      request('https://models.dev/api.json', controller.signal),
      request('https://models.dev/models.json?type=all', controller.signal),
    ]);
    controller.signal.throwIfAborted();
    const canonicals: Canonical[] = [];
    for (const [id, raw] of Object.entries(metadata)) {
      const model = object(raw);
      if (model && model.id === id && text(id, 250) && text(model.name, 250)) canonicals.push({ id, name: model.name });
    }
    if (!canonicals.length) throw new Error('Models.dev 模型标识数据不完整。');
    const quotes = candidates(catalog);
    return { sourceUrl: RANKING_PRICE_SOURCE, capturedAt: new Date().toISOString(),
      rows: rows.map(row => ({ model: row.model, price: match(row, canonicals, quotes) })) };
  } finally {
    window.clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort();
  }
}

export function retainRankingPrices(rows: RankingRow[], previous?: RankingPrices): RankingPrices {
  const prices = new Map<string, RankingPrice | null>(previous?.rows.map(item => [item.model, item.price]));
  return { sourceUrl: RANKING_PRICE_SOURCE, capturedAt: previous?.capturedAt ?? null,
    rows: rows.map(row => ({ model: row.model, price: prices.get(row.model) ?? null })) };
}
