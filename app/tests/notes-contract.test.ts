import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {notesError} from '../src/notes-contract.ts';

test('笔记文件操作在桌面主窗口具有对应的命令权限',()=>{
  const manifest=readFileSync(new URL('../src-tauri/build.rs',import.meta.url),'utf8');
  const capability=JSON.parse(readFileSync(new URL('../src-tauri/capabilities/main.json',import.meta.url),'utf8'));
  assert.deepEqual(capability.windows,['main']);
  for(const command of ['notes_index','notes_select','notes_read','notes_save','notes_binary','notes_attach']){
    assert.ok(manifest.includes(`"${command}"`),`${command} missing from app manifest`);
    assert.ok(capability.permissions.includes('allow-'+command.replaceAll('_','-')),`${command} missing from main window permissions`);
  }
});
test('Tauri 字符串拒绝显示可操作原因，保留原有结构化错误',()=>{
  assert.match(notesError('notes_select not allowed. Command not found'),/重启/);
  assert.equal(notesError('目录已被占用'),'目录已被占用');
  assert.equal(notesError({code:'notes_conflict',message:'原文件已有修改'}),'原文件已有修改');
  assert.match(notesError(null),/草稿保留/);
});
