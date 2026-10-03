import { assistantOutcome } from './pi-contract.ts';

export interface MessagePart {
  kind: 'text' | 'thinking' | 'image' | 'toolCall' | 'unknown';
  text: string;
  title?: string;
}

export interface MessageView {
  role: string;
  title: string;
  parts: MessagePart[];
  status:
    | 'plain'
    | 'streaming'
    | 'success'
    | 'error'
    | 'interrupted'
    | 'incomplete';
  error: string | null;
  toolCallId: string | null;
  toolName: string | null;
}

interface Projection {
  parts: MessagePart[];
  valid: boolean;
}

type ContentMode = 'ordinary' | 'assistant' | 'toolResult';

const UNKNOWN_MESSAGE = '未识别的消息，无法展示。';
const UNKNOWN_BLOCK = '未识别的内容块。';
const INVALID_MESSAGE = '消息展示字段不完整或格式无效。';
const INVALID_ERROR = '错误信息格式无效，无法展示。';
const ASSISTANT_ERROR = '助手返回错误，未提供错误说明。';
const TOOL_ERROR = '工具执行失败，未提供错误说明。';
const INVALID_ARGUMENTS = '工具参数无法序列化为 JSON。';

// 只展示媒体类型，不允许把 data URL 或任意长载荷伪装成 MIME 类型。
const MIME_TYPE =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unknownPart(text = UNKNOWN_BLOCK): MessagePart {
  return { kind: 'unknown', text };
}

function unknownProjection(): Projection {
  return { parts: [unknownPart()], valid: false };
}

function createView(role: string, title: string): MessageView {
  return {
    role,
    title,
    parts: [],
    status: 'plain',
    error: null,
    toolCallId: null,
    toolName: null,
  };
}

function unknownView(): MessageView {
  return {
    role: 'unknown',
    title: '未识别消息',
    parts: [unknownPart(UNKNOWN_MESSAGE)],
    status: 'incomplete',
    error: INVALID_MESSAGE,
    toolCallId: null,
    toolName: null,
  };
}

function imageProjection(block: Record<string, unknown>): Projection {
  const mimeType = block.mimeType;

  if (
    typeof mimeType !== 'string'
    || mimeType.length > 255
    || !MIME_TYPE.test(mimeType)
  ) {
    return {
      parts: [{
        kind: 'image',
        title: '图片',
        text: '图片（媒体类型未识别；未展示图片数据）',
      }],
      valid: false,
    };
  }

  // 不读取 data；该字段可能已经在 Rust 侧被移除或脱敏。
  return {
    parts: [{
      kind: 'image',
      title: '图片',
      text: `图片（${mimeType}；未展示图片数据）`,
    }],
    valid: true,
  };
}

function toolCallProjection(block: Record<string, unknown>): Projection {
  if (
    !hasText(block.id)
    || !hasText(block.name)
    || !isRecord(block.arguments)
  ) {
    return unknownProjection();
  }

  try {
    // 参数只作为 JSON 数据展示，不作为命令、代码或 HTML 执行。
    const text = JSON.stringify(block.arguments);
    if (typeof text === 'string') {
      return {
        parts: [{
          kind: 'toolCall',
          title: block.name,
          text,
        }],
        valid: true,
      };
    }
  } catch {
    // 循环引用、BigInt 等非 JSON 输入不应使整段会话展示失败。
  }

  return {
    parts: [{
      kind: 'toolCall',
      title: block.name,
      text: INVALID_ARGUMENTS,
    }],
    valid: false,
  };
}

function blockProjection(value: unknown, mode: ContentMode): Projection {
  if (!isRecord(value)) return unknownProjection();

  if (value.type === 'text' && typeof value.text === 'string') {
    return {
      parts: [{ kind: 'text', text: value.text }],
      valid: true,
    };
  }

  if (value.type === 'image' && mode !== 'assistant') {
    return imageProjection(value);
  }

  if (value.type === 'thinking' && mode === 'assistant') {
    if (
      typeof value.thinking !== 'string'
      || (
        value.redacted !== undefined
        && typeof value.redacted !== 'boolean'
      )
    ) {
      return unknownProjection();
    }

    return {
      parts: [{
        kind: 'thinking',
        title: value.redacted === true ? '思考（已遮蔽）' : '思考',
        text: value.thinking,
      }],
      valid: true,
    };
  }

  if (value.type === 'toolCall' && mode === 'assistant') {
    return toolCallProjection(value);
  }

  return unknownProjection();
}

function contentProjection(value: unknown, mode: ContentMode): Projection {
  if (typeof value === 'string' && mode === 'ordinary') {
    return {
      parts: [{ kind: 'text', text: value }],
      valid: true,
    };
  }

  if (!Array.isArray(value)) return unknownProjection();

  const parts: MessagePart[] = [];
  let valid = true;

  // for...of 不会静默跳过稀疏数组的空位。
  for (const block of value) {
    const projected = blockProjection(block, mode);
    parts.push(...projected.parts);
    if (!projected.valid) valid = false;
  }

  return { parts, valid };
}

function applyProjection(view: MessageView, projection: Projection): void {
  view.parts = projection.parts;
  if (!projection.valid) {
    view.status = 'incomplete';
    view.error = INVALID_MESSAGE;
  }
}

function assistantView(message: Record<string, unknown>): MessageView {
  const view = createView('assistant', '助手');
  const projection = contentProjection(message.content, 'assistant');
  const outcome = assistantOutcome(message);
  const errorMessage = message.errorMessage;
  const invalidError = errorMessage !== undefined
    && errorMessage !== null
    && typeof errorMessage !== 'string';

  view.parts = projection.parts;
  view.status = outcome;

  // success 只说明这一条消息有完整回答，不说明整轮任务结束。
  // 整轮完成仍由调用方等 agent_settled。
  if (outcome === 'error' || outcome === 'interrupted') {
    if (typeof errorMessage === 'string' && errorMessage.length > 0) {
      view.error = errorMessage;
    } else if (invalidError) {
      view.error = INVALID_ERROR;
    } else if (outcome === 'error') {
      view.error = ASSISTANT_ERROR;
    }

    // 保留真实错误/中断终态，未知内容块仍在 parts 中明确标识。
    return view;
  }

  if (!projection.valid || invalidError) {
    view.status = 'incomplete';
    view.error = invalidError ? INVALID_ERROR : INVALID_MESSAGE;
    return view;
  }

  if (message.stopReason === 'pending') {
    view.status = 'streaming';
  }

  return view;
}

function toolResultView(message: Record<string, unknown>): MessageView {
  const view = createView('toolResult', '工具结果');
  const projection = contentProjection(message.content, 'toolResult');

  view.parts = projection.parts;
  view.toolCallId = hasText(message.toolCallId) ? message.toolCallId : null;
  view.toolName = hasText(message.toolName) ? message.toolName : null;

  if (view.toolName !== null) {
    view.title = `工具结果：${view.toolName}`;
  }

  if (
    !projection.valid
    || view.toolCallId === null
    || view.toolName === null
    || typeof message.isError !== 'boolean'
  ) {
    view.status = 'incomplete';
    view.error = INVALID_MESSAGE;
    return view;
  }

  view.status = message.isError ? 'error' : 'success';
  if (message.isError) {
    const text = toolResultText(message);
    view.error = text.trim().length > 0 ? text : TOOL_ERROR;
  }

  return view;
}

function bashView(message: Record<string, unknown>): MessageView {
  const view = createView('bashExecution', '直接 Bash 执行（非模型工具）');
  const commandValid = typeof message.command === 'string';
  const outputValid = typeof message.output === 'string';
  const cancelledValid = typeof message.cancelled === 'boolean';
  const truncatedValid = typeof message.truncated === 'boolean';
  const exitCode = message.exitCode;
  const exitCodePresent = typeof exitCode === 'number'
    && Number.isSafeInteger(exitCode);
  const exitCodeValid = exitCode === undefined || exitCodePresent;

  view.parts = [
    commandValid
      ? { kind: 'text', title: '命令', text: message.command as string }
      : unknownPart('命令字段格式无效。'),
    outputValid
      ? { kind: 'text', title: '输出', text: message.output as string }
      : unknownPart('输出字段格式无效。'),
    {
      kind: 'text',
      title: '执行标识',
      text: [
        `退出码：${exitCodePresent ? String(exitCode) : '未提供或无效'}`,
        `已取消：${cancelledValid ? (message.cancelled ? '是' : '否') : '未知'}`,
        `输出已截断：${truncatedValid ? (message.truncated ? '是' : '否') : '未知'}`,
      ].join('\n'),
    },
  ];

  if (
    !commandValid
    || !outputValid
    || !cancelledValid
    || !truncatedValid
    || !exitCodeValid
  ) {
    view.status = 'incomplete';
    view.error = INVALID_MESSAGE;
  } else if (message.cancelled) {
    view.status = 'interrupted';
  } else if (!exitCodePresent) {
    view.status = 'incomplete';
  } else if (exitCode === 0) {
    view.status = 'success';
  } else {
    view.status = 'error';
    view.error = `命令执行失败（退出码 ${exitCode}）。`;
  }

  return view;
}

function customView(message: Record<string, unknown>): MessageView {
  const view = createView('custom', '自定义消息');
  applyProjection(view, contentProjection(message.content, 'ordinary'));

  if (hasText(message.customType)) {
    view.title = message.display === false
      ? `自定义消息（默认折叠）：${message.customType}`
      : `自定义消息：${message.customType}`;
  }

  if (
    !hasText(message.customType)
    || typeof message.display !== 'boolean'
  ) {
    view.status = 'incomplete';
    view.error = INVALID_MESSAGE;
  }

  // display=false 只在标题提供折叠提示，不丢弃历史正文。
  return view;
}

function summaryView(
  message: Record<string, unknown>,
  role: 'branchSummary' | 'compactionSummary',
): MessageView {
  const view = createView(
    role,
    role === 'branchSummary' ? '分支摘要' : '上下文压缩摘要',
  );

  if (typeof message.summary === 'string') {
    view.parts = [{ kind: 'text', title: '摘要', text: message.summary }];
  } else {
    view.parts = [unknownPart('摘要字段格式无效。')];
    view.status = 'incomplete';
    view.error = INVALID_MESSAGE;
  }

  return view;
}

/**
 * 输入应为 Rust 已脱敏的完整消息或当前 partial message。
 * 只投影展示字段；不验证模型计费元数据，不重建会话或处理 delta。
 * 输出字符串只能交给文本节点，不能作为 HTML 或可执行链接使用。
 */
export function messageView(value: unknown): MessageView {
  try {
    if (!isRecord(value)) return unknownView();

    switch (value.role) {
      case 'user':
      case 'system': {
        const view = createView(
          value.role,
          value.role === 'user' ? '用户' : '系统',
        );
        applyProjection(view, contentProjection(value.content, 'ordinary'));
        return view;
      }
      case 'assistant':
        return assistantView(value);
      case 'toolResult':
        return toolResultView(value);
      case 'bashExecution':
        return bashView(value);
      case 'custom':
        return customView(value);
      case 'branchSummary':
      case 'compactionSummary':
        return summaryView(value, value.role);
      default:
        // 不把未知 role 或整个原对象复制进展示模型。
        return unknownView();
    }
  } catch {
    // 防御非 JSON 的损坏调用输入；异常对象本身不进入展示结果。
    return unknownView();
  }
}

/**
 * 同时接受 ToolResultMessage 或原生工具结果 { content, details? }。
 * 不读取 details、headers、图片 data 或任何 signature。
 */
export function toolResultText(value: unknown): string {
  try {
    if (
      !isRecord(value)
      || (value.role !== undefined && value.role !== 'toolResult')
    ) {
      return UNKNOWN_BLOCK;
    }

    return contentProjection(value.content, 'toolResult')
      .parts
      .map(part => part.text)
      .join('\n');
  } catch {
    return UNKNOWN_BLOCK;
  }
}
