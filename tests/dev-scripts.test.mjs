import test from 'node:test';
import assert from 'node:assert/strict';
import { childExitStatus } from '../scripts/exit-status.mjs';

test('Given Rust测试被中断 When子进程结束 Then始终非零而非通过', () => {
  for (const code of [0, 1, null, 0xc000013a]) {
    assert.equal(childExitStatus({ mode: 'test:rust', stopping: true, code, signal: 'SIGINT' }), 130);
  }
});

test('Given 开发服务主动停止 When退出 Then与测试中断分开处理', () => {
  assert.equal(childExitStatus({ mode: 'dev', stopping: true, code: null, signal: 'SIGINT' }), 0);
  assert.equal(childExitStatus({ mode: 'dev', stopping: true, code: 0, failureCode: 1 }), 1);
});

test('Given 未中断命令 When退出 Then保留测试通过失败与异常状态', () => {
  assert.equal(childExitStatus({ mode: 'test:rust', stopping: false, code: 0 }), 0);
  assert.equal(childExitStatus({ mode: 'test:rust', stopping: false, code: 101 }), 101);
  assert.equal(childExitStatus({ mode: 'test:rust', stopping: false, code: null, signal: 'SIGTERM' }), 1);
});
