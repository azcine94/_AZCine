import { parseThinkingMap } from './pi-thinking.ts';
import type { ThinkingLevelMap } from './pi-thinking.ts';
export interface PiModel {
  id: string;
  name: string;
  provider: string;
  api: string;
  input: ('text' | 'image')[];
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  contextWindow: number;
  maxTokens: number;
}

export interface PiState {
  sessionId: string;
  sessionFile: string | null;
  sessionName: string | null;
  model: PiModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
  messageCount: number;
}

export type PromptDisposition = 'started' | 'queued' | 'handled';

const INVALID_DATA = 'Pi 返回的数据格式无效，请重新读取后核对。';

function invalidData(): never {
  throw new Error(INVALID_DATA);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown, maxCodePoints: number): string {
  if (
    typeof value !== 'string'
    || value.length > maxCodePoints * 2
    || !hasText(value)
    || [...value].length > maxCodePoints
  ) {
    invalidData();
  }

  // 校验不改变原文，也不将不同身份通过 trim 合并。
  return value;
}

function optionalString(value: unknown, maxCodePoints: number): string | null {
  return value === undefined || value === null
    ? null
    : stringValue(value, maxCodePoints);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidData();
  return value;
}

function integerValue(value: unknown, minimum: number): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
  ) {
    invalidData();
  }
  return value;
}

function isUnconfiguredModel(value: unknown): boolean {
  return isRecord(value)
    && value.id === 'unknown'
    && value.provider === 'unknown'
    && value.api === 'unknown'
    && value.baseUrl === ''
    && value.reasoning === false
    && Array.isArray(value.input)
    && value.input.length === 0
    && value.contextWindow === 0
    && value.maxTokens === 0;
}

export function parsePiModel(value: unknown): PiModel {
  if (!isRecord(value)) invalidData();

  const rawInput = value.input;
  if (!Array.isArray(rawInput)) invalidData();

  const input: PiModel['input'] = [];
  // for...of 同时拒绝稀疏数组中的空位，不用会跳过空位的 every/map。
  for (const kind of rawInput) {
    if (kind !== 'text' && kind !== 'image') invalidData();
    input.push(kind);
  }

  // 白名单重建；不回传 apiKey、headers、baseUrl、cost 等扩展字段。
  return {
    id: stringValue(value.id, 1000),
    name: stringValue(value.name, 2000),
    provider: stringValue(value.provider, 1000),
    api: stringValue(value.api, 1000),
    input,
    reasoning: booleanValue(value.reasoning),
    ...(value.thinkingLevelMap === undefined ? {} : {thinkingLevelMap: parseThinkingMap(value.thinkingLevelMap)}),
    contextWindow: integerValue(value.contextWindow, 1),
    maxTokens: integerValue(value.maxTokens, 1),
  };
}

export function parsePiModels(value: unknown): PiModel[] {
  if (!isRecord(value)) invalidData();

  const rawModels = value.models;
  if (!Array.isArray(rawModels)) invalidData();

  const models: PiModel[] = [];
  const identities = new Set<string>();

  for (const rawModel of rawModels) {
    const model = parsePiModel(rawModel);
    // JSON 元组避免 provider/id 自身含分隔符时发生键碰撞。
    const identity = JSON.stringify([model.provider, model.id]);
    if (identities.has(identity)) invalidData();
    identities.add(identity);
    models.push(model);
  }

  return models;
}

export function parsePiState(value: unknown): PiState {
  if (!isRecord(value)) invalidData();

  let model: PiModel | null = null;
  if (
    value.model !== undefined
    && value.model !== null
    && !isUnconfiguredModel(value.model)
  ) {
    model = parsePiModel(value.model);
  }

  return {
    sessionId: stringValue(value.sessionId, 200),
    sessionFile: optionalString(value.sessionFile, 32767),
    sessionName: optionalString(value.sessionName, 1000),
    model,
    thinkingLevel: stringValue(value.thinkingLevel, 50),
    isStreaming: booleanValue(value.isStreaming),
    isCompacting: booleanValue(value.isCompacting),
    pendingMessageCount: integerValue(value.pendingMessageCount, 0),
    messageCount: integerValue(value.messageCount, 0),
  };
}

export function parsePromptDisposition(value: unknown): PromptDisposition {
  if (!isRecord(value)) invalidData();

  const disposition = value.disposition;
  if (
    disposition !== 'started'
    && disposition !== 'queued'
    && disposition !== 'handled'
  ) {
    invalidData();
  }

  return disposition;
}

export function replyMatches(
  value: unknown,
  id: string,
  command: string,
): boolean {
  // success:false 也是匹配的响应；拒绝原因由调用方继续处理。
  return hasText(id)
    && hasText(command)
    && isRecord(value)
    && value.type === 'response'
    && value.id === id
    && value.command === command
    && typeof value.success === 'boolean';
}

/**
 * 仅分类最后一条 assistant 消息。
 * 调用方仍须等 agent_settled，不能据此提前结束整轮任务。
 */
export function assistantOutcome(
  message: unknown,
): 'success' | 'error' | 'interrupted' | 'incomplete' {
  if (!isRecord(message) || message.role !== 'assistant') {
    return 'incomplete';
  }

  if (message.stopReason === 'aborted') return 'interrupted';

  const errorMessage = message.errorMessage;
  // 非空错误字符串即视为错误，包括只含空白的错误字符串。
  if (
    message.stopReason === 'error'
    || (typeof errorMessage === 'string' && errorMessage.length > 0)
  ) {
    return 'error';
  }

  // 错误字段类型异常时也不能假报成功。
  if (
    errorMessage !== undefined
    && errorMessage !== null
    && typeof errorMessage !== 'string'
  ) {
    return 'incomplete';
  }

  if (message.stopReason !== 'stop' || !Array.isArray(message.content)) {
    return 'incomplete';
  }

  const hasAnswer = message.content.some(
    block => isRecord(block)
      && block.type === 'text'
      && hasText(block.text),
  );

  return hasAnswer ? 'success' : 'incomplete';
}
