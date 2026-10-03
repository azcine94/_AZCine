import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validDate,
  validateTodo,
  parseTodo,
  parseWorkspace,
  localDate,
  millisecondsToNextDay,
  filterTodos,
  sameInput,
  workspaceError,
} from '../src/workspace-contract.ts';
import type { Todo, TodoInput } from '../src/workspace-contract.ts';

const TODAY = '2026-10-03';
const ROOT = 'X:/azcine-fixture/data';
const DEFAULT_ROOT = 'X:/azcine-fixture/default';
const INVALID_RESPONSE =
  '桌面返回的数据不完整，未替换现有记录。请重新读取后核对。';

function todoId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function todo(n = 1, overrides: Partial<Todo> = {}): Todo {
  return {
    id: todoId(n),
    title: '核对镜头',
    dueDate: null,
    projectId: null,
    completed: false,
    revision: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function filterRows(): Todo[] {
  const rows = [
    todo(6),
    todo(4, { dueDate: TODAY, createdAt: '2026-10-02T08:00:00.000Z' }),
    todo(8, { completed: true }),
    todo(2, { dueDate: '2026-10-02' }),
    todo(3, { dueDate: TODAY }),
    todo(7, { dueDate: '2026-10-04' }),
    todo(1, { dueDate: TODAY }),
    todo(5, { dueDate: '2026-10-02', completed: true }),
    todo(9, { dueDate: TODAY, completed: true }),
  ];
  for (const row of rows) Object.freeze(row);
  Object.freeze(rows);
  return rows;
}

test('Given full and malformed dates When validating Then enforce calendar and Gregorian leap-year rules', () => {
  for (const date of [
    '0001-01-01', '2026-01-31', '2026-04-30',
    '2024-02-29', '2000-02-29', '2400-02-29', '9999-12-31',
  ]) {
    assert.equal(validDate(date), true, date);
  }

  for (const date of [
    '', '10-03', '2026-10', '26-10-03', '2026-1-03', '2026-10-3',
    '2026/10/03', '2026-10-03T00:00:00Z',
    ' 2026-10-03', '2026-10-03 ', '0000-01-01', '10000-01-01',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32',
    '2026-04-31', '2026-02-29', '1900-02-29', '2100-02-29',
    '2024-02-30',
  ]) {
    assert.equal(validDate(date), false, JSON.stringify(date));
  }
});

test('Given a title When validating Then require 1–500 Unicode code points after trimming', () => {
  const error = '请填写 1–500 字的待办标题。';

  for (const title of ['', ' \t\r\n\u3000\u00a0', 'a'.repeat(501), '🎬'.repeat(501)]) {
    assert.equal(validateTodo(title, ''), error);
  }

  for (const title of [
    '镜', '  核对镜头 \n', 'a'.repeat(500),
    '🎬'.repeat(500), ` \t${'🎬'.repeat(500)}\n `,
  ]) {
    assert.equal(validateTodo(title, ''), null);
  }

  assert.equal(validateTodo(' ', 'not-a-date'), error, '标题错误优先');
});

test('Given an optional due date When validating Then allow empty or full valid dates without guessing', () => {
  for (const date of ['', TODAY, '2024-02-29', '2000-02-29']) {
    assert.equal(validateTodo('核对镜头', date), null, date);
  }

  for (const date of [' ', '10-03', '2026-10', '2026-02-29', '1900-02-29']) {
    assert.equal(
      validateTodo('核对镜头', date),
      '请填写有效的完整日期，也可以不填。',
      JSON.stringify(date),
    );
  }
});

test('Given valid desktop rows When parsing Then preserve typed fields and exclude unrelated fields', () => {
  const expected = todo(1, {
    title: '🎬'.repeat(500),
    dueDate: '2024-02-29',
    projectId: todoId(100),
    completed: true,
    revision: Number.MAX_SAFE_INTEGER,
  });
  const raw = Object.freeze({ ...expected, unrelated: 'ignored' });

  const parsed = parseTodo(raw);
  assert.deepEqual(parsed, expected);
  assert.notStrictEqual(parsed, raw);
  assert.equal(Object.hasOwn(parsed, 'unrelated'), false);
  assert.deepEqual(parseTodo(todo(2)), {
    id: todoId(2),
    title: '核对镜头',
    dueDate: null,
    projectId: null,
    completed: false,
    revision: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
  });
});

test('Given malformed successful row payloads When parsing Then reject invalid or missing required fields', () => {
  const base = todo();
  const cases: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['string', 'success'],
    ['empty object', {}],
    ['success envelope without row', { success: true }],
    ['invalid UUID', { ...base, id: 'not-a-uuid' }],
    ['non-string UUID', { ...base, id: 1 }],
    ['invalid company UUID', { ...base, projectId: 'company-1' }],
    ['empty title', { ...base, title: '' }],
    ['whitespace title', { ...base, title: '\t\u3000\n' }],
    ['non-string title', { ...base, title: 1 }],
    ['501 code points', { ...base, title: '🎬'.repeat(501) }],
    ['empty date instead of null', { ...base, dueDate: '' }],
    ['partial date', { ...base, dueDate: '10-03' }],
    ['impossible date', { ...base, dueDate: '2026-02-29' }],
    ['numeric date', { ...base, dueDate: 20261003 }],
    ['invalid project reference', { ...base, projectId: 1 }],
    ['string completion', { ...base, completed: 'false' }],
    ['numeric completion', { ...base, completed: 0 }],
    ['zero revision', { ...base, revision: 0 }],
    ['negative revision', { ...base, revision: -1 }],
    ['fractional revision', { ...base, revision: 1.5 }],
    ['string revision', { ...base, revision: '1' }],
    ['unsafe revision', { ...base, revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN revision', { ...base, revision: NaN }],
    ['infinite revision', { ...base, revision: Infinity }],
    ['invalid creation time', { ...base, createdAt: 'not-a-date' }],
    ['non-string creation time', { ...base, createdAt: 0 }],
  ];

  for (const field of Object.keys(base)) {
    cases.push([
      `missing ${field}`,
      Object.fromEntries(Object.entries(base).filter(([key]) => key !== field)),
    ]);
  }

  for (const [label, payload] of cases) {
    assert.throws(
      () => parseTodo(payload),
      { name: 'Error', message: INVALID_RESPONSE },
      label,
    );
  }
});

test('Given unopened or selected workspaces When parsing Then accept empty state and valid distinct rows', () => {
  assert.deepEqual(
    parseWorkspace({ root: null, defaultRoot: DEFAULT_ROOT, todos: [] }),
    { root: null, defaultRoot: DEFAULT_ROOT, todos: [] },
  );

  const empty = { root: ROOT, defaultRoot: DEFAULT_ROOT, todos: [] };
  assert.deepEqual(parseWorkspace(empty), empty);

  const expected = {
    root: ROOT,
    defaultRoot: DEFAULT_ROOT,
    todos: [todo(1), todo(2, { dueDate: TODAY, completed: true })],
  };
  const parsed = parseWorkspace({ ...expected, unrelated: 'ignored' });
  assert.deepEqual(parsed, expected);
  assert.notStrictEqual(parsed.todos, expected.todos);
  assert.equal(Object.hasOwn(parsed, 'unrelated'), false);
});

test('Given malformed workspace successes When parsing Then reject duplicates, invalid rows and rows without a root', () => {
  const base = { root: ROOT, defaultRoot: DEFAULT_ROOT, todos: [] };
  const cases: [string, unknown][] = [
    ['null', null],
    ['array', []],
    ['success envelope without workspace', { success: true }],
    ['missing root', { defaultRoot: DEFAULT_ROOT, todos: [] }],
    ['empty root', { ...base, root: '' }],
    ['numeric root', { ...base, root: 1 }],
    ['missing default root', { root: ROOT, todos: [] }],
    ['invalid default root', { ...base, defaultRoot: null }],
    ['missing rows', { root: ROOT, defaultRoot: DEFAULT_ROOT }],
    ['non-array rows', { ...base, todos: {} }],
    ['null row', { ...base, todos: [null] }],
    ['invalid row among valid rows', {
      ...base, todos: [todo(1), { ...todo(2), completed: 'false' }],
    }],
    ['duplicate ID with different content', {
      ...base, todos: [todo(1), todo(1, { title: '不同标题', revision: 2 })],
    }],
    ['null root with rows', { ...base, root: null, todos: [todo(1)] }],
  ];

  for (const [label, payload] of cases) {
    assert.throws(
      () => parseWorkspace(payload),
      { name: 'Error', message: INVALID_RESPONSE },
      label,
    );
  }
});

test('Given local calendar dates When formatting Then use local day boundaries and padded year/month/day', () => {
  assert.equal(localDate(new Date(2026, 0, 2, 0, 5)), '2026-01-02');
  assert.equal(localDate(new Date(2026, 11, 31, 23, 55)), '2026-12-31');
  assert.equal(localDate(new Date(2024, 1, 29, 12)), '2024-02-29');

  const earlyYear = new Date(2026, 0, 2, 12);
  earlyYear.setFullYear(9);
  assert.equal(localDate(earlyYear), '0009-01-02');
});

test('Given local midnight boundary When scheduling next day Then use next calendar day without mutating time', () => {
  const before = new Date(2026, 9, 3, 23, 59, 59, 750);
  const original = before.getTime();
  assert.equal(millisecondsToNextDay(before), 250);
  assert.equal(before.getTime(), original);
  const next = new Date(original + millisecondsToNextDay(before));
  assert.equal(localDate(next), '2026-10-04');
  assert.equal(next.getHours(), 0);
  const yearEnd = new Date(2026, 11, 31, 23, 59, 59);
  assert.equal(localDate(new Date(yearEnd.getTime() + millisecondsToNextDay(yearEnd))), '2027-01-01');
});

test('Given mixed immutable rows When filtering incomplete Then sort by date, creation time and ID with undated last', () => {
  const rows = filterRows();
  const before = rows.map(row => ({ ...row }));
  const result = filterTodos(rows, 'incomplete', TODAY);

  assert.deepEqual(result.map(row => row.id), [2, 1, 3, 4, 7, 6].map(todoId));
  assert.deepEqual(rows, before, '不得重排或修改原始工作区');
  assert.notStrictEqual(result, rows);
  assert.deepEqual(filterTodos([], 'incomplete', TODAY), []);
});

test('Given overdue, today, future and undated rows When selecting today or completed Then return only the matching records', () => {
  const rows = filterRows();

  assert.deepEqual(
    filterTodos(rows, 'today', TODAY).map(row => row.id),
    [1, 3, 4].map(todoId),
    '今天仅包含当天未完成，不包含逾期、未来、无日期或已完成事项',
  );
  assert.deepEqual(
    filterTodos(rows, 'completed', TODAY).map(row => row.id),
    [5, 9, 8].map(todoId),
    '已完成不受今天日期限制，仍按日期排序并将无日期置后',
  );
  assert.deepEqual(filterTodos(rows, 'today', '2026-10-05'), []);
  assert.deepEqual(filterTodos([], 'today', TODAY), []);
  assert.deepEqual(filterTodos([], 'completed', TODAY), []);
});

test('Given a saved row and draft When comparing input Then compare all input fields exactly but ignore persistence metadata', () => {
  const saved = todo(1, { dueDate: TODAY });
  const input: TodoInput = {
    id: todoId(1),
    title: '核对镜头',
    dueDate: TODAY,
    projectId: null,
  };

  assert.equal(sameInput(saved, input), true);
  assert.equal(sameInput(todo(1), { ...input, dueDate: null }), true);
  assert.equal(sameInput({
    ...saved,
    completed: true,
    revision: 8,
    createdAt: '2026-10-02T12:00:00.000Z',
  }, input), true);

  const changes: Partial<TodoInput>[] = [
    { id: todoId(2) },
    { title: '另一事项' },
    { title: '核对镜头 ' },
    { dueDate: null },
    { dueDate: '2026-10-04' },
  ];
  for (const change of changes) {
    assert.equal(sameInput(saved, { ...input, ...change }), false, JSON.stringify(change));
  }
  assert.equal(sameInput({ ...saved, projectId: 'company-1' }, input), false);
});

test('Given thrown errors and unknown failures When extracting a message Then preserve supported messages or return the input-retention fallback', () => {
  assert.equal(workspaceError(new Error('磁盘已满')), '磁盘已满');
  assert.equal(workspaceError({ message: '目录不可写', code: 'EACCES' }), '目录不可写');
  assert.equal(workspaceError(new Error('')), '');
  assert.equal(workspaceError({ message: '' }), '');

  const fallback = '无法完成数据操作，输入已保留。请重新读取并核对后重试。';
  for (const error of [
    undefined, null, false, 42, 'raw failure', [], {},
    { message: 42 }, { message: null }, { message: { text: '失败' } },
  ]) {
    assert.equal(workspaceError(error), fallback);
  }
});
