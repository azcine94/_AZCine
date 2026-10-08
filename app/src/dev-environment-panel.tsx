import { Archive, FolderOpen, RefreshCw, Terminal, Package, BookOpen } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Label } from './components/ui/label.tsx';
import { Card, CardContent, CardHeader } from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { LoadingStatus } from './components/ui/loading-status.tsx';
import { Progress } from './components/ui/progress.tsx';
import type { EnvironmentController } from './use-dev-environment.ts';

export function DevEnvironmentPanel({ model }: { model: EnvironmentController }) {
  const running=['running','cancelling'].includes(model.job.status);
  const busy=running || model.scanning || model.choosing;
  const rows=[
    {key:'herdr' as const,title:'Herdr',icon:Terminal,description:'程序、个人设置和插件',version:model.snapshot?.versions.herdr},
    {key:'openpi' as const,title:'OpenPI',icon:Package,description:'程序、运行依赖、配置和扩展',version:model.snapshot?.versions.openpi ? `${model.snapshot.versions.openpi} · Pi ${model.snapshot.versions.pi}` : ''},
    {key:'skills' as const,title:'Skills',icon:BookOpen,description:'单独打包，软链接由你自己建立',version:''},
  ];
  return <div className="dev-environment">
    <div className="dev-environment-intro"><div><h2>把现在的开发环境带走</h2><p>打包本机正在使用的 Herdr 和 OpenPI，换电脑后解压、双击部署。</p></div><Badge variant="secondary">Windows x64</Badge></div>
    {!model.connected && <Feedback>请在 AZCine 桌面版中识别和打包本机环境。</Feedback>}
    <Card><CardHeader><div className="dev-environment-heading"><h3>打包内容</h3><Button variant="outline" size="sm" disabled={busy || !model.connected} onClick={()=>void model.inspect()}><RefreshCw aria-hidden="true"/>重新识别</Button></div></CardHeader>
      <CardContent><div className="dev-environment-sources">{rows.map(row=><section className="dev-environment-source" key={row.key} aria-labelledby={`environment-label-${row.key}`}>
        <div className="dev-environment-source-title"><row.icon aria-hidden="true"/><Label id={`environment-label-${row.key}`} htmlFor={`environment-${row.key}`}>{row.title}</Label>{row.version && <Badge variant="outline">{row.version}</Badge>}</div>
        <p>{row.description}</p><div className="dev-environment-path"><Input id={`environment-${row.key}`} variant="app" value={model.paths[row.key]} placeholder="自动识别，也可以选择实际目录" disabled={busy} onChange={event=>model.change(row.key,event.target.value)} spellCheck={false}/><Button variant="outline" disabled={busy || !model.connected} onClick={()=>void model.browse(row.key)} aria-label={`选择 ${row.title} 目录`}><FolderOpen aria-hidden="true"/>选择</Button></div>
      </section>)}</div><LoadingStatus active={model.scanning} delayMs={200}>正在识别当前环境…</LoadingStatus>
      {model.snapshot?.issues.length ? <Feedback tone="error" role="alert"><ul>{model.snapshot.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></Feedback> : null}
      </CardContent></Card>
    <Card><CardContent className="dev-environment-export"><div><Label htmlFor="environment-output">保存位置</Label><div className="dev-environment-path"><Input id="environment-output" variant="app" placeholder="点击打包时选择保存位置" value={model.output} disabled={busy} onChange={event=>model.setOutput(event.target.value)} spellCheck={false}/><Button variant="outline" disabled={busy || !model.connected} onClick={()=>void model.browse('output')} aria-label="选择保存位置"><FolderOpen aria-hidden="true"/>选择</Button></div></div>
      <div className="dev-environment-heading"><p>生成 <strong>dev-environment.zip</strong> 和 <strong>skills-manager.zip</strong></p><Button disabled={busy || !model.connected} onClick={()=>void model.pack()}><Archive aria-hidden="true"/>一键打包</Button></div>
      <p className="dev-environment-note">不带项目和认证。Codex 只附安装命令；新电脑填写认证、链接 Skills 后使用。</p>
    </CardContent></Card>
    {model.error && <Feedback tone="error" role="alert">{model.error}</Feedback>}
    {running && <Card><CardContent className="dev-environment-progress"><div className="dev-environment-heading"><p role="status">{model.job.message}</p><Button variant="outline" disabled={model.job.status==='cancelling'} onClick={()=>void model.cancel()}>取消打包</Button></div>{model.job.total>0 && <><Progress value={model.job.done/model.job.total*100} aria-label="当前打包阶段进度"/><p className="dev-environment-note">{model.job.done.toLocaleString()} / {model.job.total.toLocaleString()} 个文件</p></>}<p className="dev-environment-note">可以切换页面；退出 AZCine 会停止本次打包。</p></CardContent></Card>}
    {['failed','cancelled'].includes(model.job.status) && <Feedback tone={model.job.status==='failed'?'error':'info'} role={model.job.status==='failed'?'alert':'status'}>{model.job.message}</Feedback>}
    {model.job.status==='completed' && <Card><CardContent className="dev-environment-result"><div className="dev-environment-heading"><h3>打包文件</h3><Button variant="outline" onClick={()=>void model.open()}><FolderOpen aria-hidden="true"/>打开保存目录</Button></div><ul>{model.job.files.map(file=><li key={file}>{file}</li>)}</ul><p className="dev-environment-result-path">{model.job.output}</p><p className="dev-environment-note">上传百度云后，在新电脑下载并解压环境包，双击 deploy.cmd。Skills 包单独解压。</p></CardContent></Card>}
  </div>;
}
