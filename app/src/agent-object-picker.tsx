import {Input} from './components/ui/input.tsx';
import {Button} from './components/ui/button.tsx';
import {FormDialog} from './components/ui/form-dialog.tsx';
import {Checkbox} from './components/ui/checkbox.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import type {AgentObjectsController} from './use-agent-objects.ts';
export function AgentObjectPicker({model,returnFocus}:{model:AgentObjectsController;returnFocus?:HTMLElement|null}){
 return <FormDialog returnFocus={returnFocus} open={model.open} onOpenChange={model.setOpen} title="附加工作台对象" description="发送时读取对象的最新版本；正式记录变更先生成草案，待本人核对。">
  <Input variant="app" type="search" aria-label="搜索工作台对象" placeholder="搜索项目、灵感、文章…" maxLength={200} value={model.query} onChange={event=>model.setQuery(event.target.value)}/>
  {model.error&&<Feedback tone="error">{model.error}</Feedback>}{model.loading&&<p className="meta">正在读取对象目录…</p>}
  {!model.loading&&model.catalog&&!model.catalog.modules.some(module=>module.objects.length)&&<p>{model.query?'没有匹配的对象。':'当前暂无可附加的记录，可以继续附加文件或自由聊天。'}</p>}
  {model.catalog?.modules.filter(module=>module.objects.length).map(module=><section key={module.id}><h3>{module.label??module.id}</h3>{module.hasMore&&<p className="meta">共 {module.total} 项，当前显示前 200 项；输入名称可继续查找。</p>}{module.objects.map(object=><label className="agent-object-option" key={JSON.stringify(object.source)}><Checkbox disabled={model.loading} checked={model.objects.some(source=>JSON.stringify(source)===JSON.stringify(object.source))} onCheckedChange={()=>model.toggle(object.source)}/><span>{object.title}</span></label>)}</section>)}
  <Button onClick={()=>model.setOpen(false)}>保留选择</Button>
 </FormDialog>;
}
