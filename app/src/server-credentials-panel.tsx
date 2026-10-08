import type { FormEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowLeft, Bell, Check, CheckCircle2, CircleHelp, Clock3, Copy, FileKey, FolderOpen, KeyRound, Plus, Search, Server, Trash2 } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { RecordPagination, recordPage } from './components/ui/record-pagination.tsx';
import { Card } from './components/ui/card.tsx';
import { Input } from './components/ui/input.tsx';
import { Label } from './components/ui/label.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { DateInput } from './date-input.tsx';
import { validDate } from './workspace-contract.ts';
import { daysUntil, expiryStatus } from './server-credentials-contract.ts';
import type { CredentialRecord, ManagerTab, ServerRecord } from './server-credentials-contract.ts';

import type { ManagerList, ServerCredentialsModel } from './use-server-credentials.ts';
import { LoadingStatus } from './components/ui/loading-status.tsx';

const root = 'servers-credentials';
const serverLink = (id: string) => `#${root}/servers/${id}`;
const credentialLink = (id: string) => `#${root}/credentials/${id}`;
function Due({ row, today }: { row: ServerRecord; today: string }) {
  const status = expiryStatus(row.expires, today);
  const days = daysUntil(row.expires, today);
  const Icon = status.tone === 'error' ? AlertTriangle : days === null ? CircleHelp : days <= 7 ? AlertTriangle : days <= 30 ? Clock3 : CheckCircle2;
  return <StatusBadge variant="soft" tone={status.tone}><Icon aria-hidden="true" />{status.text}</StatusBadge>;
}
function Field({ id, title, children, full = false }: { id: string; title: string; children: ReactNode; full?: boolean }) {
  return <div className={`manager-field${full ? ' manager-field--full' : ''}`}><Label htmlFor={id}>{title}</Label>{children}</div>;
}
function Info({ title, children }: { title: string; children: ReactNode }) {
  return <div><dt>{title}</dt><dd>{children || '未填写'}</dd></div>;
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); notifyOperation('已复制。'); }
  catch { notifyOperation('复制失败，请选中文字后按 Ctrl+C。', { tone: 'error' }); }
}
function KeyFile({ name, id, label, model }: { name: string; id: string; label?: string; model: ServerCredentialsModel }) {
  return <div className="manager-key-file"><span title={name}>{label && `${label}：`}{name || '未选择'}</span>{name && <Button type="button" variant="ghost" size="icon-xs" disabled={!id || model.isPreview} aria-label={`打开 ${name} 所在文件夹`} title={model.isPreview ? '预览文件没有本地副本' : '打开所在文件夹'} onClick={() => void model.openFolder(id)}><FolderOpen /></Button>}</div>;
}
function CredentialInfo({ row, model }: { row: CredentialRecord; model: ServerCredentialsModel }) {
  return <dl className="manager-info">
    <Info title="类型">{row.kind === 'ssh' ? 'SSH 密钥' : '账号密码'} · {row.category}</Info>
    <Info title="账号 / 用户名">{row.username}</Info>
    {row.kind === 'password' ? <Info title="密码"><div className="manager-secret"><code>{row.password || '未填写'}</code>{row.password && <Button variant="ghost" size="icon-sm" aria-label={`复制 ${row.name} 的密码`} onClick={() => void copy(row.password)}><Copy /></Button>}</div></Info> : <>
      <Info title="公钥文件"><KeyFile name={row.publicFile} id={row.publicFileId} model={model} /></Info><Info title="私钥文件"><KeyFile name={row.privateFile} id={row.privateFileId} model={model} /></Info>
      <Info title="私钥口令">{row.passphrase || '未填写'}</Info>
    </>}
    <Info title="网站 / 控制台">{row.website}</Info><Info title="备注">{row.notes}</Info>
  </dl>;
}

export function ServerCredentialsPanel({ model: m, route }: { model: ServerCredentialsModel; route: string }) {
  const serverId = route.startsWith(`${root}/servers/`) ? route.slice(`${root}/servers/`.length) : null;
  const credentialId = route.startsWith(`${root}/credentials/`) ? route.slice(`${root}/credentials/`.length) : null;
  const selectedServer = serverId ? m.serverIndex.byId.get(serverId) : undefined;
  const selectedCredential = m.credentials.find(row => row.id === credentialId);
  const { reminders, overdue } = m;
  const query = m.query.trim().toLocaleLowerCase();
  const matches = (...values: string[]) => values.join(' ').toLocaleLowerCase().includes(query);
  const servers = m.servers.filter(row => {
    if (!matches(row.name, row.provider, row.address, row.purpose)) return false;
    if (m.filter === 'all') return true;
    const days = daysUntil(row.expires, m.today);
    return days !== null && (m.filter === 'overdue' ? days < 0 : days >= 0 && days <= 30);
  });
  const credentials = m.credentials.filter(row => matches(row.name, row.username, row.category) && (m.filter === 'all' || row.kind === m.filter));
  const serverPage = recordPage(servers.length, m.pagination.servers.page, m.pagination.servers.pageSize);
  const credentialPage = recordPage(credentials.length, m.pagination.credentials.page, m.pagination.credentials.pageSize);
  const reminderPage = recordPage(reminders.length, m.pagination.reminders.page, m.pagination.reminders.pageSize);
  const renewalPage = recordPage(m.renewals.length, m.pagination.renewals.page, m.pagination.renewals.pageSize);
  const visibleServers = servers.slice(serverPage.start, serverPage.end);
  const visibleCredentials = credentials.slice(credentialPage.start, credentialPage.end);
  const visibleReminders = reminders.slice(reminderPage.start, reminderPage.end);
  const visibleRenewals = m.renewals.slice(renewalPage.start, renewalPage.end);
  const credentialScroll = useRef<HTMLDivElement>(null);
  const serverScroll = useRef<HTMLDivElement>(null);
  const reminderScroll = useRef<HTMLDivElement>(null);
  const renewalScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (credentialScroll.current) credentialScroll.current.scrollTop = 0; }, [credentialPage.page, m.pagination.credentials.pageSize, m.query, m.filter]);
  useEffect(() => { if (serverScroll.current) serverScroll.current.scrollTop = 0; }, [serverPage.page, m.pagination.servers.pageSize, m.query, m.filter]);
  useEffect(() => { if (reminderScroll.current) reminderScroll.current.scrollTop = 0; }, [reminderPage.page, m.pagination.reminders.pageSize]);
  useEffect(() => { if (renewalScroll.current) renewalScroll.current.scrollTop = 0; }, [renewalPage.page, m.pagination.renewals.pageSize]);
  useEffect(() => {
    const pages: Record<ManagerList, number> = { servers: serverPage.page, credentials: credentialPage.page, reminders: reminderPage.page, renewals: renewalPage.page };
    for (const list of Object.keys(pages) as ManagerList[]) if (m.pagination[list].page !== pages[list]) m.setPage(list, pages[list]);
  }, [serverPage.page, credentialPage.page, reminderPage.page, renewalPage.page, m.pagination]);
  const pager = (list: ManagerList, label: string, total: number) => <RecordPagination label={label} total={total} {...m.pagination[list]} onPageChange={page => m.setPage(list, page)} onPageSizeChange={size => m.setPageSize(list, size)} />;
  const openTab = (tab: ManagerTab) => { if (m.tab === tab) return; m.setTab(tab); m.setFilter('all'); m.setQuery(''); };
  const related = selectedServer && m.credentials.find(row => row.id === selectedServer.credentialId);
  const dialog = m.dialog;
  const serverDraft = dialog?.kind === 'server' ? m.serverDrafts[dialog.id] : undefined;
  const credentialDraft = dialog?.kind === 'credential' ? m.credentialDrafts[dialog.id] : undefined;
  const renewing = dialog?.kind === 'renew' ? m.serverIndex.byId.get(dialog.id) : undefined;
  const deleting = dialog?.kind === 'delete-server' || dialog?.kind === 'delete-credential';
  const deleteTarget = dialog?.kind === 'delete-server' ? m.serverIndex.byId.get(dialog.id) : dialog?.kind === 'delete-credential' ? m.credentials.find(row => row.id === dialog.id) : undefined;
  const linkedServerCount = dialog?.kind === 'delete-credential' ? (m.serverIndex.byCredential.get(dialog.id)?.length ?? 0) : 0;
  function patchServer(change: Partial<ServerRecord>) {
    if (!dialog || !serverDraft) return;
    m.setServerDrafts(all => ({ ...all, [dialog.id]: { ...all[dialog.id], ...change } })); m.setError('');
  }
  function patchCredential(change: Partial<CredentialRecord>) {
    if (!dialog || !credentialDraft) return;
    m.setCredentialDrafts(all => ({ ...all, [dialog.id]: { ...all[dialog.id], ...change } })); m.setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || m.busy || m.pending) return;
    const expectedSession = m.session.current;
    const finish = () => { if (m.session.current === expectedSession) { m.setError(''); m.setDialog(null); } notifyOperation(deleting ? (m.isPreview ? '已从本次预览删除。' : dialog.kind === 'delete-server' ? '服务器已删除。' : '凭证已删除。') : m.isPreview ? '已保存到本次预览。' : dialog.kind === 'renew' ? '续费已登记，到期日已更新。' : '已保存。'); };
    if (dialog.kind === 'delete-server' || dialog.kind === 'delete-credential') {
      const kind = dialog.kind;
      await m.removeRecord(kind, dialog.id, () => {
        finish();
        const detail = kind === 'delete-server' ? serverLink(dialog.id) : credentialLink(dialog.id);
        if (location.hash === detail) { openTab(kind === 'delete-server' ? 'servers' : 'credentials'); location.hash = root; }
      });
      return;
    }
    if (serverDraft) {
      if (!serverDraft.name.trim()) { m.setError('请填写服务器名称。'); return; }
      if ([serverDraft.expires, serverDraft.purchased].some(value => value && !validDate(value))) { m.setError('请填写有效日期，格式为 YYYY-MM-DD。'); return; }
      if (serverDraft.expires && serverDraft.purchased && serverDraft.expires < serverDraft.purchased) { m.setError('到期日期不能早于购买日期。'); return; }
      if (serverDraft.price && (!/^\d{1,12}(\.\d{1,2})?$/.test(serverDraft.price) || !Number.isFinite(Number(serverDraft.price)))) { m.setError('续费金额请填写非负数字，最多 12 位整数、2 位小数。'); return; }
      const row = { ...serverDraft, name: serverDraft.name.trim(), id: serverDraft.id || crypto.randomUUID() };
      await m.persist({ servers: serverDraft.id ? m.servers.map(item => item.id === row.id ? row : item) : [...m.servers, row] }, () => {
        m.setServerDrafts(all => { if (all[dialog.id] !== serverDraft) return all; const next = { ...all }; delete next[dialog.id]; return next; }); finish();
      });
    } else if (credentialDraft) {
      if (!credentialDraft.name.trim()) { m.setError('请填写凭证名称。'); return; }
      if (credentialDraft.kind === 'password' && !credentialDraft.password) { m.setError('请填写密码。'); return; }
      if (credentialDraft.kind === 'ssh' && !credentialDraft.publicFile && !credentialDraft.privateFile) { m.setError('请选择至少一个公钥或私钥文件。'); return; }
      const row = { ...credentialDraft, name: credentialDraft.name.trim(), id: credentialDraft.id || crypto.randomUUID() };
      await m.persist({ credentials: credentialDraft.id ? m.credentials.map(item => item.id === row.id ? row : item) : [...m.credentials, row] }, () => {
        m.setCredentialDrafts(all => { if (all[dialog.id] !== credentialDraft) return all; const next = { ...all }; delete next[dialog.id]; return next; }); finish();
      });
    } else if (renewing) {
      const next = m.renewalDrafts[renewing.id] ?? '';
      if (!validDate(next) || next <= m.today || (renewing.expires && next <= renewing.expires)) { m.setError('新到期日应晚于今天和当前到期日。'); return; }
      await m.persist({
        servers: m.servers.map(row => row.id === renewing.id ? { ...row, expires: next } : row),
        renewals: [{ id: crypto.randomUUID(), serverId: renewing.id, name: renewing.name, previous: renewing.expires, next, date: m.today }, ...m.renewals],
      }, () => {
        m.setServerDrafts(all => all[renewing.id] ? { ...all, [renewing.id]: { ...all[renewing.id], expires: next } } : all);
        m.setRenewalDrafts(all => { if (all[renewing.id] !== next) return all; const updated = { ...all }; delete updated[renewing.id]; return updated; }); finish();
      });
    }
  }

  const serverField = (key: keyof ServerRecord, title: string, placeholder = '') => serverDraft && <Field id={`manager-${key}`} title={title}><Input id={`manager-${key}`} value={serverDraft[key] ?? ''} onChange={e => patchServer({ [key]: e.target.value })} placeholder={placeholder} maxLength={1000} /></Field>;
  const credentialField = (key: keyof CredentialRecord, title: string, placeholder = '') => credentialDraft && <Field id={`manager-${key}`} title={title}><Input id={`manager-${key}`} value={credentialDraft[key]} onChange={e => patchCredential({ [key]: e.target.value })} placeholder={placeholder} autoComplete="off" maxLength={1000} /></Field>;
  const unavailable = m.busy || m.pending || !!m.loadError || m.loading;
  const recovery = <>{m.loadError && <Feedback tone="error" role="alert">{m.loadError}<Button variant="outline" size="sm" disabled={m.busy || m.pending || m.loading} onClick={() => void m.refresh()}>重新读取</Button></Feedback>}{m.pending && <Feedback tone="pending">上次保存结果待确认，输入已保留。<Button variant="outline" size="sm" disabled={m.busy} onClick={() => void m.reconcile()}>核对保存结果</Button></Feedback>}</>;
  if (!m.loaded) return <div className="server-manager">{m.loading ? <LoadingStatus active>正在读取服务器和凭证…</LoadingStatus> : recovery}</div>;
  return <div className="server-manager" aria-busy={m.busy || m.loading}>
    <div className="manager-intro"><p>服务器资料、账号与密钥，放在一起随时查找。</p>{m.isPreview && <StatusBadge>界面预览</StatusBadge>}</div>
    {m.isPreview && <Feedback>虚构示例 · 仅用于界面预览，不会写入本地数据。</Feedback>}
    {!dialog && <>{recovery}{m.error && !m.pending && !m.loadError && <Feedback tone="error" role="alert">{m.error}</Feedback>}</>}
    {serverId || credentialId ? <>
      <div className="manager-toolbar"><UILink variant="text" href={`#${root}`} onClick={() => openTab(credentialId ? 'credentials' : 'servers')}><ArrowLeft size={16} /> 返回{credentialId ? '凭证' : '服务器'}列表</UILink>
        {selectedServer && <div className="manager-actions"><Button variant="outline" disabled={unavailable} onClick={() => m.setDialog({ kind: 'delete-server', id: selectedServer.id })}><Trash2 />删除</Button><Button variant="outline" disabled={unavailable} onClick={() => m.editServer(selectedServer)}>编辑资料</Button><Button disabled={unavailable} onClick={() => m.renew(selectedServer)}>登记续费</Button></div>}
        {selectedCredential && <div className="manager-actions"><Button variant="outline" disabled={unavailable} onClick={() => m.setDialog({ kind: 'delete-credential', id: selectedCredential.id })}><Trash2 />删除</Button><Button disabled={unavailable} onClick={() => m.editCredential(selectedCredential)}>编辑凭证</Button></div>}
      </div>
      {selectedServer ? <div className="manager-details">
        <Card className="manager-detail-card"><div className="manager-section-heading"><h2>{selectedServer.name}</h2><Due row={selectedServer} today={m.today} /></div><dl className="manager-info">
          <Info title="登录用户名">{selectedServer.loginUsername}</Info><Info title="登录密码"><div className="manager-secret"><code>{selectedServer.loginPassword || '未填写'}</code>{selectedServer.loginPassword && <Button variant="ghost" size="icon-sm" aria-label={`复制 ${selectedServer.name} 的登录密码`} onClick={() => void copy(selectedServer.loginPassword)}><Copy /></Button>}</div></Info>
          <Info title="服务商">{selectedServer.provider}</Info><Info title="IP / 主机地址">{selectedServer.address}</Info><Info title="地区">{selectedServer.region}</Info><Info title="配置">{selectedServer.configuration}</Info><Info title="用途">{selectedServer.purpose}</Info><Info title="购买日期">{selectedServer.purchased}</Info><Info title="到期日期">{selectedServer.expires}</Info><Info title="续费金额 / 周期">{selectedServer.price ? `${selectedServer.price} ${selectedServer.currency} / ${selectedServer.cycle}` : '未填写'}</Info><Info title="备注">{selectedServer.notes}</Info>
        </dl></Card>
        <Card className="manager-detail-card"><div className="manager-section-heading"><h2>关联凭证</h2><KeyRound size={18} /></div>{related ? <><UILink variant="text" href={credentialLink(related.id)}>{related.name}</UILink><CredentialInfo row={related} model={m} /></> : <EmptyState variant="centered"><p>还没有关联凭证</p><Button variant="outline" disabled={unavailable} onClick={() => m.editServer(selectedServer)}>选择凭证</Button></EmptyState>}</Card>
      </div> : selectedCredential ? <Card className="manager-detail-card"><h2>{selectedCredential.name}</h2><CredentialInfo row={selectedCredential} model={m} /><div className="manager-related"><h3>关联服务器</h3>{m.serverIndex.byCredential.has(selectedCredential.id) ? m.serverIndex.byCredential.get(selectedCredential.id)!.map(row => <UILink variant="text" key={row.id} href={serverLink(row.id)}>{row.name}</UILink>) : <p className="meta">这是一条独立凭证，尚未关联服务器。</p>}</div></Card> : <EmptyState variant="centered"><h2>没有找到这条记录</h2><p>请返回列表查看现有记录。</p></EmptyState>}
    </> : <>
      <div className="manager-summary">{[
        { label: '服务器', value: m.servers.length, note: '已记录的服务器', icon: Server },
        { label: '凭证', value: m.credentials.length, note: '账号密码与 SSH 密钥', icon: KeyRound },
        { label: '即将到期', value: m.dueServers.length - overdue, note: '未来 30 天内', icon: Bell },
        { label: '已过期', value: overdue, note: '等待确认续费', icon: FileKey },
      ].map(({ label, value, note, icon: Icon }) => <Card key={label} variant="review" className="manager-metric"><div><span>{label}</span><Icon size={16} aria-hidden="true" /></div><strong>{value}</strong><span className="meta">{note}</span></Card>)}</div>
      <Tabs className="gap-5" value={m.tab} onValueChange={value => openTab(value as ManagerTab)}>
        <div className="manager-toolbar manager-tab-toolbar"><div className="manager-tab-scroll"><TabsList size="lg" aria-label="服务器和凭证分类"><TabsTrigger value="servers">服务器</TabsTrigger><TabsTrigger value="credentials">凭证</TabsTrigger><TabsTrigger value="reminders">到期提醒{reminders.length > 0 && <StatusBadge>{reminders.length}</StatusBadge>}</TabsTrigger></TabsList></div>
          {m.tab !== 'reminders' && <Button disabled={unavailable} onClick={() => m.tab === 'servers' ? m.editServer() : m.editCredential()}><Plus />{m.tab === 'servers' ? '添加服务器' : '添加凭证'}</Button>}
          {m.tab === 'reminders' && <Button variant="outline" disabled={unavailable || !m.unreadReminderCount} onClick={() => void m.clearReminders()}>清除红点</Button>}
        </div>
        {m.tab !== 'reminders' && <div className="manager-toolbar manager-filters"><div className="manager-search"><Search size={16} aria-hidden="true" /><Input aria-label={m.tab === 'servers' ? '搜索服务器' : '搜索凭证'} placeholder={m.tab === 'servers' ? '搜索名称、服务商、IP 或用途…' : '搜索名称、账号或分类…'} value={m.query} onChange={e => m.setQuery(e.target.value)} /></div><NativeSelect aria-label={m.tab === 'servers' ? '到期状态筛选' : '凭证类型筛选'} value={m.filter} onChange={e => m.setFilter(e.target.value)}><NativeSelectOption value="all">{m.tab === 'servers' ? '全部状态' : '全部类型'}</NativeSelectOption>{m.tab === 'servers' ? <><NativeSelectOption value="soon">即将到期</NativeSelectOption><NativeSelectOption value="overdue">已过期</NativeSelectOption></> : <><NativeSelectOption value="password">账号密码</NativeSelectOption><NativeSelectOption value="ssh">SSH 密钥</NativeSelectOption></>}</NativeSelect></div>}
        <TabsContent value="servers"><Card className="manager-table-card gap-0 py-0">{servers.length ? <><Table variant="records" className="manager-table" containerProps={{ ref: serverScroll, className: 'manager-list-scroll', tabIndex: 0, role: 'region', 'aria-label': '服务器列表，可滚动查看' }}><colgroup><col className="manager-col-name" /><col className="manager-col-provider" /><col className="manager-col-expiry" /><col className="manager-col-price" /><col className="manager-col-actions" /></colgroup><TableHeader><TableRow><TableHead>服务器 / 用途</TableHead><TableHead>服务商 / 地址</TableHead><TableHead>到期时间</TableHead><TableHead>续费费用</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{visibleServers.map(row => <TableRow key={row.id}>
          <TableCell><div className="manager-cell"><UILink variant="text" href={serverLink(row.id)}>{row.name}</UILink><span>{row.purpose || '用途未填写'}</span></div></TableCell>
          <TableCell><div className="manager-cell"><span>{row.provider || '服务商未填写'}</span><code>{row.address || '地址未填写'}</code></div></TableCell>
          <TableCell><div className="manager-cell"><time>{row.expires || '未填写'}</time><Due row={row} today={m.today} /></div></TableCell>
          <TableCell><div className="manager-cell"><span>{row.price ? `${row.price} ${row.currency}` : '未填写'}</span><span>{row.cycle}</span></div></TableCell>
          <TableCell><div className="manager-actions"><Button variant="ghost" size="sm" disabled={unavailable} onClick={() => m.renew(row)}>登记续费</Button><Button variant="ghost" size="icon-sm" disabled={unavailable} title="删除服务器" aria-label={`删除服务器 ${row.name}`} onClick={() => m.setDialog({ kind: 'delete-server', id: row.id })}><Trash2 /></Button></div></TableCell>
        </TableRow>)}</TableBody></Table>{pager('servers', '服务器', servers.length)}</> : <EmptyState variant="centered"><Server size={28} /><h2>{m.servers.length ? '没有匹配的服务器' : '记录你的第一台服务器'}</h2><p>{m.servers.length ? '试试其他关键词或筛选条件。' : '留下购买信息和到期日，续费时不再翻找。'}</p><Button variant="outline" disabled={unavailable} onClick={() => m.servers.length ? (m.setQuery(''), m.setFilter('all')) : m.editServer()}>{m.servers.length ? '清除筛选' : '添加服务器'}</Button></EmptyState>}</Card></TabsContent>
        <TabsContent value="credentials">
          <Card className="manager-table-card gap-0 py-0">
            {credentials.length ? <>
              <Table variant="records" density="compact" className="manager-credentials-table" containerProps={{ ref: credentialScroll, className: 'manager-list-scroll', tabIndex: 0, role: 'region', 'aria-label': '凭证列表，可滚动查看' }}>
                <colgroup><col className="manager-credential-name" /><col className="manager-credential-account" /><col className="manager-credential-value" /><col className="manager-credential-links" /><col className="manager-credential-actions" /></colgroup>
                <TableHeader><TableRow><TableHead>凭证名称 / 类型</TableHead><TableHead>账号 / 用户名</TableHead><TableHead>密码 / 密钥文件</TableHead><TableHead>关联服务器</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
                <TableBody>{visibleCredentials.map(row => <TableRow key={row.id}>
                  <TableCell><div className="manager-credential-title"><div className="manager-identity">{row.kind === 'ssh' ? <FileKey /> : <KeyRound />}<UILink variant="text" href={credentialLink(row.id)}>{row.name}</UILink></div><span className="meta">{row.kind === 'ssh' ? 'SSH 密钥' : '账号密码'} · {row.category}</span></div></TableCell>
                  <TableCell><span className="manager-credential-text" title={row.username}>{row.username || '未填写'}</span></TableCell>
                  <TableCell>{row.kind === 'password' ? <code className="manager-credential-text" title={row.password}>{row.password || '未填写'}</code> : <div className="manager-credential-files"><KeyFile label="公钥" name={row.publicFile} id={row.publicFileId} model={m} /><KeyFile label="私钥" name={row.privateFile} id={row.privateFileId} model={m} /></div>}</TableCell>
                  <TableCell><span className="meta">{m.serverIndex.byCredential.get(row.id)?.length ?? 0} 台</span></TableCell>
                  <TableCell><div className="manager-actions">{row.kind === 'password' && <Button variant="ghost" size="icon-sm" disabled={!row.password} aria-label={`复制 ${row.name} 的密码`} title="复制密码" onClick={() => void copy(row.password)}><Copy /></Button>}<Button variant="ghost" size="sm" disabled={unavailable} onClick={() => m.editCredential(row)}>编辑</Button><Button variant="ghost" size="icon-sm" disabled={unavailable} title="删除凭证" aria-label={`删除凭证 ${row.name}`} onClick={() => m.setDialog({ kind: 'delete-credential', id: row.id })}><Trash2 /></Button></div></TableCell>
                </TableRow>)}</TableBody>
              </Table>
              {pager('credentials', '凭证', credentials.length)}
            </> : <EmptyState variant="centered"><KeyRound size={28} /><h2>{m.credentials.length ? '没有匹配的凭证' : '常用账号，集中放在这里'}</h2><p>支持网站、软件、服务器账号和 SSH 密钥文件。</p><Button variant="outline" disabled={unavailable} onClick={() => m.credentials.length ? (m.setQuery(''), m.setFilter('all')) : m.editCredential()}>{m.credentials.length ? '清除筛选' : '添加凭证'}</Button></EmptyState>}
          </Card>
        </TabsContent>
        <TabsContent value="reminders"><Card className="manager-detail-card"><div className="manager-section-heading"><div><h2>需要留意的续费</h2><p className="meta">显示未来 30 天内到期及已过期服务器 · 今天 {m.today}</p></div><Bell size={20} /></div>{reminders.length ? <div ref={reminderScroll} className="manager-reminders manager-list-scroll" tabIndex={0} role="region" aria-label="到期提醒列表，可滚动查看">{visibleReminders.map(row => <div className="manager-reminder" key={row.id}><div><UILink variant="text" href={serverLink(row.id)}>{row.name}</UILink><p className="meta">{row.provider || '服务商未填写'} · {row.expires}</p></div><Due row={row} today={m.today} /><span>{row.price ? `${row.price} ${row.currency} / ${row.cycle}` : '金额未填写'}</span><Button variant="outline" size="sm" disabled={unavailable} onClick={() => m.renew(row)}>登记续费</Button></div>)}</div> : <EmptyState variant="centered"><Check size={28} /><h3>暂时没有到期提醒</h3><p>填写服务器到期日后，会在这里显示需要处理的项目。</p></EmptyState>}{reminders.length > 0 && pager('reminders', '到期提醒', reminders.length)}<p className="meta">清除红点仅将当前提醒标为已读，列表与到期状态保留；新的到期提醒会再次亮点。</p></Card>{m.renewals.length > 0 && <Card className="manager-detail-card"><h2>续费记录</h2><div ref={renewalScroll} className="manager-history manager-list-scroll" tabIndex={0} role="region" aria-label="续费记录列表，可滚动查看">{visibleRenewals.map(row => <div className="manager-renewal" key={row.id}><strong>{row.name}</strong>{!m.serverIndex.byId.has(row.serverId) && <span className="meta">服务器已删除</span>}<span>{row.previous || '未填日期'} → {row.next}</span><span className="meta">登记于 {row.date}</span></div>)}</div>{pager('renewals', '续费记录', m.renewals.length)}</Card>}</TabsContent>
      </Tabs>
    </>}
    <FormDialog className="server-manager-dialog" open={!!dialog} onOpenChange={open => { if (!open) m.setDialog(null); }} title={deleting ? dialog?.kind === 'delete-server' ? '删除服务器' : '删除凭证' : dialog?.kind === 'renew' ? '登记续费' : dialog?.kind === 'server' ? `${dialog.id === 'new' ? '添加' : '编辑'}服务器` : `${dialog?.id === 'new' ? '添加' : '编辑'}凭证`} description={deleting ? '请核对以下记录及影响，确认后将删除本地记录。此操作无法撤销。' : dialog?.kind === 'renew' ? '确认已完成续费后，填写新的到期日。' : '保存后写入本地记录；关闭弹窗会保留本次未提交的草稿。'} footer={<div className="manager-actions"><Button variant="outline" autoFocus={deleting} onClick={() => m.setDialog(null)}>{m.busy || m.pending ? '关闭' : '取消'}</Button><Button type="submit" variant={deleting ? 'destructive' : 'default'} form="manager-form" disabled={unavailable || (deleting && !deleteTarget)}>{m.busy ? '正在处理…' : deleting ? '确认删除' : dialog?.kind === 'renew' ? '确认登记' : '保存'}</Button></div>}>
      <form id="manager-form" onSubmit={event => void submit(event)} autoComplete="off"><fieldset className="manager-form" disabled={unavailable}>
        {deleting && <div className="manager-field manager-field--full"><h3 className="manager-delete-name">{deleteTarget?.name ?? '记录已不存在'}</h3>{dialog?.kind === 'delete-server' ? <p>该服务器的资料、登录信息和到期提醒将被删除。关联凭证及已登记的续费历史保留。</p> : <p>{linkedServerCount > 0 ? `同时解除 ${linkedServerCount} 台服务器与此凭证的关联，服务器本身保留。` : '将删除这条凭证记录。'}已导入的密钥副本和原文件保留。</p>}</div>}
        {serverDraft && <>
          {serverField('name', '服务器名称 *', '例如：渲染节点 · 新加坡')}{serverField('provider', '服务商')}{serverField('address', 'IP / 主机地址')}{serverField('region', '地区')}{serverField('configuration', '配置', '例如：8 核 / 32 GB / 200 GB')}{serverField('purpose', '用途')}
          {serverField('loginUsername', '登录用户名', '例如：root 或 administrator')}{serverField('loginPassword', '登录密码（可选）', '直接填写服务器登录密码')}
          <Field id="manager-purchased" title="购买日期"><DateInput id="manager-purchased" label="购买日期" value={serverDraft.purchased} onChange={value => patchServer({ purchased: value })} /></Field><Field id="manager-expires" title="到期日期"><DateInput id="manager-expires" label="到期日期" value={serverDraft.expires} onChange={value => patchServer({ expires: value })} /></Field>
          {serverField('price', '续费金额', '例如：360.00')}
          <Field id="manager-currency" title="币种"><NativeSelect id="manager-currency" value={serverDraft.currency} onChange={e => patchServer({ currency: e.target.value })}>{['CNY', 'USD', 'HKD', 'EUR'].map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></Field>
          <Field id="manager-cycle" title="付费周期"><NativeSelect id="manager-cycle" value={serverDraft.cycle} onChange={e => patchServer({ cycle: e.target.value })}>{['月付', '季付', '年付', '两年付', '三年付', '按量付费', '其他'].map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></Field>
          <Field id="manager-credential" title="关联凭证"><NativeSelect id="manager-credential" value={serverDraft.credentialId} onChange={e => patchServer({ credentialId: e.target.value })}><NativeSelectOption value="">暂不关联</NativeSelectOption>{m.credentials.map(row => <NativeSelectOption value={row.id} key={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect></Field>
          <Field id="manager-notes" title="备注" full><Textarea maxLength={20000} id="manager-notes" value={serverDraft.notes} onChange={e => patchServer({ notes: e.target.value })} /></Field>
        </>}
        {credentialDraft && <>
          {credentialField('name', '凭证名称 *', '例如：素材网站账号')}
          <Field id="manager-category" title="分类"><NativeSelect id="manager-category" value={credentialDraft.category} onChange={e => patchCredential({ category: e.target.value })}>{['网站', '软件', '服务器', '其他'].map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></Field>
          <Field id="manager-kind" title="凭证类型"><NativeSelect id="manager-kind" value={credentialDraft.kind} onChange={e => patchCredential({ kind: e.target.value as CredentialRecord['kind'] })}><NativeSelectOption value="password">账号密码</NativeSelectOption><NativeSelectOption value="ssh">SSH 密钥</NativeSelectOption></NativeSelect></Field>
          {credentialField('username', '账号 / 用户名')}
          {credentialDraft.kind === 'password' ? credentialField('password', '密码 *', '填写密码') : <>
            {(['publicFile', 'privateFile'] as const).map(key => <Field key={key} id={`manager-${key}`} title={key === 'publicFile' ? '公钥文件' : '私钥文件'}><Input key={`${dialog?.id}-${key}-${credentialDraft[key]}`} id={`manager-${key}`} type="file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file && dialog) void m.importFile(dialog.id, key, file); }} /><span className="meta">{credentialDraft[key] ? `已选：${credentialDraft[key]}` : '未选择文件'}</span>{credentialDraft[key] && <Button type="button" variant="ghost" size="sm" onClick={() => patchCredential({ [key]: '', [key === 'publicFile' ? 'publicFileId' : 'privateFileId']: '' })}>取消关联</Button>}</Field>)}
            {credentialField('passphrase', '私钥口令（可选）')}
            <p className="manager-field--full meta">可分别选择公钥、私钥，单个文件不超过 1 MB。文件会复制到应用数据目录，保留原件；取消关联不会删除副本。</p>
          </>}
          {credentialField('website', '网站 / 控制台地址', 'https://example.com')}
          <Field id="manager-notes" title="备注" full><Textarea maxLength={20000} id="manager-notes" value={credentialDraft.notes} onChange={e => patchCredential({ notes: e.target.value })} /></Field>
        </>}
        {renewing && <><div className="manager-field--full"><h3>{renewing.name}</h3><p className="meta">当前到期日：{renewing.expires || '未填写'} · {renewing.price ? `${renewing.price} ${renewing.currency} / ${renewing.cycle}` : '续费金额未填写'}</p></div><Field id="manager-renew-date" title="新的到期日期 *" full><DateInput id="manager-renew-date" label="新的到期日期" value={m.renewalDrafts[renewing.id] ?? ''} onChange={value => { m.setRenewalDrafts(all => ({ ...all, [renewing.id]: value })); m.setError(''); }} /></Field></>}
        </fieldset>
        {recovery}
        {m.error && !m.pending && !m.loadError && <Feedback tone="error" role="alert">{m.error}</Feedback>}
      </form>
    </FormDialog>
  </div>;
}
