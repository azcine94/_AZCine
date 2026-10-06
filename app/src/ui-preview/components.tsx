import { OperationToast, notifyOperation, useOperationNotice } from '../components/ui/operation-toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { Button, appButtonVariants } from '../components/ui/button.tsx';
import { UILink } from '../components/ui/ui-link.tsx';
import { Disclosure } from '../components/ui/disclosure.tsx';
import { Feedback } from '../components/ui/feedback.tsx';
import { LoadingStatus } from '../components/ui/loading-status.tsx';
import { StatusBadge } from '../components/ui/status-badge.tsx';
import { ActionGroup } from '../components/ui/action-group.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Input } from '../components/ui/input.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { NativeSelect,NativeSelectOption } from '../components/ui/native-select.tsx';
import { Label } from '../components/ui/label.tsx';
import { Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter } from '../components/ui/card.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Alert,AlertTitle,AlertDescription } from '../components/ui/alert.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { Progress } from '../components/ui/progress.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { Separator } from '../components/ui/separator.tsx';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '../components/ui/tabs.tsx';
import { Table,TableHeader,TableBody,TableRow,TableHead,TableCell } from '../components/ui/table.tsx';
import { Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from '../components/ui/dialog.tsx';
import { Popover,PopoverTrigger,PopoverContent } from '../components/ui/popover.tsx';
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator } from '../components/ui/dropdown-menu.tsx';
import { Tooltip,TooltipTrigger,TooltipContent,TooltipProvider } from '../components/ui/tooltip.tsx';
import { DateInput } from '../date-input.tsx';
import { FormDialog } from '../components/ui/form-dialog.tsx';
import { MonthInput } from '../components/ui/month-input.tsx';
import { ProjectStagePicker } from '../project-stage-picker.tsx';
import { ProjectAddMenu } from '../project-add-menu.tsx';
import { TableMenu } from '../table-menu.tsx';
import { project } from './data.ts';

export const demonstratedComponents=['button','input','textarea','native-select','label','card','badge','separator','table','tabs','dialog','popover','dropdown-menu','tooltip','checkbox','switch','progress','skeleton','alert','ui-link','disclosure','feedback','loading-status','status-badge','action-group','empty-state','month-input','form-dialog','operation-toast'];
export function Components({state}:{state:string}) {
  const [date,setDate]=useState('2026-10-06'),[stage,setStage]=useState<string|null>(project.labels[0].id);
  const [formOpen, setFormOpen] = useState(state.startsWith('form-dialog-'));
  const [formName, setFormName] = useState(state === 'form-dialog-long' ? '长名称示例'.repeat(20) : '');
  const [month, setMonth] = useState('2026-10');
  const [,setNote]=useOperationNotice('');
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current); }, []);
  function showRefresh(duration: number) {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    setRefreshing(true);
    refreshTimer.current = window.setTimeout(() => { setRefreshing(false); refreshTimer.current = null; }, duration);
  }
  const [labels,setLabels]=useState(project.labels),[labelDraft,setLabelDraft]=useState(state==='stage-error'?'制作中':''),[labelError,setLabelError]=useState(state==='stage-error'?'示例：标签名称重复，输入已保留。':'');
  const [renameDrafts,setRenameDrafts]=useState<Record<string,string>>({});
  function validLabel(name:string,id?:string) {const clean=name.trim();if(!clean||clean.length>80||labels.some(label=>label.id!==id&&label.name===clean)){setLabelError('请填写 1–80 字且不重复的标签名称。');return false;}setLabelError('');return true;}
  const buttonNames:Record<string,string>={'app-pill':'常规按钮','app-text':'文字操作','app-document':'文档操作','app-idea':'灵感操作','app-quiet':'Agent 次要操作','app-primary':'Agent 主操作','app-icon':'图标按钮','app-menu':'菜单项','app-control':'专用控件基础','app-reading-tab':'阅读标签','app-domain':'领域筛选','app-idea-filter':'灵感筛选','app-provider-tab':'服务商标签','app-ranking-tab':'榜单切换','app-scope':'处理范围'};
  return <div className="catalog-components"><OperationToast/>
    <header><h1>通用组件与项目控件</h1><p className="text-muted-foreground mt-2">这里直接使用应用组件。可以打开菜单、日历、弹层，查看焦点、悬停、禁用与选中态。</p></header>
    <div className="catalog-kit-grid">
      <Card><CardHeader><CardTitle>应用实际使用的业务变体</CardTitle><CardDescription>修改 controls.css / business-controls.css 会同步到这些控件及业务页面。专用控件的完整形态见对应页面状态。</CardDescription></CardHeader><CardContent>
        <div className="catalog-business-buttons">{(Object.keys(appButtonVariants) as (keyof typeof appButtonVariants)[]).map(variant=><div key={variant} className="catalog-business-button"><code>{variant}</code><Button variant={variant} onClick={()=>setNote(`${variant}：仅展示操作反馈`)} aria-label={buttonNames[variant]??variant}>{variant==='app-icon'?'＋':buttonNames[variant]??variant}</Button><Button variant={variant} disabled>禁用</Button></div>)}</div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>链接、操作组、状态与折叠</CardTitle><CardDescription>真实公共业务组件，不再另做一份示意样式</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
        <ActionGroup><UILink href="#settings/models">模型设置</UILink><UILink href="#resources">规则与资源</UILink><Button variant="app-text" onClick={()=>setNote('示例文字操作')}>文字操作</Button></ActionGroup>
        <ActionGroup direction="column" aria-label="示例会话操作"><UILink variant="menu" href="#settings/models">模型设置</UILink><UILink variant="menu" href="#resources">规则与资源</UILink><Button variant="app-menu" disabled>断开连接（不可用）</Button></ActionGroup>
        <ActionGroup><StatusBadge>待核对</StatusBadge><StatusBadge tone="success">已完成</StatusBadge><StatusBadge tone="warning">尚未接入</StatusBadge><StatusBadge tone="error">失败</StatusBadge></ActionGroup>
        <Feedback as="p" tone="error" role="alert">示例失败，输入和已有内容保留。</Feedback><Feedback tone="pending">保存回执待核对 <Button variant="app-pill" onClick={()=>setNote('示例核对，不访问业务库')}>核对结果</Button></Feedback>
        <EmptyState><h3>还没有内容</h3><p>空内容说明使用同一公共入口；具体动作由所在页面提供。</p></EmptyState>
        <Disclosure open={state==='error'}><summary>查看详情与限制</summary><div className="dbody">统一折叠标题、图标、间距与键盘焦点；真实页面使用同一组件。</div></Disclosure>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>按钮与状态</CardTitle><CardDescription>主操作、常规操作、危险操作和文字操作</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3">
        <Button>主操作</Button><Button variant="outline">常规操作</Button><Button variant="secondary">次要操作</Button><Button variant="destructive">危险操作</Button><Button variant="ghost">轻操作</Button><Button variant="link">文字操作</Button><Button disabled>不可用</Button>
        <Button variant="app-pill" className="pill on">当前页面主操作</Button><Button variant="app-pill" className="pill">当前页面常规操作</Button><Button variant="app-pill" className="pill" disabled>当前页面禁用</Button>
      </CardContent><CardFooter className="flex flex-wrap gap-2"><Badge>默认</Badge><Badge variant="secondary">处理中</Badge><Badge variant="outline">待确认</Badge><Badge variant="destructive">失败</Badge></CardFooter></Card>
      <Card><CardHeader><CardTitle>输入与选择</CardTitle><CardDescription>文字、长文本、下拉与错误反馈</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
        <Label htmlFor="kit-name">名称</Label><Input id="kit-name" placeholder="输入名称" aria-invalid={state==='error'} />
        <NativeSelect aria-label="示例选择"><NativeSelectOption>全部领域</NativeSelectOption><NativeSelectOption>视觉应用</NativeSelectOption></NativeSelect>
        <Label htmlFor="kit-month">中文月份筛选</Label><MonthInput id="kit-month" value={month} onChange={setMonth} />
        <MonthInput id="kit-month-disabled" value="" onChange={() => {}} disabled />
        <Textarea aria-label="描述" placeholder="填写描述" defaultValue={state==='long'?'较长的中文内容。'.repeat(40):''} />
        <Input aria-label="只读内容" readOnly value="只读资料" /><Input aria-label="禁用输入" disabled placeholder="不可编辑" />
        <div className="flex items-center gap-3"><Checkbox id="kit-checkbox"/><Label htmlFor="kit-checkbox">参与整理</Label><Switch id="kit-switch"/><Label htmlFor="kit-switch">自动采集</Label></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>页面组织与数据表</CardTitle><CardDescription>页签、表格、分隔线</CardDescription></CardHeader><CardContent>
        <Tabs defaultValue="list"><TabsList><TabsTrigger value="list">列表</TabsTrigger><TabsTrigger value="detail">详情</TabsTrigger></TabsList><TabsContent value="list"><Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>示例内容</TableCell><TableCell><Badge variant="secondary">已完成</Badge></TableCell></TableRow><TableRow><TableCell>待核对资料</TableCell><TableCell>待确认</TableCell></TableRow></TableBody></Table></TabsContent><TabsContent value="detail"><p>示例详情内容</p><Separator className="my-4"/><p className="text-muted-foreground">说明与辅助信息</p></TabsContent></Tabs>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>操作提示与生命周期</CardTitle><CardDescription>右上角只显示最新一条；普通提示 4 秒，撤销 6 秒。悬停或聚焦暂停计时。</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">
        <Button data-toast-demo onClick={() => notifyOperation('示例开销已保存。', {tone:'success'})}>保存提示</Button>
        <Button variant="outline" onClick={() => notifyOperation('第二次操作已完成，替换上一条提示。')}>替换提示</Button>
        <Button variant="outline" onClick={() => notifyOperation('示例项目已删除。', {tone:'success',action:{label:'撤销',run:()=>notifyOperation('示例项目已恢复。',{tone:'success'})}})}>带撤销</Button>
        <Button variant="outline" onClick={() => notifyOperation('示例：复制失败，请手动选择内容。',{tone:'error'})}>操作失败</Button>
        <Button variant="outline" onClick={() => notifyOperation('示例长提示：'+ '非常长的导出文件路径与说明，仅用于查看截断和悬停全文。'.repeat(5))}>长文本</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>反馈与读取</CardTitle><CardDescription>失败保留输入；展示真实状态结构</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
        <LoadingStatus active={refreshing} delayMs={300}>正在刷新，已有内容保留…</LoadingStatus>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={refreshing} onClick={() => showRefresh(80)}>演示短刷新</Button><Button variant="outline" disabled={refreshing} onClick={() => showRefresh(1500)}>演示慢刷新</Button></div>
        <Alert variant="destructive"><AlertTitle>示例失败</AlertTitle><AlertDescription>已有内容和输入保留，可以重新操作。</AlertDescription></Alert>
        <Progress value={40} aria-label="示例进度"/><div className="flex gap-3"><Skeleton className="size-10 rounded-full"/><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4"/><Skeleton className="h-4 w-full"/></div></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>创建表单弹窗</CardTitle><CardDescription>各模块共用：限制高度、内容滚动、焦点恢复；关闭保留草稿。</CardDescription></CardHeader><CardContent>
        <Button onClick={() => setFormOpen(true)}>打开创建弹窗</Button>
        <FormDialog open={formOpen} onOpenChange={setFormOpen} title="新建记录" description="这是虚构示例，展示创建表单。关闭后再次打开，输入仍保留。">
          <form className="entry-form" onSubmit={event => { event.preventDefault(); setFormOpen(false); setFormName(''); setNote('示例已保存并收起，未写入业务资料。'); }}>
            <Label htmlFor="kit-form-name">名称</Label><Input id="kit-form-name" value={formName} onChange={event => setFormName(event.target.value)} />
            {state === 'form-dialog-error' && <Feedback tone="error" role="alert">示例保存失败，输入保留。</Feedback>}
            {state === 'form-dialog-pending' && <Feedback tone="pending">示例保存回执待核对，草稿保留。</Feedback>}
            <div className="ui-form-dialog-actions"><Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>关闭，保留草稿</Button><Button disabled={state === 'form-dialog-loading'}>{state === 'form-dialog-loading' ? '正在保存…' : '示例保存'}</Button></div>
            
          </form>
        </FormDialog>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>弹层与菜单</CardTitle><CardDescription>点击查看打开态，Escape 关闭</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3">
        <Dialog defaultOpen={state==='dialog-open'}><DialogTrigger asChild><Button variant="outline">打开对话框</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>核对变更</DialogTitle><DialogDescription>这是虚构示例，用于调整弹层间距与排版。</DialogDescription></DialogHeader><Input aria-label="弹层输入" placeholder="填写名称"/><DialogFooter><Button onClick={()=>setNote('示例操作，不保存业务资料。')}>示例操作</Button></DialogFooter></DialogContent></Dialog>
        <Popover defaultOpen={state==='popover-open'}><PopoverTrigger asChild><Button variant="outline">打开浮层</Button></PopoverTrigger><PopoverContent><p>查看辅助内容和选项。</p><Input className="mt-3" aria-label="浮层输入" placeholder="输入关键词"/></PopoverContent></Popover>
        <DropdownMenu defaultOpen={state==='dropdown-open'}><DropdownMenuTrigger asChild><Button variant="outline">操作菜单</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={()=>setNote('已选择示例编辑')}>编辑</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem disabled>不可用操作</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={()=>setNote('示例移除，不操作真实数据')}>移除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <TooltipProvider><Tooltip defaultOpen={state==='tooltip-open'}><TooltipTrigger asChild><Button variant="outline">悬停提示</Button></TooltipTrigger><TooltipContent>这是辅助说明</TooltipContent></Tooltip></TooltipProvider>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>项目原生控件</CardTitle><CardDescription>沿用项目真实日期、阶段、表格和添加菜单</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
        <DateInput label="交付日期" value={date} onChange={setDate}/><ProjectStagePicker label="当前阶段" labels={labels} currentId={stage} onChange={setStage} labelActions={{draftName:id=>id?renameDrafts[id]??labels.find(label=>label.id===id)?.name??'':labelDraft,changeDraftName:(value,id)=>{if(id)setRenameDrafts(before=>({...before,[id]:value}));else setLabelDraft(value);setLabelError('');},error:labelError,create:name=>{if(!validLabel(name))return false;const id=crypto.randomUUID();setLabels(before=>[...before,{id,name:name.trim()}]);setStage(id);setLabelDraft('');return true;},rename:(id,name)=>{if(!validLabel(name,id))return false;setLabels(before=>before.map(label=>label.id===id?{...label,name:name.trim()}:label));setLabelDraft('');return true;},remove:id=>{setLabels(before=>before.filter(label=>label.id!==id));if(stage===id)setStage(null);return true;}}}/>
        <div className="flex flex-wrap gap-3 project-content"><ProjectAddMenu disabled={false} onAdd={kind=>{setNote(`已选择示例内容类型：${kind}`);return true;}}/><TableMenu label="示例表格操作" disabled={false} actions={[{name:'插入示例行',run:()=>{setNote('示例表格菜单操作');}},{name:'不可用操作',disabled:true,run:()=>{}}]}/></div>
      </CardContent></Card>
    </div>
  </div>;
}
