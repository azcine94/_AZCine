import test from 'node:test';
import assert from 'node:assert/strict';
import { pages, resolveRoute, pageTitle, navigationPage, projectTarget } from '../src/routes.ts';
import { parseDesktopReport, desktopError } from '../src/desktop-contract.ts';

const validReport = { requestId: 17, appVersion: '0.0.0', sqliteVersion: 'test-only', storage: 'temporary', roundTrip: true, rollback: true };

test('Given已注册页面 When解析hash Then正常路由且无隐藏研究页', () => {
  assert.deepEqual(pages.map(page=>page.id),['today','projects','news','models','ideas','bookkeeping','agent','jobs','resources','settings']);
  for (const page of pages) {
    assert.equal(resolveRoute(`#${page.id}`), page.id);
    assert.equal(pageTitle(page.id), page.id === 'settings' ? '常用设置' : page.title);
  }
  assert.equal(resolveRoute(''), 'today');
  for (const hash of ['#research', '#<script>', '#projects/unknown', '#%invalid']) assert.equal(resolveRoute(hash), 'missing');
});

test('Given新建公司页 When解析路由 Then独立正常页仍归项目导航而非假项目ID', () => {
  assert.equal(resolveRoute('#projects/new'), 'projects/new');
  assert.equal(navigationPage('projects/new'), 'projects');
  assert.equal(pageTitle('projects/new'), '新建公司项目');
  assert.equal(projectTarget('projects/new'), null);
  for (const hash of ['#projects/new/extra', '#projects/personal']) assert.equal(resolveRoute(hash), 'missing');
});

test('Given真实检查完整结果 When请求编号匹配 Then可以显示成功', () => {
  assert.deepEqual(parseDesktopReport(validReport, 17), validReport);
});

test('Given缺失检查或过期编号 When校验 Then不得假报成功', () => {
  for (const result of [null, {}, { ...validReport, requestId: 2 }, { ...validReport, rollback: false }, { ...validReport, roundTrip: false }, { ...validReport, storage: 'business' }, { ...validReport, sqliteVersion: '' }]) {
    assert.throws(() => parseDesktopReport(result, 17));
  }
});

test('Given桌面拒绝 When错误转换 Then保留明确原因而不输出任意对象', () => {
  assert.equal(desktopError({ code: 'storage_failed', message: '临时目录不可写' }), '临时目录不可写');
  assert.equal(desktopError(new Error('连接已断开')), '连接已断开');
  assert.match(desktopError({ token: 'test-value-not-to-print' }), /无法完成/);
});
