import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantOutcome } from '../src/pi-contract.ts';
import {
  messageView,
  toolResultText,
} from '../src/pi-messages.ts';
import type { MessageView } from '../src/pi-messages.ts';

const BODY = ' 中文🙂e\u0301\u2028第二行\u2029末尾\n'
  + '<script>alert("fixture")</script>'
  + '<a href="javascript:fixture()">链接原文</a> ';

const HIDDEN = 'fixture-private-metadata-not-for-display';

function assistant(
  stopReason: unknown = 'stop',
  content: unknown = [{ type: 'text', text: '回答' }],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'fixture-provider',
    model: 'fixture-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    timestamp: 1790985600000,
    ...extra,
  };
}

function toolResult(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text: '工具输出' }],
    isError: false,
    timestamp: 1790985600000,
    ...extra,
  };
}

function bashExecution(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: 'bashExecution',
    command: 'echo fixture',
    output: 'fixture\n',
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 1790985600000,
    ...extra,
  };
}

function assertNoHidden(value: unknown): void {
  assert.equal(JSON.stringify(value).includes(HIDDEN), false);
}

function assertViewShape(view: MessageView): void {
  assert.deepEqual(Object.keys(view).sort(), [
    'error',
    'parts',
    'role',
    'status',
    'title',
    'toolCallId',
    'toolName',
  ]);
  for (const part of view.parts) {
    assert.equal(typeof part.text, 'string');
    assert.ok(
      Object.keys(part).every(
        key => key === 'kind' || key === 'text' || key === 'title' || (key === 'callId' && part.kind === 'toolCall'),
      ),
    );
  }
}

test('Given 中文、Unicode 与 HTML 原文，When 投影，Then 文本逐字保留而不转为 HTML', () => {
  for (const role of ['user', 'system']) {
    const view = messageView({ role, content: BODY });
    assert.equal(view.status, 'plain');
    assert.deepEqual(view.parts, [{ kind: 'text', text: BODY }]);
    assertViewShape(view);
  }

  const view = messageView(assistant('stop', [{ type: 'text', text: BODY }]));
  assert.equal(view.status, 'success');
  assert.equal(view.parts[0].text, BODY);
});

test('Given 用户或系统的 text/image 块，When 投影，Then 保持顺序且图片只展示媒体类型', () => {
  for (const role of ['user', 'system']) {
    const view = messageView({
      role,
      content: [
        { type: 'text', text: '前' },
        { type: 'image', mimeType: 'image/png', data: HIDDEN },
        { type: 'text', text: '后' },
      ],
    });

    assert.equal(view.status, 'plain');
    assert.deepEqual(view.parts.map(part => part.kind), [
      'text', 'image', 'text',
    ]);
    assert.equal(view.parts[0].text, '前');
    assert.equal(view.parts[1].text, '图片（image/png；未展示图片数据）');
    assert.equal(view.parts[2].text, '后');
    assertNoHidden(view);
  }
});

test('Given 图片 data 已由 Rust 移除，When 投影，Then 仍能显示 MIME 占位而不索取载荷', () => {
  const view = messageView({
    role: 'user',
    content: [{ type: 'image', mimeType: 'image/webp' }],
  });

  assert.equal(view.status, 'plain');
  assert.equal(view.parts[0].kind, 'image');
  assert.match(view.parts[0].text, /image\/webp/);
});

test('Given 无效或伪装为 data URL 的 MIME，When 投影，Then 不透传载荷且状态不完整', () => {
  for (const mimeType of [
    null,
    42,
    '',
    `data:image/png;base64,${HIDDEN}`,
    `image/png\n${HIDDEN}`,
    'image/' + 'x'.repeat(256),
  ]) {
    const message = {
      role: 'user',
      content: [{ type: 'image', mimeType, data: HIDDEN }],
    };
    const view = messageView(message);

    assert.equal(view.status, 'incomplete');
    assert.match(view.parts[0].text, /媒体类型未识别/);
    assertNoHidden(view);
    assertNoHidden(toolResultText({ content: message.content }));
  }
});

test('Given 非展示元数据与签名，When 投影，Then 仅返回白名单字段', () => {
  const views = [
    messageView({
      role: 'system',
      content: [{ type: 'text', text: '系统正文', textSignature: HIDDEN }],
      sections: { hidden: HIDDEN },
      toolsAdded: [{ name: HIDDEN }],
      toolsRemoved: [{ name: HIDDEN }],
      headers: { authorization: HIDDEN },
      apiKey: HIDDEN,
    }),
    messageView(assistant('stop', [
      { type: 'text', text: '回答', textSignature: HIDDEN },
      {
        type: 'thinking',
        thinking: '可见思考',
        thinkingSignature: HIDDEN,
      },
      {
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: { path: 'fixture.txt' },
        namespace: HIDDEN,
        thoughtSignature: HIDDEN,
        headers: { authorization: HIDDEN },
      },
    ], {
      diagnostics: [{ raw: HIDDEN }],
      responseId: HIDDEN,
      providerThinkingLevel: HIDDEN,
      rawStopReason: HIDDEN,
      deferred: { data: HIDDEN },
      headers: { authorization: HIDDEN },
      apiKey: HIDDEN,
    })),
    messageView(toolResult({
      details: { headers: { authorization: HIDDEN } },
      usage: { raw: HIDDEN },
      errorMessage: HIDDEN,
    })),
  ];

  for (const view of views) {
    assertViewShape(view);
    assertNoHidden(view);
  }
});

test('Given pending 空快照或当前正文，When 投影，Then 为 streaming 而非 success', () => {
  for (const content of [[], [{ type: 'text', text: '当前部分回答' }]]) {
    const view = messageView(assistant('pending', content));
    assert.equal(view.status, 'streaming');
    assert.equal(view.error, null);
  }
});

test('Given 官方终止原因，When 投影，Then 复用 assistantOutcome 且不推断整轮成功', () => {
  const cases: Array<[string, MessageView['status']]> = [
    ['stop', 'success'],
    ['error', 'error'],
    ['aborted', 'interrupted'],
    ['length', 'incomplete'],
    ['toolUse', 'incomplete'],
    ['deferred', 'incomplete'],
    ['future-stop-reason', 'incomplete'],
  ];

  for (const [reason, expected] of cases) {
    const message = assistant(reason);
    assert.equal(messageView(message).status, expected, reason);
    assert.equal(messageView(message).status, assistantOutcome(message), reason);
  }
});

test('Given 空回答、纯空白或仅 thinking，When stop，Then 不冒称完整回答成功', () => {
  for (const content of [
    [],
    [{ type: 'text', text: '' }],
    [{ type: 'text', text: ' \n\t' }],
    [{ type: 'thinking', thinking: '仅思考，没有回答' }],
  ]) {
    assert.equal(messageView(assistant('stop', content)).status, 'incomplete');
  }
});

test('Given assistant 错误正文，When 投影，Then 字符串保持原文且未知对象不透传', () => {
  const explicit = messageView(assistant('error', [], { errorMessage: BODY }));
  assert.equal(explicit.status, 'error');
  assert.equal(explicit.error, BODY);

  const reported = messageView(assistant('stop', undefined, {
    errorMessage: ' \n',
  }));
  assert.equal(reported.status, 'error');
  assert.equal(reported.error, ' \n');

  const missing = messageView(assistant('error', []));
  assert.equal(missing.error, '助手返回错误，未提供错误说明。');

  const malformed = messageView(assistant('error', [], {
    errorMessage: { headers: HIDDEN },
  }));
  assert.equal(malformed.status, 'error');
  assert.equal(malformed.error, '错误信息格式无效，无法展示。');
  assertNoHidden(malformed);
});

test('Given pending/stop 的错误字段损坏，When 投影，Then 不猜流式或成功', () => {
  for (const stopReason of ['pending', 'stop']) {
    const view = messageView(assistant(stopReason, [], {
      errorMessage: { raw: HIDDEN },
    }));

    assert.equal(view.status, 'incomplete');
    assert.equal(view.error, '错误信息格式无效，无法展示。');
    assertNoHidden(view);
  }

  const pendingError = messageView(assistant('pending', [], {
    errorMessage: '已报告错误',
  }));
  assert.equal(pendingError.status, 'error');
  assert.equal(pendingError.error, '已报告错误');
});

test('Given aborted 和已有正文，When 投影，Then 保留内容并优先显示中断', () => {
  const view = messageView(assistant('aborted', [
    { type: 'text', text: '停止前的正文' },
  ], { errorMessage: '用户已取消' }));

  assert.equal(view.status, 'interrupted');
  assert.equal(view.parts[0].text, '停止前的正文');
  assert.equal(view.error, '用户已取消');
});

test('Given 已遮蔽 thinking，When 投影，Then 标记遮蔽且不展示签名', () => {
  const view = messageView(assistant('pending', [{
    type: 'thinking',
    thinking: '',
    redacted: true,
    thinkingSignature: HIDDEN,
  }]));

  assert.equal(view.status, 'streaming');
  assert.deepEqual(view.parts, [{
    kind: 'thinking',
    title: '思考（已遮蔽）',
    text: '思考内容已遮蔽。',
  }]);
  assertNoHidden(view);
});

test('Given 复杂工具参数，When 投影，Then 只用 JSON 数据字符串且不混入调用元数据', () => {
  const args = {
    command: 'echo "<script>fixture</script>"',
    nested: { text: BODY, enabled: true, count: 2 },
    list: ['中文', null, { id: 1 }],
  };

  const view = messageView(assistant('toolUse', [{
    type: 'toolCall',
    id: 'call-1',
    name: 'bash',
    arguments: args,
    thoughtSignature: HIDDEN,
  }]));

  assert.equal(view.status, 'incomplete');
  assert.deepEqual(view.parts, [{
    kind: 'toolCall',
    title: 'bash',
    callId: 'call-1',
    text: JSON.stringify(args),
  }]);
  assert.deepEqual(JSON.parse(view.parts[0].text), args);
  // 单条 assistant 可含多个调用，不伪造消息级唯一 toolCallId。
  assert.equal(view.toolCallId, null);
  assert.equal(view.toolName, null);
  assertNoHidden(view);
});

test('Given 循环或 BigInt 工具参数，When 投影，Then 固定提示且不抛出或猜成功', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;

  for (const args of [cycle, { value: 1n }]) {
    const view = messageView(assistant('stop', [
      { type: 'text', text: '回答' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: args },
    ]));

    assert.equal(view.status, 'incomplete');
    assert.equal(view.parts[1].kind, 'toolCall');
    assert.equal(view.parts[1].text, '工具参数无法序列化为 JSON。');
  }
});

test('Given 非对象参数或缺少工具标识，When 投影，Then 未识别而不 stringify 任意结构', () => {
  for (const block of [
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: HIDDEN },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: [] },
    { type: 'toolCall', id: '', name: 'read', arguments: {} },
    { type: 'toolCall', id: 'call-1', name: null, arguments: {} },
  ]) {
    const view = messageView(assistant('stop', [
      { type: 'text', text: '回答' },
      block,
    ]));

    assert.equal(view.status, 'incomplete');
    assert.equal(view.parts[1].kind, 'unknown');
    assertNoHidden(view);
  }
});

test('Given 成功工具结果，When 投影，Then 保留关联 ID、工具名和原文输出', () => {
  const message = toolResult({
    toolCallId: '调用-1',
    toolName: '读取工具',
    content: [{ type: 'text', text: BODY }],
  });

  const view = messageView(message);
  assert.equal(view.status, 'success');
  assert.equal(view.title, '工具结果：读取工具');
  assert.equal(view.toolCallId, '调用-1');
  assert.equal(view.toolName, '读取工具');
  assert.equal(view.parts[0].text, BODY);
  assert.equal(view.error, null);
  assert.equal(toolResultText(message), BODY);
});

test('Given 工具失败，When 投影，Then 使用输出文本或固定错误说明而非 details', () => {
  const failed = messageView(toolResult({
    isError: true,
    content: [{ type: 'text', text: BODY }],
    details: { error: HIDDEN },
    errorMessage: { raw: HIDDEN },
  }));

  assert.equal(failed.status, 'error');
  assert.equal(failed.error, BODY);
  assertNoHidden(failed);

  const empty = messageView(toolResult({ isError: true, content: [] }));
  assert.equal(empty.status, 'error');
  assert.equal(empty.error, '工具执行失败，未提供错误说明。');
});

test('Given 工具结果展示字段异常，When 投影，Then incomplete 而不猜成功', () => {
  for (const extra of [
    { toolCallId: undefined },
    { toolCallId: '' },
    { toolCallId: 3 },
    { toolName: null },
    { toolName: '   ' },
    { isError: undefined },
    { isError: 'false' },
    { content: '不是官方工具结果块数组' },
    { content: [{ type: 'text', text: 42 }] },
    { content: [{ type: 'future-block', raw: HIDDEN }] },
  ]) {
    const view = messageView(toolResult(extra));
    assert.equal(view.status, 'incomplete');
    assert.equal(view.error, '消息展示字段不完整或格式无效。');
    assertNoHidden(view);
  }
});

test('Given 工具结果没有可见输出但明确成功，When 投影，Then 不凭空增加正文', () => {
  const message = toolResult({ content: [] });
  const view = messageView(message);

  assert.equal(view.status, 'success');
  assert.deepEqual(view.parts, []);
  assert.equal(toolResultText(message), '');
});

test('Given 工具结果 text/image/未知块，When 提取文本，Then 按序保留并屏蔽元数据', () => {
  const result = {
    content: [
      { type: 'text', text: BODY, textSignature: HIDDEN },
      { type: 'image', mimeType: 'image/jpeg', data: HIDDEN },
      { type: 'future-block', headers: { authorization: HIDDEN } },
      { type: 'text', text: '末尾' },
    ],
    details: { raw: HIDDEN },
    headers: { authorization: HIDDEN },
  };

  assert.equal(toolResultText(result), [
    BODY,
    '图片（image/jpeg；未展示图片数据）',
    '未识别的内容块。',
    '末尾',
  ].join('\n'));
  assertNoHidden(toolResultText(result));
});

test('Given 非工具角色或非法 content，When 提取工具文本，Then 固定未识别提示', () => {
  for (const value of [
    null,
    undefined,
    42,
    HIDDEN,
    [],
    {},
    { content: HIDDEN },
    { role: 'assistant', content: [{ type: 'text', text: HIDDEN }] },
    { content: [{ type: 'thinking', thinking: HIDDEN }] },
    { content: [{ type: 'toolCall', arguments: { raw: HIDDEN } }] },
  ]) {
    assert.equal(toolResultText(value), '未识别的内容块。');
  }
});

test('Given 直接 Bash 执行，When 投影，Then 命令、输出和执行标识独立且不是模型工具', () => {
  const view = messageView(bashExecution({
    command: BODY,
    output: BODY,
    truncated: true,
    fullOutputPath: HIDDEN,
    excludeFromContext: true,
    details: { raw: HIDDEN },
  }));

  assert.equal(view.role, 'bashExecution');
  assert.equal(view.status, 'success');
  assert.match(view.title, /非模型工具/);
  assert.equal(view.toolCallId, null);
  assert.equal(view.toolName, null);
  assert.equal(view.parts[0].title, '命令');
  assert.equal(view.parts[0].text, BODY);
  assert.equal(view.parts[1].title, '输出');
  assert.equal(view.parts[1].text, BODY);
  assert.equal(view.parts[2].text, '退出码：0\n已取消：否\n输出已截断：是');
  assertNoHidden(view);
});

test('Given Bash 无退出码，When 未取消，Then incomplete 而非成功', () => {
  const omitted = bashExecution();
  delete omitted.exitCode;

  for (const message of [
    omitted,
    bashExecution({ exitCode: undefined }),
  ]) {
    const view = messageView(message);
    assert.equal(view.status, 'incomplete');
    assert.match(view.parts[2].text, /退出码：未提供或无效/);
  }
});

test('Given Bash 取消或非零退出码，When 投影，Then 分别显示中断或错误', () => {
  for (const exitCode of [0, 1, undefined]) {
    const cancelled = messageView(bashExecution({
      cancelled: true,
      exitCode,
    }));
    assert.equal(cancelled.status, 'interrupted');
    assert.match(cancelled.parts[2].text, /已取消：是/);
  }

  const failed = messageView(bashExecution({ exitCode: 2 }));
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, '命令执行失败（退出码 2）。');
});

test('Given Bash 字段损坏，When 投影，Then 不把默认值猜成成功', () => {
  for (const extra of [
    { command: null },
    { output: { raw: HIDDEN } },
    { cancelled: undefined },
    { cancelled: 'false' },
    { truncated: undefined },
    { truncated: 'false' },
    { exitCode: null },
    { exitCode: '0' },
    { exitCode: Number.NaN },
    { exitCode: Number.POSITIVE_INFINITY },
    { exitCode: 0.5 },
  ]) {
    const view = messageView(bashExecution(extra));
    assert.equal(view.status, 'incomplete');
    assertNoHidden(view);
  }
});

test('Given custom display=false，When 投影，Then 标题提示默认折叠但不丢历史正文', () => {
  const view = messageView({
    role: 'custom',
    customType: 'fixture-note',
    content: BODY,
    display: false,
    details: { raw: HIDDEN },
  });

  assert.equal(view.status, 'plain');
  assert.equal(view.title, '自定义消息（默认折叠）：fixture-note');
  assert.equal(view.parts[0].text, BODY);
  assertNoHidden(view);

  const visible = messageView({
    role: 'custom',
    customType: 'fixture-note',
    content: [{ type: 'text', text: BODY }],
    display: true,
  });
  assert.equal(visible.title, '自定义消息：fixture-note');
  assert.equal(visible.status, 'plain');
});

test('Given custom 标识或 display 无效，When 投影，Then incomplete 且不静默隐藏正文', () => {
  for (const extra of [
    { customType: null },
    { customType: '' },
    { display: undefined },
    { display: 'false' },
  ]) {
    const view = messageView({
      role: 'custom',
      customType: 'fixture-note',
      content: BODY,
      display: true,
      ...extra,
    });

    assert.equal(view.status, 'incomplete');
    assert.equal(view.parts[0].text, BODY);
  }
});

test('Given 两种原生摘要，When 投影，Then 明确标摘要且不混入元数据', () => {
  for (const [role, title] of [
    ['branchSummary', '分支摘要'],
    ['compactionSummary', '上下文压缩摘要'],
  ]) {
    const view = messageView({
      role,
      summary: BODY,
      fromId: 'fixture-entry',
      tokensBefore: 100,
      details: { raw: HIDDEN },
      systemMessage: { sections: { raw: HIDDEN } },
    });

    assert.equal(view.role, role);
    assert.equal(view.title, title);
    assert.equal(view.status, 'plain');
    assert.deepEqual(view.parts, [{
      kind: 'text',
      title: '摘要',
      text: BODY,
    }]);
    assertNoHidden(view);

    const malformed = messageView({ role, summary: { raw: HIDDEN } });
    assert.equal(malformed.status, 'incomplete');
    assertNoHidden(malformed);
  }
});

test('Given 未知角色或损坏消息，When 投影，Then 固定未识别且不抛崩会话', () => {
  for (const value of [
    null,
    undefined,
    true,
    42,
    HIDDEN,
    [],
    {},
    { role: null, content: HIDDEN },
    { role: HIDDEN, content: HIDDEN, headers: { raw: HIDDEN } },
  ]) {
    let view: MessageView | undefined;
    assert.doesNotThrow(() => {
      view = messageView(value);
    });
    assert.ok(view);
    assert.equal(view.role, 'unknown');
    assert.equal(view.status, 'incomplete');
    assert.deepEqual(view.parts, [{
      kind: 'unknown',
      text: '未识别的消息，无法展示。',
    }]);
    assertNoHidden(view);
    assertViewShape(view);
  }
});

test('Given 已知正文夹杂未知或损坏块，When 投影，Then 保留已知正文但不称成功', () => {
  for (const block of [
    null,
    undefined,
    1,
    HIDDEN,
    {},
    { type: 'future', data: HIDDEN },
    { type: 'text', text: { raw: HIDDEN } },
    { type: 'thinking', thinking: 42 },
    { type: 'image', mimeType: 'image/png', data: HIDDEN },
  ]) {
    const view = messageView(assistant('stop', [
      { type: 'text', text: '前' },
      block,
      { type: 'text', text: '后' },
    ]));

    assert.equal(view.status, 'incomplete');
    assert.deepEqual(view.parts.map(part => part.kind), [
      'text', 'unknown', 'text',
    ]);
    assert.equal(view.parts[0].text, '前');
    assert.equal(view.parts[2].text, '后');
    assertNoHidden(view);
  }
});

test('Given 稀疏内容数组，When 投影，Then 空位不会被静默当有效内容跳过', () => {
  const content: unknown[] = new Array(2);
  content[1] = { type: 'text', text: '回答' };

  const view = messageView(assistant('stop', content));
  assert.equal(view.status, 'incomplete');
  assert.equal(view.parts.length, 2);
  assert.equal(view.parts[0].kind, 'unknown');
  assert.equal(view.parts[1].text, '回答');
});

test('Given 非 JSON 的抛错属性，When 投影，Then 返回固定提示且不透传异常对象', () => {
  const broken = Object.defineProperty({}, 'role', {
    get(): never {
      throw new Error(HIDDEN);
    },
  });
  assert.equal(messageView(broken).status, 'incomplete');
  assertNoHidden(messageView(broken));

  const brokenResult = Object.defineProperty({}, 'content', {
    get(): never {
      throw new Error(HIDDEN);
    },
  });
  assert.equal(toolResultText(brokenResult), '未识别的内容块。');
});

test('Given 冻结输入，When 多次投影，Then 不修改原对象且结果不共享可变 parts', () => {
  const block = Object.freeze({ type: 'text', text: BODY });
  const content = Object.freeze([block]);
  const input = Object.freeze(assistant('stop', content));

  const first = messageView(input);
  const second = messageView(input);
  assert.deepEqual(first, second);
  assert.notEqual(first.parts, second.parts);
  assert.notEqual(first.parts[0], second.parts[0]);

  first.parts[0].text = '仅修改展示副本';
  assert.equal(second.parts[0].text, BODY);
  assert.equal(block.text, BODY);
});
