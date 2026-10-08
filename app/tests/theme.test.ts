import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheme } from '../src/theme.ts';

test('Given保存的亮暗主题 When启动 Then优先读取合法偏好', () => {
  assert.equal(readTheme({ getItem: () => 'dark' }, false), 'dark');
  assert.equal(readTheme({ getItem: () => 'light' }, true), 'light');
});

test('Given缺失或不可读偏好 When启动 Then默认浅色且不启动失败', () => {
  assert.equal(readTheme({ getItem: () => 'invalid' }, false), 'light');
  assert.equal(readTheme({ getItem: () => null }, true), 'light');
  assert.equal(readTheme({ getItem: () => { throw new Error('unavailable'); } }, false), 'light');
});
