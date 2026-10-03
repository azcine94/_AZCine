import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePiModel,
  parsePiModels,
  parsePiState,
  parsePromptDisposition,
  replyMatches,
  assistantOutcome,
} from '../src/pi-contract.ts';
import type { PiModel, PiState } from '../src/pi-contract.ts';

const INVALID_DATA = 'Pi 返回的数据格式无效，请重新读取后核对。';
const FIXTURE_SECRET = 'fixture-only-secret-not-a-real-credential';

function model(overrides: Partial<PiModel> = {}): PiModel {
  return {
    id: 'fixture-model',
    name: '测试模型🎬',
    provider: 'fixture-provider',
    api: 'openai-completions',
    input: ['text'],
    reasoning: false,
    contextWindow: 8192,
    maxTokens: 1024,
    ...overrides,
  };
}

function state(overrides: Partial<PiState> = {}): PiState {
  return {
    sessionId: 'fixture-session',
    sessionFile: 'X:/azcine-fixture/pi/sessions/session.jsonl',
    sessionName: '测试会话',
    model: model(),
    thinkingLevel: 'off',
    isStreaming: false,
    isCompacting: false,
    pendingMessageCount: 0,
    messageCount: 0,
    ...overrides,
  };
}

function unconfiguredModel(): Record<string, unknown> {
  return {
    id: 'unknown',
    provider: 'unknown',
    api: 'unknown',
    baseUrl: '',
    reasoning: false,
    input: [],
    contextWindow: 0,
    maxTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };
}

function assistant(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '已完成🎬' }],
    stopReason: 'stop',
    ...overrides,
  };
}

function assertInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, INVALID_DATA);
    return true;
  });
}

test('Given model extensions When parsing Then return only copied contract fields', () => {
  const raw = {
    ...model(),
    apiKey: FIXTURE_SECRET,
    headers: { Authorization: FIXTURE_SECRET },
    baseUrl: 'https://fixture.invalid',
    cost: { input: 1 },
    ['__proto__']: { injected: FIXTURE_SECRET },
  };
  Object.freeze(raw.input);
  Object.freeze(raw);

  const parsed = parsePiModel(raw);

  assert.deepEqual(parsed, model());
  assert.notStrictEqual(parsed, raw);
  assert.notStrictEqual(parsed.input, raw.input);
  for (const field of ['apiKey', 'headers', 'baseUrl', 'cost', '__proto__']) {
    assert.equal(Object.hasOwn(parsed, field), false);
  }
  assert.equal(JSON.stringify(parsed).includes(FIXTURE_SECRET), false);

  parsed.input.push('image');
  assert.deepEqual(raw.input, ['text']);
});

test('Given missing model fields or invalid roots When parsing Then reject without defaults', () => {
  for (const value of [undefined, null, [], 'model', 1, true, {}]) {
    assertInvalid(() => parsePiModel(value));
  }

  for (const field of Object.keys(model())) {
    const raw: Record<string, unknown> = { ...model() };
    delete raw[field];
    assertInvalid(() => parsePiModel(raw));
  }

  assertInvalid(() => parsePiModel({ ...model(), name: undefined }));
});

test('Given model string limits When parsing emoji Then count Unicode code points', () => {
  const limits = [
    ['id', 1000],
    ['provider', 1000],
    ['api', 1000],
    ['name', 2000],
  ] as const;

  for (const [field, limit] of limits) {
    for (const valid of ['a'.repeat(limit), '🎬'.repeat(limit)]) {
      assert.equal(parsePiModel({ ...model(), [field]: valid })[field], valid);
    }

    for (const invalid of [
      '', ' \t\r\n\u3000', undefined, null, 7, true, [], {},
      'a'.repeat(limit + 1), '🎬'.repeat(limit + 1),
    ]) {
      assertInvalid(() => parsePiModel({ ...model(), [field]: invalid }));
    }
  }

  const raw = model({ id: ' fixture-model ', name: ' 测试模型🎬 ' });
  assert.deepEqual(parsePiModel(raw), raw);
});

test('Given model capabilities When parsing Then require strict booleans and input members', () => {
  const validInputs: PiModel['input'][] = [
    [],
    ['text'],
    ['image'],
    ['text', 'image'],
  ];

  for (const input of validInputs) {
    for (const reasoning of [false, true]) {
      const raw = model({ input, reasoning });
      const parsed = parsePiModel(raw);
      assert.deepEqual(parsed, raw);
      assert.notStrictEqual(parsed.input, input);
    }
  }

  for (const reasoning of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
    assertInvalid(() => parsePiModel({ ...model(), reasoning }));
  }

  for (const input of [
    undefined, null, 'text', {}, ['audio'], ['Text'],
    ['text', 'image', 'video'], [null], [undefined], [1],
    [{ type: 'text' }], new Array<unknown>(1),
  ]) {
    assertInvalid(() => parsePiModel({ ...model(), input }));
  }
});

test('Given model token limits When parsing Then require positive safe integers', () => {
  for (const field of ['contextWindow', 'maxTokens'] as const) {
    for (const valid of [1, Number.MAX_SAFE_INTEGER]) {
      assert.equal(parsePiModel({ ...model(), [field]: valid })[field], valid);
    }

    for (const invalid of [
      undefined, null, 0, -1, 1.5, NaN, Infinity, -Infinity,
      Number.MAX_SAFE_INTEGER + 1, '1024', true, {},
    ]) {
      assertInvalid(() => parsePiModel({ ...model(), [field]: invalid }));
    }
  }

  // 契约没有要求 maxTokens <= contextWindow，不另造约束。
  assert.deepEqual(
    parsePiModel(model({ contextWindow: 1, maxTokens: 2 })),
    model({ contextWindow: 1, maxTokens: 2 }),
  );
});

test('Given model lists When parsing Then preserve order and distinguish providers', () => {
  const rows = [
    model({ id: 'shared', provider: 'first' }),
    model({ id: 'shared', provider: 'second' }),
    model({ provider: 'a:b', id: 'c' }),
    model({ provider: 'a', id: 'b:c' }),
  ];
  const raw = {
    models: rows.map(row => ({
      ...row,
      apiKey: FIXTURE_SECRET,
      headers: { Authorization: FIXTURE_SECRET },
    })),
    extra: FIXTURE_SECRET,
  };

  const parsed = parsePiModels(raw);

  assert.deepEqual(parsed, rows);
  assert.notStrictEqual(parsed, raw.models);
  for (let index = 0; index < parsed.length; index += 1) {
    assert.notStrictEqual(parsed[index], raw.models[index]);
    assert.notStrictEqual(parsed[index].input, raw.models[index].input);
  }
  assert.equal(JSON.stringify(parsed).includes(FIXTURE_SECRET), false);
  assert.deepEqual(parsePiModels({ models: [] }), []);
});

test('Given duplicate or malformed model lists When parsing Then reject the whole response', () => {
  for (const value of [
    undefined, null, [], {}, 'models',
    { models: undefined },
    { models: null },
    { models: {} },
    { models: 'models' },
    { data: { models: [] } },
    { models: [model(), {}] },
    { models: [model(), null] },
    { models: new Array<unknown>(1) },
    { models: [model(), model({ name: '另一个名称' })] },
  ]) {
    assertInvalid(() => parsePiModels(value));
  }
});

test('Given the exact unknown sentinel When parsing Then only state maps it to null', () => {
  const sentinel = unconfiguredModel();

  assert.deepEqual(
    parsePiState({ ...state(), model: sentinel }),
    state({ model: null }),
  );
  assert.deepEqual(
    parsePiState({
      ...state(),
      model: { ...sentinel, apiKey: FIXTURE_SECRET },
    }),
    state({ model: null }),
  );
  assert.deepEqual(parsePiModels({ models: [] }), []);

  for (const raw of [sentinel, { ...sentinel, name: 'unknown' }]) {
    assertInvalid(() => parsePiModel(raw));
    assertInvalid(() => parsePiModels({ models: [raw] }));
  }
});

test('Given sentinel lookalikes When parsing state Then do not hide malformed models', () => {
  const changes: Record<string, unknown>[] = [
    { id: 'other' },
    { provider: 'other' },
    { api: 'other' },
    { baseUrl: undefined },
    { baseUrl: null },
    { baseUrl: 'https://fixture.invalid' },
    { reasoning: true },
    { reasoning: 0 },
    { input: ['text'] },
    { input: undefined },
    { contextWindow: 1 },
    { contextWindow: NaN },
    { contextWindow: '0' },
    { maxTokens: 1 },
    { maxTokens: '0' },
  ];

  for (const change of changes) {
    assertInvalid(() => parsePiState({
      ...state(),
      model: { ...unconfiguredModel(), ...change },
    }));
  }

  for (const malformed of [
    {}, [], 'unknown',
    { ...model(), name: undefined },
    { ...model(), contextWindow: 0 },
    { ...model(), maxTokens: 0 },
  ]) {
    assertInvalid(() => parsePiState({ ...state(), model: malformed }));
  }

  const namedRealModel = model({
    id: 'unknown',
    provider: 'unknown',
    api: 'unknown',
  });
  assert.deepEqual(
    parsePiState(state({ model: namedRealModel })).model,
    namedRealModel,
  );
});

test('Given state extensions When parsing Then copy nested model without leaking unknown fields', () => {
  const rawModel = {
    ...model(),
    apiKey: FIXTURE_SECRET,
    headers: { Authorization: FIXTURE_SECRET },
  };
  Object.freeze(rawModel.input);
  Object.freeze(rawModel);

  const raw = Object.freeze({
    ...state(),
    model: rawModel,
    apiKey: FIXTURE_SECRET,
    extra: { secret: FIXTURE_SECRET },
  });
  const parsed = parsePiState(raw);

  assert.deepEqual(parsed, state());
  assert.notStrictEqual(parsed, raw);
  assert.ok(parsed.model);
  assert.notStrictEqual(parsed.model, rawModel);
  assert.notStrictEqual(parsed.model.input, rawModel.input);
  assert.equal(Object.hasOwn(parsed, 'apiKey'), false);
  assert.equal(Object.hasOwn(parsed, 'extra'), false);
  assert.equal(JSON.stringify(parsed).includes(FIXTURE_SECRET), false);

  parsed.model.input.push('image');
  assert.deepEqual(rawModel.input, ['text']);
});

test('Given absent nullable state fields When parsing Then normalize only those fields to null', () => {
  const missing: Record<string, unknown> = { ...state() };
  delete missing.model;
  delete missing.sessionFile;
  delete missing.sessionName;

  const expected = state({
    model: null,
    sessionFile: null,
    sessionName: null,
  });

  assert.deepEqual(parsePiState(missing), expected);
  assert.deepEqual(parsePiState(expected), expected);
  assert.deepEqual(
    parsePiState({
      ...state(),
      model: undefined,
      sessionFile: undefined,
      sessionName: undefined,
    }),
    expected,
  );
});

test('Given missing required state fields When parsing Then reject instead of returning a ready state', () => {
  for (const value of [undefined, null, [], 'state', 1, true, {}]) {
    assertInvalid(() => parsePiState(value));
  }

  for (const field of [
    'sessionId',
    'thinkingLevel',
    'isStreaming',
    'isCompacting',
    'pendingMessageCount',
    'messageCount',
  ]) {
    const raw: Record<string, unknown> = { ...state() };
    delete raw[field];
    assertInvalid(() => parsePiState(raw));
  }
});

test('Given state string limits When parsing Then use code points without path interpretation', () => {
  const limits = [
    ['sessionId', 200],
    ['sessionFile', 32767],
    ['sessionName', 1000],
    ['thinkingLevel', 50],
  ] as const;

  for (const [field, limit] of limits) {
    for (const valid of ['a'.repeat(limit), '🎬'.repeat(limit)]) {
      assert.equal(parsePiState({ ...state(), [field]: valid })[field], valid);
    }

    for (const invalid of [
      '', ' \t\r\n\u3000', 7, false, [], {},
      'a'.repeat(limit + 1), '🎬'.repeat(limit + 1),
    ]) {
      assertInvalid(() => parsePiState({ ...state(), [field]: invalid }));
    }
  }

  for (const field of ['sessionId', 'thinkingLevel'] as const) {
    for (const invalid of [undefined, null]) {
      assertInvalid(() => parsePiState({ ...state(), [field]: invalid }));
    }
  }

  assert.equal(
    parsePiState(state({ sessionFile: '../fixture-relative-session.jsonl' }))
      .sessionFile,
    '../fixture-relative-session.jsonl',
  );
  assert.equal(
    parsePiState(state({ sessionName: ' 会话🎬 ' })).sessionName,
    ' 会话🎬 ',
  );
});

test('Given state flags and counters When parsing Then reject coercions NaN and unsafe integers', () => {
  for (const field of ['isStreaming', 'isCompacting'] as const) {
    for (const valid of [false, true]) {
      assert.equal(parsePiState({ ...state(), [field]: valid })[field], valid);
    }
    for (const invalid of [undefined, null, 0, 1, 'false', 'true', [], {}]) {
      assertInvalid(() => parsePiState({ ...state(), [field]: invalid }));
    }
  }

  for (const field of ['pendingMessageCount', 'messageCount'] as const) {
    for (const valid of [0, 1, Number.MAX_SAFE_INTEGER]) {
      assert.equal(parsePiState({ ...state(), [field]: valid })[field], valid);
    }
    for (const invalid of [
      undefined, null, -1, 0.5, NaN, Infinity, -Infinity,
      Number.MAX_SAFE_INTEGER + 1, '0', false, {},
    ]) {
      assertInvalid(() => parsePiState({ ...state(), [field]: invalid }));
    }
  }
});

test('Given explicit prompt dispositions When parsing Then preserve acceptance status without completion', () => {
  for (const disposition of ['started', 'queued', 'handled'] as const) {
    assert.equal(parsePromptDisposition({ disposition }), disposition);
    assert.equal(
      parsePromptDisposition({
        accepted: true,
        disposition,
        extra: FIXTURE_SECRET,
      }),
      disposition,
    );

    assert.equal(
      assistantOutcome({ accepted: true, disposition }),
      'incomplete',
    );
    assert.equal(
      assistantOutcome(assistant({ stopReason: disposition })),
      'incomplete',
    );
  }
});

test('Given missing or unknown prompt dispositions When parsing Then never infer from accepted', () => {
  for (const value of [
    undefined, null, [], 'started', {},
    { accepted: true },
    { accepted: false },
    { data: { disposition: 'started' } },
    { disposition: undefined },
    { disposition: null },
    { disposition: true },
    { disposition: 1 },
    { disposition: '' },
    { disposition: 'started ' },
    { disposition: 'accepted' },
    { disposition: 'success' },
    { disposition: 'completed' },
    { disposition: FIXTURE_SECRET },
  ]) {
    assertInvalid(() => parsePromptDisposition(value));
  }
});

test('Given correlated responses When matching Then match both success and rejection responses', () => {
  for (const success of [true, false]) {
    const reply = {
      type: 'response',
      id: 'request-1',
      command: 'prompt',
      success,
      data: { accepted: true },
      extra: FIXTURE_SECRET,
    };
    assert.equal(replyMatches(reply, 'request-1', 'prompt'), true);
  }

  assert.equal(
    replyMatches(
      {
        type: 'response',
        id: 'future-1',
        command: 'future_command',
        success: true,
      },
      'future-1',
      'future_command',
    ),
    true,
  );
});

test('Given mismatched or malformed replies When matching Then return false without coercion', () => {
  const reply = {
    type: 'response',
    id: 'request-1',
    command: 'prompt',
    success: true,
  };

  for (const value of [
    undefined, null, [], 'response', {},
    { ...reply, type: undefined },
    { ...reply, type: 'agent_settled' },
    { ...reply, id: undefined },
    { ...reply, id: 'request-2' },
    { ...reply, id: 1 },
    { ...reply, command: undefined },
    { ...reply, command: 'get_state' },
    { ...reply, success: undefined },
    { ...reply, success: null },
    { ...reply, success: 'true' },
    { ...reply, success: 1 },
  ]) {
    assert.equal(replyMatches(value, 'request-1', 'prompt'), false);
  }

  for (const field of ['type', 'id', 'command', 'success']) {
    const missing: Record<string, unknown> = { ...reply };
    delete missing[field];
    assert.equal(replyMatches(missing, 'request-1', 'prompt'), false);
  }

  for (const [id, command] of [
    ['', 'prompt'],
    [' \t', 'prompt'],
    ['request-1', ''],
    ['request-1', ' \n'],
  ]) {
    assert.equal(
      replyMatches({ ...reply, id, command }, id, command),
      false,
    );
  }

  assert.equal(replyMatches(reply, 'request-2', 'prompt'), false);
  assert.equal(replyMatches(reply, 'request-1', 'get_state'), false);
  assert.equal(
    replyMatches({ ...reply, id: ' request-1 ' }, 'request-1', 'prompt'),
    false,
  );
});

test('Given stopped assistant text When classifying Then require a nonblank text block', () => {
  for (const errorMessage of [undefined, null, '']) {
    assert.equal(assistantOutcome(assistant({ errorMessage })), 'success');
  }

  assert.equal(
    assistantOutcome(assistant({
      content: [
        { type: 'thinking', thinking: 'fixture thought' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} },
        { type: 'text', text: ' \n实际结果🎬 ' },
      ],
    })),
    'success',
  );
});

test('Given absent empty or nontext content When classifying Then never report success', () => {
  const contents: unknown[] = [
    undefined,
    null,
    '完成',
    {},
    [],
    [null],
    ['完成'],
    [{}],
    [{ type: 'text' }],
    [{ type: 'text', text: undefined }],
    [{ type: 'text', text: 1 }],
    [{ type: 'text', text: '' }],
    [{ type: 'text', text: ' \t\r\n\u3000' }],
    [{ type: 'thinking', thinking: '完成' }],
    [{ type: 'image', data: 'fixture' }],
    [{ type: 'toolCall', name: 'read', arguments: {} }],
    [{ type: 'unknown', text: '完成' }],
    new Array<unknown>(1),
  ];

  for (const content of contents) {
    assert.equal(assistantOutcome(assistant({ content })), 'incomplete');
  }
});

test('Given nonfinal stop reasons When classifying Then keep even nonempty text incomplete', () => {
  for (const stopReason of [
    undefined, null, '', 'pending', 'length', 'toolUse',
    'deferred', 'unknown', 'started', 'queued', 'handled',
    'agent_end', 'agent_settled', 'stop ',
  ]) {
    assert.equal(assistantOutcome(assistant({ stopReason })), 'incomplete');
  }
});

test('Given assistant errors When classifying Then report error without returning error text', () => {
  assert.equal(
    assistantOutcome(assistant({ stopReason: 'error', content: [] })),
    'error',
  );

  for (const stopReason of ['stop', 'pending', 'length', 'toolUse', 'deferred']) {
    assert.equal(
      assistantOutcome(assistant({
        stopReason,
        errorMessage: FIXTURE_SECRET,
      })),
      'error',
    );
  }

  assert.equal(
    assistantOutcome(assistant({ errorMessage: ' \n' })),
    'error',
  );
});

test('Given an aborted assistant When classifying Then interruption takes priority over error text', () => {
  for (const content of [undefined, [], [{ type: 'text', text: '部分输出' }]]) {
    assert.equal(
      assistantOutcome(assistant({
        stopReason: 'aborted',
        content,
        errorMessage: FIXTURE_SECRET,
      })),
      'interrupted',
    );
  }
});

test('Given malformed or nonassistant messages When classifying Then do not infer success', () => {
  for (const value of [undefined, null, [], 'success', true, {}, 1]) {
    assert.equal(assistantOutcome(value), 'incomplete');
  }

  for (const role of [undefined, null, 'user', 'system', 'toolResult', 'Assistant']) {
    for (const stopReason of ['stop', 'error', 'aborted']) {
      assert.equal(
        assistantOutcome(assistant({
          role,
          stopReason,
          errorMessage: FIXTURE_SECRET,
        })),
        'incomplete',
      );
    }
  }

  for (const errorMessage of [false, 0, {}, []]) {
    assert.equal(
      assistantOutcome(assistant({ errorMessage })),
      'incomplete',
    );
  }
});

test('Given invalid fields containing fixture secrets When parsing Then throw only fixed Chinese errors', () => {
  assertInvalid(() => parsePiModel({
    ...model(),
    input: [FIXTURE_SECRET],
    apiKey: FIXTURE_SECRET,
  }));
  assertInvalid(() => parsePiModels({
    models: [{ ...model(), reasoning: FIXTURE_SECRET }],
  }));
  assertInvalid(() => parsePiState({
    ...state(),
    messageCount: FIXTURE_SECRET,
  }));
  assertInvalid(() => parsePromptDisposition({
    disposition: FIXTURE_SECRET,
  }));
});
