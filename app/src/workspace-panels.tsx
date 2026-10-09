import { Feedback } from './components/ui/feedback.tsx';
import { Button } from './components/ui/button.tsx';
import { FormDialog, useCreationDialog } from './components/ui/form-dialog.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { displayPath } from './lib/display-path.ts';
import type { WorkspaceController } from './use-workspace.ts';

function WorkspaceFeedback({ model }: { model: WorkspaceController }) {
  return <div className="workspace-feedback" aria-live="polite">
    {model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}
    
  </div>;
}
export function WorkspaceGate({ model }: { model: WorkspaceController }) {
  if (!model.connected) return <section className="data-panel"><h2>需要桌面连接</h2><p>当前为网页预览，不能保存记录。请从项目根运行 npm run dev。</p></section>;
  if (model.loading && !model.workspace) return <p role="status">正在读取数据目录…</p>;
  if (model.loadError) return <section className="data-panel"><h2>数据目录未能打开</h2><Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback><Button variant="app-pill" className="pill" disabled={model.loading || !!model.busy} onClick={() => void model.refresh()}>重新读取</Button><p className="meta">不会自动改用空数据库。</p></section>;
  return <section className="data-panel" data-storage-setup>
    <h2>把记录保存在本机</h2><p className="subtle">灵感、项目、附件与 Pi 资料都放在这个目录。</p>
    <form className="entry-form" onSubmit={e => { e.preventDefault(); void model.selectRoot(); }}>
      <label htmlFor="data-root">数据目录</label><Input variant="inline" id="data-root" value={model.rootDraft} disabled={!!model.busy} onChange={e => model.changeRoot(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="data-root-help" />
      <p id="data-root-help" className="meta">{model.workspace?.defaultRoot ? '默认使用系统文档目录，可改为其他专用目录。' : '系统文档目录暂不可用，请选择一个可用的专用目录。'}可选择空目录或完整下载的已有 AZCine 数据目录；已有数据不会被覆盖或合并。之后可在设置中更改。</p>
      <div className="form-actions"><Button variant="app-pill" type="button" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.pickRoot()}>选择目录</Button><Button variant="app-pill" className="pill on" disabled={!!model.busy || model.loading} loading={!!(model.busy === 'select-root')} loadingText="正在保存…">使用此目录</Button></div>
    </form><WorkspaceFeedback model={model} />
  </section>;
}
export function DataSettings({ model }: { model: WorkspaceController }) {
  const change = useCreationDialog();
  const disabled = !!model.busy || model.loading;
  async function save() {
    const session = change.session.current;
    if (await model.scheduleRootChange()) change.finish(session);
  }
  if (!model.workspace?.root || model.loadError) return <WorkspaceGate model={model} />;
  return <section className="foundation-section data-panel data-directory-settings">
    <header className="settings-page-header"><h2>数据目录</h2><p className="subtle">查看或更改当前使用的数据位置。</p></header>
    <div className="data-directory-current">
      <div className="data-directory-label"><h3>当前目录</h3><p className="meta">灵感、项目、资讯与附件等业务资料保存在这里。</p></div>
      <p className="path-text data-directory-path" data-current-root>{displayPath(model.workspace.root)}</p>
      <div className="form-actions">
        <Button variant="app-pill" className="pill" disabled={disabled} onClick={() => void model.openRoot()}>打开目录</Button>
        <Button variant="app-pill" className="pill" disabled={disabled || model.rootChangeScheduled} onClick={() => change.setOpen(true)}>更改数据目录</Button>
        <Button variant="app-pill" className="pill" disabled={disabled} onClick={() => void model.refresh()}>重新读取</Button>
      </div>
    </div>
    {model.rootChangeScheduled && <Feedback as="div" tone="info"><p>已安排更改到：{displayPath(model.rootChangePath)}。请正常退出并重新打开，旧目录会保留。</p><Button variant="app-pill" disabled={disabled} onClick={() => void model.cancelRootChange()}>取消更改</Button></Feedback>}
    {model.workspace.rootChangeNotice && <Feedback as="p" tone="info">{model.workspace.rootChangeNotice}</Feedback>}
    <aside className="data-directory-help" aria-label="换机与同步说明"><h3>换机与同步</h3><p className="meta">先退出旧电脑上的应用，待 OneDrive 同步完成。在新电脑完整下载数据目录，再选择该目录。</p><p className="meta">不要在两台电脑同时编辑同一份数据。</p></aside>
    <FormDialog open={change.open} onOpenChange={open => { if (!model.busy) change.setOpen(open); }} title="更改数据目录" description="下次启动时生效。原目录始终保留，两份数据不会合并。">
      <form className="entry-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="root-change-mode">更改方式</label>
        <NativeSelect id="root-change-mode" value={model.rootChangeMode} disabled={disabled} onChange={event => model.setRootChangeMode(event.target.value as 'migrate' | 'switch')}>
          <option value="migrate">迁移当前数据到新空目录</option><option value="switch">切换到已有 AZCine 数据目录</option>
        </NativeSelect>
        <p className="meta">{model.rootChangeMode === 'migrate' ? '复制当前业务记录、附件和数据根内的 Pi 资料，校验完成后使用新目录；目标必须为空。' : '使用目标目录原有的记录和 Pi 资料；当前记录留在原目录，不复制或合并。'}</p>
        <label htmlFor="root-change-path">目标目录</label><Input id="root-change-path" value={model.rootChangePath} disabled={disabled} onChange={event => model.setRootChangePath(event.target.value)} autoComplete="off" spellCheck={false} />
        <p className="meta">本次关闭前请保存其他页面的编辑、结束正在运行的任务。数据根内的 Pi 认证也会随迁移复制，请仅选择本人管理的目录。</p>
        <div className="form-actions"><Button type="button" variant="app-pill" disabled={disabled} onClick={() => void model.pickRootChange()}>选择目录</Button><Button type="submit" variant="app-primary" disabled={disabled} loading={!!(model.busy === 'change-root')} loadingText="正在保存…">保存，下次启动生效</Button></div>
        <WorkspaceFeedback model={model} />
      </form>
    </FormDialog>
    {!change.open && <WorkspaceFeedback model={model} />}
  </section>;
}
