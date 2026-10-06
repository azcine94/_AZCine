import { useEffect, useState } from 'react';
import { BookOpen, ChevronRight, FileText, FolderOpen, Library, Puzzle, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { LoadingStatus } from './components/ui/loading-status.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { ActionGroup } from './components/ui/action-group.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { displayPath } from './lib/display-path.ts';
import type { PiController } from './use-pi.ts';
import type { PiResource } from './use-pi-resources.ts';

const groups = [
  { kind: 'official', title: 'Pi 官方提示词', icon: BookOpen },
  { kind: 'rule', title: '工作规则', icon: ShieldCheck },
  { kind: 'skill', title: 'Skills', icon: Sparkles },
  { kind: 'extension', title: '扩展', icon: Puzzle },
] as const;

function status(item: PiResource) {
  if (item.error) return '读取失败';
  if (item.kind === 'official') return '官方 · 只读';
  if (item.kind === 'rule') return item.hash === null ? '未创建' : item.enabled ? '已配置' : '未自动加载';
  return item.enabled ? '已配置启用' : '已配置停用';
}

export function PiResourcesPanel({ model }: { model: PiController }) {
  const r = model.resources, index = r.index;
  const [query, setQuery] = useState('');
  const generation = model.snapshot?.generation, connecting = model.snapshot?.connection === 'connecting';
  const operationBusy = !!model.action || !!model.snapshot?.busy || !!model.snapshot?.stopping || !!model.snapshot?.sending || !!model.snapshot && model.snapshot.projection.activity !== 'idle';
  const canRead = !!model.snapshot && !connecting && !operationBusy && !r.saving;
  const waiting = model.connected && !!model.root && !canRead;
  useEffect(() => { if (canRead) void r.refresh(); }, [model.root, generation, canRead, r.refresh]);
  const item = index?.entries.find(entry => entry.id === r.selected) ?? index?.entries[0];
  const group = groups.find(entry => entry.kind === item?.kind);
  const ResourceIcon = group?.icon ?? FileText;
  const draft = item ? r.drafts[item.id] : undefined, editing = !!item && !!r.editing[item.id];
  const busy = r.saving || r.loading || !canRead;
  const filter = query.trim().toLocaleLowerCase();
  const matches = (entry: PiResource) => !filter || `${displayPath(entry.name)} ${entry.description} ${displayPath(entry.path)}`.toLocaleLowerCase().includes(filter);
  const visibleCount = index?.entries.filter(matches).length;

  return <section className="resource-page" aria-label="规则与资源管理">
    <header className="resource-toolbar">
      <div><p className="subtle">管理 Agent 的工作规则、Skills 与原生扩展</p><p className="meta">左侧选择资源，右侧查看原文或编辑文件。</p></div>
      <ActionGroup><UILink variant="pill" href="#agent">返回 Agent<ChevronRight /></UILink><Button variant="app-pill" disabled={!model.connected || !model.root || busy} aria-busy={r.loading} onClick={() => void r.refresh()}><RefreshCw />刷新资源</Button></ActionGroup>
    </header>
    <div className="resource-feedback">
      <LoadingStatus active={r.loading || waiting}>{waiting ? '正在等待 Pi 完成当前操作，完成后自动读取资源；已有内容与草稿保留…' : '正在读取资源，已有内容保留…'}</LoadingStatus>
      {r.error && !waiting && <Feedback as="p" tone="error" role="alert">{r.error}</Feedback>}
      
      {!model.connected && <p className="meta">请在桌面版查看 Pi 资源。</p>}
    </div>
    <div className="resource-manager" aria-busy={r.loading}>
      <aside className="resource-library" aria-label="Pi 资源列表">
        <header className="resource-library-header"><div><Library /><h2>资源库</h2><span className="resource-count">{index ? index.entries.length : '—'}</span></div><label className="resource-search"><Search /><Input variant="app" type="search" aria-label="搜索资源" placeholder="搜索名称、描述…" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
        <div className="resource-list">{groups.map(({ kind, title, icon: GroupIcon }) => {
          const entries = index?.entries.filter(entry => entry.kind === kind && matches(entry)) ?? [];
          if (filter && !entries.length) return null;
          return <section key={kind} aria-label={title}>
            <h3><GroupIcon /><span>{title}</span><span className="resource-count">{index ? entries.length : '—'}</span></h3>
            {entries.map(entry => <Button key={entry.id} variant="app-menu" className="resource-item" aria-pressed={item?.id === entry.id} onClick={() => r.setSelected(entry.id)}>
              <span className="resource-item-icon"><GroupIcon /></span><span className="resource-item-text"><strong>{displayPath(entry.name)}</strong><small>{status(entry)}{r.drafts[entry.id] ? ' · 草稿' : ''}</small></span><ChevronRight className="resource-item-arrow" />
            </Button>)}
            {!entries.length && <p className="meta resource-group-empty">{!index ? '等待读取' : kind === 'skill' ? '将 Skill 放入资源目录后刷新' : '暂无资源'}</p>}
          </section>;
        })}{index && filter && visibleCount === 0 && <EmptyState className="resource-search-empty"><Search /><h3>没有找到资源</h3><p>换个关键词试试。</p><Button variant="app-text" onClick={() => setQuery('')}>清除搜索</Button></EmptyState>}</div>
        <footer className="resource-library-footer"><Disclosure><summary><FolderOpen />资源目录</summary>{index ? <><p className="resource-path">{displayPath(index.agentDir)}</p><p className="meta">Skills 放入 skills，扩展放入 extensions。</p></> : <p className="meta">读取资源后显示实际目录。</p>}</Disclosure></footer>
      </aside>
      <section className="resource-preview" aria-label="资源内容预览">{item ? <>
        <header className="resource-detail-header">
          <p className="resource-breadcrumb">资源库<ChevronRight />{group?.title}</p>
          <div className="resource-detail-heading"><span className="resource-detail-icon"><ResourceIcon /></span><div><h2>{displayPath(item.name)}</h2><div className="resource-badges"><StatusBadge tone={item.error ? 'error' : 'neutral'}>{status(item)}</StatusBadge>{item.loaded && <StatusBadge>当前已注册命令</StatusBadge>}{draft && <StatusBadge tone="warning">未保存草稿</StatusBadge>}</div></div>
            <ActionGroup className="resource-actions">
              {item.toggleable && <Button variant="app-pill" disabled={busy} onClick={() => void r.save(item, !item.enabled)}>{item.enabled ? '停用扩展' : '启用扩展'}</Button>}
              {item.editable && !editing && <Button variant="app-pill" disabled={busy} onClick={() => r.edit(item)}>编辑文件</Button>}
              {editing && <><Button variant="app-pill" disabled={r.saving} onClick={() => r.cancel(item)}>取消编辑</Button><Button variant="app-primary" disabled={busy || !draft} onClick={() => void r.save(item)}>{r.saving ? '保存中…' : '保存'}</Button></>}
            </ActionGroup>
          </div>
          <p className="subtle resource-description">{item.description}</p>
        </header>
        <div className="resource-detail-body">
          {item.error && <Feedback as="p" tone="error" role="alert">{item.error}</Feedback>}
          <div className="resource-document" data-kind={item.kind}>
            <header><span><FileText />{item.kind === 'official' ? '默认系统提示词' : item.path.split(/[\\/]/).pop()}</span><span>{editing ? '编辑中' : '原文预览'}</span></header>
            {editing ? <Textarea variant="app" className="resource-editor" aria-label={`${item.name}内容`} value={draft?.content ?? item.content} disabled={r.saving} spellCheck={false} onChange={event => r.change(item, event.target.value)} /> : item.content ? <pre className="resource-source" tabIndex={0} aria-label={`${item.name}原文`}>{item.content}</pre> : <EmptyState className="resource-document-empty"><FileText /><h3>{item.hash === null && item.editable ? '文件尚未创建' : '暂无正文'}</h3><p>{item.hash === null && item.editable ? '点击“编辑文件”，写入后保存。' : '当前资源没有可预览的正文。'}</p></EmptyState>}
          </div>
          <Disclosure className="resource-metadata"><summary>来源与加载说明</summary><dl><div><dt>来源路径</dt><dd className="resource-path">{displayPath(item.path)}</dd></div>{!!item.commands.length && <div><dt>当前会话命令</dt><dd>{item.commands.map(command => `/${command}`).join('、')}</dd></div>}</dl>{item.kind === 'extension' && <p className="meta">启停配置在下次连接生效；无注册命令的扩展，暂不能通过官方 RPC 确认加载状态。</p>}</Disclosure>
          {!!index?.diagnostics.length && <Disclosure className="resource-metadata"><summary>资源诊断 · {index.diagnostics.length} 项</summary><Feedback as="div" tone="error"><ul>{index.diagnostics.map((message, i) => <li key={i}>{message}</li>)}</ul></Feedback></Disclosure>}
        </div>
        <footer className="resource-detail-footer"><span>{editing ? '未保存的编辑会保留，保存后写入原文件。' : item.editable ? '可编辑资源 · 保存前会核对文件是否已变化' : '只读资源 · 保留原始内容'}</span><span>{(editing ? draft?.content ?? item.content : item.content).length.toLocaleString()} 字符</span></footer>
      </> : <EmptyState className="resource-preview-empty"><BookOpen /><h2>{r.loading ? '正在读取资源' : '从资源库开始'}</h2><p>{r.error ? '读取失败，可使用上方刷新重试。' : '选择左侧的提示词、规则、Skill 或扩展，在这里查看内容。'}</p></EmptyState>}</section>
    </div>
  </section>;
}
