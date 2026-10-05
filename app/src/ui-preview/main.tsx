import { UILink } from '../components/ui/ui-link.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTheme } from '../use-theme.ts';
import { WorkspaceView } from '../App.tsx';
import { resolveRoute } from '../routes.ts';
import { scenes, stateLabels, pageSources, componentSources, styleSources, unregisteredSources } from './catalog.ts';
import type { Scene } from './catalog.ts';
import { Components, demonstratedComponents } from './components.tsx';
import { usePreviewControllers } from './controllers.ts';
import { useStateActions } from './state-actions.ts';
import {usePreviewReader} from './news-reader-fixture.ts';
import { Feedback } from '../components/ui/feedback.tsx';
import sourceInventory from 'virtual:azcine-ui-inventory';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.tsx';
import '../styles/globals.css';
import './preview.css';

const params=new URLSearchParams(location.search);
const filename=(path:string)=>path.split('/').pop()!;
const unregisteredComponents=Object.keys(componentSources).map(filename).filter(name=>!demonstratedComponents.includes(name.replace('.tsx',''))&&!scenes.some(scene=>scene.sources.includes(name)));
function usePreviewTheme() {
  return useTheme({initialTheme:params.get('theme')==='dark'?'dark':'light',persist:false});
}
function PreviewScene({scene,state}:{scene:Scene;state:string}) {
  const models=usePreviewControllers(state),theme=usePreviewTheme();
  const newsReader=usePreviewReader(state);
  const stateError=useStateActions(state);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='azcine-ui-theme')return;
      if(event.data.theme==='light'||event.data.theme==='dark')theme.selectTheme(event.data.theme,undefined,false);
    };
    window.addEventListener('message',receive);
    return()=>window.removeEventListener('message',receive);
  },[theme.selectTheme]);
  useEffect(()=>{if(parent!==window)parent.postMessage({type:'azcine-ui-scene-ready'},location.origin);},[]);
  useEffect(()=>{document.documentElement.dataset.uiScene=scene.id;document.documentElement.dataset.uiState=state;},[scene.id,state]);
  return <div className="catalog-scene" onClickCapture={event=>{
    const anchor=(event.target as Element).closest('a'); const href=anchor?.getAttribute('href');
    if (!href?.startsWith('#') || document.getElementById(href.slice(1))) return;
    event.preventDefault();event.stopPropagation();
    const route=resolveRoute(href);
    if (parent!==window) parent.postMessage({type:'azcine-ui-route',route,theme:theme.theme},location.origin);
    else location.search=`?scene=${encodeURIComponent(route)}&state=normal&theme=${theme.theme}`;
  }}>
    <div className="catalog-fixture-banner"><span>UI 总览 · 虚构资料 · 不执行真实操作</span><span>{scene.title} / {stateLabels[state]??state}</span>{models.notice&&<span role="status">{models.notice}<Button variant="app-text" className="text-action" onClick={models.clearNotice}>关闭提示</Button></span>}{stateError&&<span className="form-error" role="alert">预设未完整展开：{stateError}</span>}</div>
    {scene.route ? <WorkspaceView {...models} {...theme} readerPreview={newsReader.reader} articlePreview={newsReader.detail} route={resolveRoute(`#${scene.route}`)} /> : <Components state={state}/>}
  </div>;
}
const tokenNames=['--bg','--island','--island-2','--island-3','--text','--t2','--acc','--acc-soft','--ink','--ok','--warn','--bad','--line','--line-2'];
function Foundations() {
  const [values,setValues]=useState<Record<string,string>>({});
  useEffect(()=>{const update=()=>{const style=getComputedStyle(document.documentElement);setValues(Object.fromEntries(tokenNames.map(name=>[name,style.getPropertyValue(name).trim()])));};update();const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
  return <section className="catalog-foundations"><h1>主题与样式管理</h1><p>当前整站采用 ShadcnStore 的中性主题、侧栏、顶部栏和卡片体系。应用与此总览使用同一套源码，保存修改后由开发服务实时更新。</p><p><UILink href="https://github.com/shadcnstore/shadcn-dashboard-landing-template" target="_blank" rel="noreferrer">ShadcnStore 免费模板与源码</UILink> · 基于 MIT 授权适配，项目内维护；模板升级先核对差异，再按需迁入。</p>
    <ol className="catalog-usage"><li>在项目根目录运行 <code>npm run dev</code>，随后打开根目录 <code>index.html</code>。这个 HTML 是独立总览，不出现在应用导航中。</li><li>左侧选页面，上方选正常、失败、菜单展开、冲突、确认等状态，再切换亮暗和预览宽度。</li><li>按下面的对应关系修改共享源码并保存。开发服务运行时，总览与应用页面会同步更新；HTML 本身只负责打开总览。</li><li>新增组件或页面后，到“覆盖清单与源码”检查未登记项，并补齐相应的示例、虚构数据和展开预设。</li></ol>
    <div className="catalog-guide"><div><strong>颜色、字体、间距、圆角</strong><code>app/src/styles/tokens.css</code><p>浅色容器保持纯白，亮暗主题在同一处维护。</p></div><div><strong>公共控件与业务变体</strong><code>app/src/components/ui/</code><p>组件源码由项目维护。controls.css 管通用外观，business-controls.css 管业务控件与上下文变体。Button 的 app-* 变体、UILink、Disclosure、Feedback、StatusBadge 和 ActionGroup 都在这里。</p></div><div><strong>单页布局</strong><code>app/src/*-panels.tsx · app/src/styles/</code><p>页面文件负责内容和排列。只调整某页时改该模块；跨页面的控件外观改公共层。</p></div></div>
    <div className="catalog-palette">{tokenNames.map(name=><div key={name}><span style={{background:values[name]}}/><code>{name}</code><small>{values[name]}</small></div>)}</div>
    <div className="catalog-guide"><div><strong>唯一样式入口</strong><code>app/src/styles/globals.css</code><p>Tailwind 分层管理主题、基础样式、组件与工具类，沿用已有 reset。</p></div><div><strong>添加官方组件</strong><code>app/components.json</code><p>从 app 目录使用 shadcn add。先查看差异，保留项目定制，避免覆盖整个主题。</p></div><div><strong>新增页面登记</strong><code>app/src/ui-preview/catalog.ts</code><p>主导航与设置分类自动枚举。详情、状态、组件样例在清单中登记；未登记源码会提示。</p></div></div>
    <h2>后续开发的使用方式</h2><pre className="catalog-code-example">{`import { Button } from '@/components/ui/button';\nimport { UILink } from '@/components/ui/ui-link';\nimport { ActionGroup } from '@/components/ui/action-group';\n\n<ActionGroup>\n  <Button variant="app-pill" className="on">保存</Button>\n  <Button variant="app-text">取消</Button>\n  <UILink href="#settings/models">模型设置</UILink>\n</ActionGroup>`}</pre><p>先选现有变体。业务需要新外观时，在组件与公共样式中增加有名字的变体，并在总览增加示例；不要重新写一个散落在页面里的按钮皮肤。</p><p>总览资料在 <code>ui-preview/data.ts</code> 和 <code>controllers.ts</code>；状态登记在 <code>catalog.ts</code>，菜单打开预设在 <code>state-actions.ts</code>。新增条件分支会自动进入源码索引，是否完成视觉检查仍需明确记录。</p>
    <p className="catalog-doc-links"><UILink variant="plain" href="https://ui.shadcn.com/docs/installation/vite" target="_blank" rel="noreferrer">官方 Vite 接入</UILink><UILink variant="plain" href="https://ui.shadcn.com/docs/theming" target="_blank" rel="noreferrer">官方主题管理</UILink><UILink variant="plain" href="https://ui.shadcn.com/docs/components-json" target="_blank" rel="noreferrer">组件目录配置</UILink></p>
  </section>;
}
function Inventory({openScene}:{openScene:(id:string,state?:string)=>void}) {
  const [source,setSource]=useState('');
  const [sourceLine,setSourceLine]=useState(0),[kind,setKind]=useState('all'),[query,setQuery]=useState('');
  const allSources={...pageSources,...componentSources,...styleSources};
  const sourceText=allSources[source];
  useEffect(()=>{document.querySelector<HTMLElement>('[data-source-active="true"]')?.scrollIntoView({block:'center'});},[source,sourceLine]);
  const indexed=sourceInventory.filter(item=>(kind==='all'||item.kind===kind)&&`${item.file} ${item.name} ${item.variant} ${item.condition}`.toLowerCase().includes(query.toLowerCase()));
  function locate(file:string,line=0) {setSource(Object.keys(allSources).find(path=>path===`../${file}`||filename(path)===file)??'');setSourceLine(line);}
  return <section className="catalog-inventory"><h1>覆盖清单与源码</h1><p>这里记录可以查看的场景，不代表测试通过。新增源码会自动出现在下方；没有登记的项目会明确提示。</p>
    <div className="catalog-inventory-counts"><span>{scenes.length} 个页面 / 控件入口</span><span>{scenes.reduce((n,item)=>n+item.states.length,0)} 个状态入口</span><span>{Object.keys(pageSources).length} 个页面源码</span><span>{Object.keys(componentSources).length} 个组件源码</span></div>
    {(unregisteredSources.length>0||unregisteredComponents.length>0)&&<div className="catalog-error" role="alert"><strong>尚未登记预览</strong><p>{[...unregisteredSources,...unregisteredComponents].join('、')}</p></div>}
    <table className="catalog-coverage-table"><thead><tr><th>页面 / 控件</th><th>可直接打开的状态</th><th>共享源码</th></tr></thead><tbody>{scenes.map(item=><tr key={item.id}><td><Button variant="app-text" onClick={()=>openScene(item.id)}>{item.title}</Button><small>{item.id}</small></td><td><div className="catalog-state-links">{item.states.map(value=><Button key={value} variant="app-text" onClick={()=>openScene(item.id,value)}>{stateLabels[value]??value}</Button>)}</div></td><td>{[...new Set(item.sources)].map(name=><Button variant="app-text" key={name} onClick={()=>locate(name)}>{name}</Button>)}</td></tr>)}</tbody></table>
    <h2>全部业务控件、菜单与条件分支索引</h2><p>递归读取实际 TSX，不依赖页面是否登记。显示源码位置与样式变体；条件分支索引用于查漏，不代表每条分支已经完成视觉验收。</p>
    <div className="catalog-index-filter"><label>类型<NativeSelect value={kind} onChange={event=>setKind(event.target.value)}>{Object.entries({all:'全部',control:'按钮与输入',link:'链接',disclosure:'折叠',menu:'菜单与弹层',feedback:'提示、空态与操作组',condition:'条件分支',collection:'列表与重复控件'}).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label><label>搜索<Input value={query} onChange={event=>setQuery(event.target.value)} placeholder="文件、控件、变体或条件"/></label><span>{indexed.length} / {sourceInventory.length} 项</span></div>
    {sourceInventory.some(item=>item.native)&&<Feedback tone="error" role="alert">发现未经过公共组件的原生控件或链接，请按源码位置核对。</Feedback>}
    <table className="catalog-coverage-table catalog-node-table"><thead><tr><th>位置</th><th>类型 / 变体</th><th>控件或显示条件</th></tr></thead><tbody>{indexed.map((item,index)=><tr key={`${item.file}:${item.line}:${item.kind}:${index}`}><td><Button variant="app-text" onClick={()=>locate(item.file,item.line)}>{item.file}:{item.line}</Button></td><td>{item.kind}<small>{item.variant}</small></td><td><code>{item.condition||item.name}</code></td></tr>)}</tbody></table>
    <div className="catalog-source"><h2>查看实际源码</h2><p>点击上方位置会标出对应行。这里用于查看；修改请保存到实际源码文件。</p><NativeSelect value={source} onChange={event=>{setSource(event.target.value);setSourceLine(0);}} aria-label="选择源码文件"><NativeSelectOption value="">选择文件</NativeSelectOption>{Object.keys(allSources).sort().map(path=><NativeSelectOption key={path} value={path}>{path.replace('../','app/src/')}</NativeSelectOption>)}</NativeSelect>{sourceText&&<pre key={source}><code>{sourceText.split('\n').map((line,index)=><span key={index} className={sourceLine===index+1?'catalog-source-active':undefined} data-source-active={sourceLine===index+1?'true':undefined}><i>{index+1}</i>{line||' '}</span>)}</code></pre>}</div>
  </section>;
}
function Catalog() {
  const theme=usePreviewTheme();
  const [sceneId,setSceneId]=useState(scenes[0].id),[state,setState]=useState('normal'),[width,setWidth]=useState('100%');
  const [query,setQuery]=useState(''),[tab,setTab]=useState<'scenes'|'foundations'|'inventory'>('scenes');
  const current=scenes.find(item=>item.id===sceneId)!;
  const groups=[...new Set(scenes.map(item=>item.group))];
  const [frame,setFrame]=useState<HTMLIFrameElement|null>(null);
  // Keep iframe identity while changing theme, so preview form drafts survive.
  const frameSource=useRef({id:current.id,state,theme:theme.theme});
  if(frameSource.current.id!==current.id||frameSource.current.state!==state)frameSource.current={id:current.id,state,theme:theme.theme};
  function syncFrameTheme(target:HTMLIFrameElement|null) {
    if(!target?.contentWindow)return;
    if(target.contentDocument?.documentElement)target.contentDocument.documentElement.dataset.theme=theme.theme;
    target.contentWindow.postMessage({type:'azcine-ui-theme',theme:theme.theme},location.origin);
  }
  useLayoutEffect(()=>{syncFrameTheme(frame);},[frame,theme.theme]);
  function openScene(id:string,preset='normal') {setSceneId(id);setState(preset);setTab('scenes');}
  useEffect(()=>{const listener=(event:MessageEvent)=>{if(event.source!==frame?.contentWindow||event.origin!==location.origin)return;if(event.data?.type==='azcine-ui-scene-ready'){syncFrameTheme(frame);return;}if(event.data?.type!=='azcine-ui-route')return;const id=event.data.route;if(scenes.some(item=>item.id===id)){if(event.data.theme==='light'||event.data.theme==='dark')theme.selectTheme(event.data.theme,undefined,false);openScene(id);}};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[frame,theme.selectTheme]);
  useEffect(()=>{if(parent!==window)parent.postMessage({type:'azcine-ui-ready',workspace:document.documentElement.dataset.uiWorktree},'*');},[]);
  return <div className="catalog-shell">
    <aside className="catalog-sidebar"><header><strong>AZCine</strong><span>UI 总览</span></header><p>独立入口 · 共享应用源码</p><Input aria-label="搜索页面与状态" placeholder="搜索页面、状态或源码" value={query} onChange={event=>setQuery(event.target.value)}/>
      <nav aria-label="UI 总览分类"><div className="catalog-special"><Button variant={tab==='foundations'?'secondary':'ghost'} onClick={()=>setTab('foundations')}>主题与管理方式</Button><Button variant={tab==='inventory'?'secondary':'ghost'} onClick={()=>setTab('inventory')}>覆盖清单与源码{unregisteredSources.length+unregisteredComponents.length>0&&' · 有待登记项'}</Button></div>
        {groups.map(group=>{const filtered=scenes.filter(item=>item.group===group&&`${item.title} ${item.id} ${item.sources.join(' ')} ${item.states.map(s=>stateLabels[s]).join(' ')}`.toLowerCase().includes(query.toLowerCase()));return filtered.length>0&&<section key={group}><h2>{group}</h2>{filtered.map(item=><Button key={item.id} variant="ghost" aria-current={tab==='scenes'&&item.id===sceneId?'page':undefined} onClick={()=>openScene(item.id)}>{item.title}</Button>)}</section>;})}
      </nav><footer>总览使用虚构资料；覆盖清单不代表真实业务验收。</footer>
    </aside>
    <main className="catalog-main"><header className="catalog-toolbar"><div><strong>{tab==='scenes'?current.title:tab==='foundations'?'主题与管理方式':'覆盖清单与源码'}</strong><span>{tab==='scenes'?'直接渲染真实组件':'独立维护入口'}</span></div><div className="catalog-toolbar-controls">{tab==='scenes'&&<><NativeSelect aria-label="页面状态" value={state} onChange={event=>setState(event.target.value)}>{current.states.map(value=><NativeSelectOption value={value} key={value}>{stateLabels[value]??value}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="预览宽度" value={width} onChange={event=>setWidth(event.target.value)}>{['100%','1440px','1280px','1024px'].map(value=><NativeSelectOption key={value} value={value}>{value==='100%'?'填满预览区':value}</NativeSelectOption>)}</NativeSelect></>}<Button variant="outline" onClick={theme.toggle}>{theme.theme==='light'?'浅色 → 深色':'深色 → 浅色'}</Button></div></header>
      {tab==='scenes'?<div className="catalog-preview-scroll"><iframe ref={setFrame} onLoad={event=>syncFrameTheme(event.currentTarget)} title={`${current.title} · ${stateLabels[state]??state}`} className="catalog-frame" style={{width}} src={`/ui.html?scene=${encodeURIComponent(current.id)}&state=${encodeURIComponent(state)}&theme=${frameSource.current.theme}`}/></div>:<div className="catalog-document">{tab==='foundations'?<Foundations/>:<Inventory openScene={openScene}/>}</div>}
    </main>
  </div>;
}
// A component-only refresh boundary keeps draft state when raw source inventory
// changes. Mounting and the error boundary stay in the separate entry module.
export default function UIPreviewApp() {
  const selected=params.get('scene');
  const scene=selected?scenes.find(item=>item.id===selected):null;
  return selected?(scene?<PreviewScene key={`${scene.id}/${params.get('state')}`} scene={scene} state={params.get('state')??'normal'}/>:<div className="catalog-error">未登记的场景：{selected}</div>):<Catalog/>;
}
