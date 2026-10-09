import { useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { Progress } from './components/ui/progress.tsx';
import { useAppUpdate } from './use-app-update.ts';
import type { AppUpdateController } from './use-app-update.ts';

export function AppUpdatePanel({preview}:{preview?:AppUpdateController}) {
  const actual=useAppUpdate(),model=preview??actual;
  const {status}=model;
  const [confirm,setConfirm]=useState(false);
  const busy=['checking','downloading','installing'].includes(status.stage);
  const percent=status.total ? Math.min(100,Math.floor(status.downloaded/status.total*100)) : null;
  const message={idle:'主动检查后获取最新正式版本。',checking:'正在检查更新…',current:'当前已是最新版本。',available:'发现新版本，可下载后再安装。',downloading:'正在下载更新，下载完成后会校验签名。',ready:'更新已下载并通过签名校验，可以安装。',installing:'正在结束运行任务并启动安装，应用将退出并重新打开。',error:'检查更新未完成。'}[status.stage];
  return <section className="settings-page app-update-page">
    <header className="settings-page-header"><h2>关于与更新</h2><p className="subtle">查看 AZCine 版本，获取 Windows 正式版更新。</p></header>
    <div className="settings-row"><div><h3>AZCine</h3><p className="meta">Windows · x64</p></div><p className="app-update-version">{status.version?`v${status.version}`:'读取版本中…'}<span className="meta">{status.enabled?'正式版':'本地开发版'}</span></p></div>
    {!model.connected?<Feedback tone="info">网页预览无法检查或安装更新。</Feedback>:!status.enabled?<Feedback tone="info">开发版通过源码更新，不安装正式版更新。</Feedback>:<>
      <p role="status" aria-live="polite">{message}</p>
      {status.nextVersion&&<div className="app-update-release"><h3>新版本 v{status.nextVersion}</h3><p className="app-update-notes">{status.notes||'此版本未提供更新说明。'}</p></div>}
      {status.stage==='downloading'&&<div className="app-update-download"><Progress value={percent} aria-label="更新下载进度"/><p className="meta">已下载 {(status.downloaded/1048576).toFixed(1)} MB{status.total?` / ${(status.total/1048576).toFixed(1)} MB · ${percent}%`:''}</p></div>}
      <div className="form-actions">
        <Button variant="outline" disabled={busy} onClick={()=>void model.check()} loading={!!(status.stage==='checking')} loadingText="正在检查…">检查更新</Button>
        {status.stage==='available'&&<Button onClick={()=>void model.download()}>下载更新</Button>}
        {status.stage==='ready'&&<Button onClick={()=>setConfirm(true)}>安装并重启</Button>}
      </div>
      <p className="meta">更新来自 AZCine 的 GitHub Releases。安装保留数据目录，开始前请保存编辑并结束正在运行的任务。</p>
    </>}
    {(model.requestError||status.error)&&<Feedback tone="error" role="alert">{model.requestError||status.error}</Feedback>}
    <FormDialog open={confirm} onOpenChange={setConfirm} title="安装更新并重启" description="请确认已保存所有编辑。应用将停止本应用的 Agent 和后台任务，然后安装更新；数据目录保留。">
      <div className="ui-form-dialog-actions"><Button variant="outline" onClick={()=>setConfirm(false)}>暂不安装</Button><Button onClick={()=>{setConfirm(false);void model.install();}}>已保存，安装并重启</Button></div>
    </FormDialog>
  </section>;
}
