import { useCallback, useState } from 'react';
import type { PiResource, PiResourcesController } from '../use-pi-resources.ts';

// Only the component catalog imports this fixture. No file/model/native calls.
export function usePreviewResources(baseline: PiResourcesController, state: string): PiResourcesController {
  const root = 'C:/AZCine-UI-Example/pi/agent';
  const entries: PiResource[] = [
    { id: 'official:system', kind: 'official', name: 'Pi 默认系统提示词（示例）', path: 'UI 虚构提示词 · 非真实系统提示词', description: '这是组件总览的排版样例。正常页面从已安装的原版 Pi 生成默认提示词。', content: '# UI 示例\n\n这里展示多段提示词原文的阅读布局。\n\n所有内容均为虚构，不代表 Pi 官方提示词。', hash: null, editable: false, enabled: true, loaded: false, toggleable: false, error: null, commands: [] },
    { id: 'rule:example', kind: 'rule', name: 'AGENTS.md（示例）', path: `${root}/AGENTS.md`, description: '工作规则预览示例；不保存到真实目录。', content: '# 工作规则（示例）\n\n用中文说明任务，保留草稿与原始材料。', hash: 'ui-rule', editable: true, enabled: false, loaded: false, toggleable: false, error: null, commands: [] },
    { id: 'skill:example', kind: 'skill', name: 'notes（示例）', path: `${root}/skills/notes/SKILL.md`, description: '虚构 Skill，用于展示名称、说明和可编辑原文。', content: '---\nname: notes-example\ndescription: UI 虚构 Skill\n---\n\n# 整理笔记（示例）\n\n所有操作只在组件总览的内存中演示。', hash: 'ui-skill', editable: true, enabled: true, loaded: false, toggleable: false, error: null, commands: [] },
    { id: 'extension:example', kind: 'extension', name: 'example-extension（示例）', path: `${root}/extensions/example.ts`, description: '虚构扩展，不执行源码。', content: '// UI 虚构扩展预览\nexport default function example() {\n  // 不执行任何操作\n}', hash: 'ui-extension', editable: false, enabled: true, loaded: true, toggleable: true, error: null, commands: ['example'] },
  ];
  if (state === 'long') {
    entries[0].name += ' · 用于检查长名称与多行标题的资源预览'.repeat(3);
    entries[0].content += '\n\n虚构长正文，用于展示内容滚动和换行。'.repeat(80);
  }
  const [items, setItems] = useState(state === 'empty' ? [] : entries);
  const [selected, setSelected] = useState(state === 'editing' || state === 'dirty' ? 'skill:example' : 'official:system');
  const [drafts, setDrafts] = useState<PiResourcesController['drafts']>(state === 'editing' || state === 'dirty' ? { 'skill:example': { content: entries[2].content + '\n\n未保存的示例编辑。', hash: entries[2].hash } } : {});
  const [editing, setEditing] = useState<PiResourcesController['editing']>(state === 'editing' ? { 'skill:example': true } : {});
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => { setNotice('UI 示例：刷新只展示回执，不读取真实资源。'); }, []);
  return {
    ...baseline, index: state === 'disconnected' ? null : { generation: 1, connected: true, agentDir: root, cwd: 'C:/AZCine-UI-Example/workspace', entries: items, diagnostics: [], settingsHash: 'ui-settings' },
    selected, setSelected, drafts, editing, loading: state === 'loading', saving: false,
    error: state === 'error' ? 'UI 示例：读取失败，已保留原有资源与草稿。' : '', notice,
    refresh,
    edit: item => { setDrafts(before => ({ ...before, [item.id]: before[item.id] ?? { content: item.content, hash: item.hash } })); setEditing(before => ({ ...before, [item.id]: true })); },
    change: (item, content) => setDrafts(before => ({ ...before, [item.id]: { content, hash: before[item.id]?.hash ?? item.hash } })),
    cancel: item => { setEditing(before => ({ ...before, [item.id]: false })); setDrafts(before => { const next = { ...before }; delete next[item.id]; return next; }); },
    save: async (item, enabled) => {
      if (enabled !== undefined) setItems(before => before.map(entry => entry.id === item.id ? { ...entry, enabled } : entry));
      else {
        const draft = drafts[item.id];
        if (!draft) return;
        setItems(before => before.map(entry => entry.id === item.id ? { ...entry, content: draft.content } : entry));
        setDrafts(before => { const next = { ...before }; delete next[item.id]; return next; });
        setEditing(before => ({ ...before, [item.id]: false }));
      }
      setNotice('UI 示例：改动只保留在本页内存，未写入真实文件。');
    },
  };
}
