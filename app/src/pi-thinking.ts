export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = typeof thinkingLevels[number];
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;
export const thinkingLabels: Record<ThinkingLevel, string> = { off: '关闭', minimal: '最低', low: '低', medium: '标准', high: '高', xhigh: '超高', max: '最大' };

export function supportedThinkingLevels(model: { reasoning: boolean; thinkingLevelMap?: ThinkingLevelMap }) {
  if (!model.reasoning) return ['off'] as ThinkingLevel[];
  return thinkingLevels.filter(level => model.thinkingLevelMap?.[level] !== null && (!(level === 'xhigh' || level === 'max') || model.thinkingLevelMap?.[level] !== undefined));
}

export function parseThinkingMap(value: unknown): ThinkingLevelMap | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('模型推理档位格式无效，原配置保留。');
  const result: ThinkingLevelMap = {};
  for (const [key, mapping] of Object.entries(value)) {
    if (!thinkingLevels.includes(key as ThinkingLevel) || mapping !== null && (typeof mapping !== 'string' || mapping.length > 100 || /[\u0000-\u001f]/.test(mapping))) throw new Error('模型推理档位格式无效，原配置保留。');
    result[key as ThinkingLevel] = mapping as string | null;
  }
  return result;
}

export function defaultThinkingMap(): ThinkingLevelMap {
  return { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
}
