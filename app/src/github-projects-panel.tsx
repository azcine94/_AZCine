import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,Eye,MessageCircle} from 'lucide-react';
import {Button} from './components/ui/button.tsx';
import {Input} from './components/ui/input.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {UILink} from './components/ui/ui-link.tsx';
import {Badge} from './components/ui/badge.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {EmptyState} from './components/ui/empty-state.tsx';
import {ActionGroup} from './components/ui/action-group.tsx';
import {githubAvatar,type GithubController,type GithubProject} from './use-github-projects.ts';
function Avatar({model,item}:{model:GithubController;item:GithubProject}){
  const root=model.root;
  const [image,setImage]=useState('');const owner=item.fullName.split('/')[0];
  useEffect(()=>{let alive=true;setImage('');const request=model.avatar?.(owner)??(root?githubAvatar(root,owner):null);if(request)void request.then(image=>{if(alive)setImage(image);}).catch(()=>{});return()=>{alive=false;};},[root,owner,model.avatar]);
  return image?<img className="gh-avatar" src={image} alt="" loading="lazy" onError={()=>setImage('')}/>:<span className="gh-avatar" aria-hidden="true">{item.name.slice(0,1).toUpperCase()}</span>;
}
const number=new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1});
const date=(value:string)=>value?new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}):'日期未提供';
export function GithubProjectsPanel({model}:{model:GithubController}){
  const [query,setQuery]=useState(''),[language,setLanguage]=useState(''),[month,setMonth]=useState(''),[page,setPage]=useState(1);const start=useRef<HTMLDivElement>(null);
  const items=model.snapshot?.items??[];
  const languages=useMemo(()=>[...new Set(items.map(i=>i.language).filter(Boolean))].sort(),[items]);
  const months=useMemo(()=>[...new Set(items.map(i=>i.updatedAt.slice(0,7)).filter(Boolean))].sort().reverse(),[items]);
  const rows=useMemo(()=>items.filter(i=>(!language||i.language===language)&&(!month||i.updatedAt.startsWith(month))&&(!query.trim()||`${i.name} ${i.fullName} ${i.title} ${i.summary} ${i.author}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),[items,query,language,month]);
  const pages=Math.max(1,Math.ceil(rows.length/20)),current=Math.min(page,pages);
  function navigate(next:number){setPage(next);start.current?.scrollIntoView({block:'start'});}
  return <section className="github-projects" aria-label="GitHub 精选项目">
    <div className="gh-heading"><p>HelloGitHub 精选 · 点击项目直达 GitHub</p><ActionGroup><UILink variant="pill" href="https://hellogithub.com" onClick={e=>{e.preventDefault();void model.open();}}>HelloGitHub ↗</UILink><Button disabled={model.busy||model.loading} onClick={()=>void model.refresh()} loading={!!(model.busy)} loadingText="正在读取…">刷新项目</Button></ActionGroup></div>
    {model.error&&<Feedback tone="error" role="alert">{model.error}{items.length>0?' 已保留本机项目。':''}</Feedback>}
    <p className="gh-notice" role="status">{model.loading?'正在读取本机项目…':model.snapshot?.fetchedAt?`本机缓存更新于 ${new Date(model.snapshot.fetchedAt).toLocaleString('zh-CN')} · 搜索和筛选覆盖已载入项目`:'尚无本机缓存，正在读取公开项目。'}</p>
    <div className="gh-toolbar" ref={start}><Badge variant="secondary">最新精选</Badge><Input variant="app" type="search" aria-label="搜索项目" placeholder="搜索项目名称、介绍或作者…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/><NativeSelect variant="app" aria-label="按语言筛选" value={language} onChange={e=>{setLanguage(e.target.value);setPage(1);}}><option value="">全部语言</option>{languages.map(x=><option key={x}>{x}</option>)}</NativeSelect><NativeSelect variant="app" aria-label="按来源更新时间筛选" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}}><option value="">全部月份</option>{months.map(x=><option key={x}>{x}</option>)}</NativeSelect><span className="gh-count">{rows.length} 个项目</span></div>
    <div className="gh-list" aria-label="开源项目列表">{rows.slice((current-1)*20,current*20).map(item=><UILink variant="plain" className="gh-project" key={item.fullName} href={`https://github.com/${item.fullName}`} onClick={e=>{e.preventDefault();void model.open(item.fullName);}} aria-label={`${item.name}：${item.title}，打开 GitHub 仓库`}>
      <Avatar model={model} item={item}/><div className="gh-project-body"><h2><strong>{item.name}</strong>{item.title&&<span> — {item.title}</span>}</h2><p className="gh-summary">{item.summary||'来源暂未提供中文介绍'}</p><div className="gh-meta"><span>{item.author||item.fullName.split('/')[0]}</span>{item.language&&<span>· {item.language}</span>}<span title="HelloGitHub 来源更新时间">· {date(item.updatedAt)}</span></div></div>
      <div className="gh-stats">{!!item.comments&&<span title="HelloGitHub 评论数"><MessageCircle/>{number.format(item.comments)}</span>}{item.views!==null&&<span title="HelloGitHub 浏览量"><Eye/>{number.format(item.views)}</span>}<span className="gh-open">GitHub <ArrowUpRight/></span></div>
    </UILink>)}</div>
    {!rows.length&&<EmptyState variant="centered"><h2>{model.busy||model.loading?'正在读取项目…':items.length?'没有匹配的项目':'还没有项目'}</h2><p>{items.length?'试试其他关键词，或切换到全部语言和月份。':model.error?'可以点击刷新项目重试。':'读取后会保留本机缓存。'}</p></EmptyState>}
    <div className="gh-footer"><span className="meta">中文介绍来自 HelloGitHub · 浏览与评论数为该站数据 · 日期为来源更新时间</span><ActionGroup><span className="meta">{current} / {pages}</span><Button variant="outline" disabled={current<=1} onClick={()=>navigate(current-1)}>上一页</Button><Button variant="outline" disabled={current>=pages} onClick={()=>navigate(current+1)}>下一页</Button>{model.snapshot?.hasMore&&<Button variant="outline" disabled={model.busy} onClick={()=>void model.refresh(true)}>获取更早项目</Button>}</ActionGroup></div>
  </section>;
}
