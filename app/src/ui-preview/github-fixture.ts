import {useCallback,useState} from 'react';
import type {GithubController,GithubProject} from '../use-github-projects.ts';
import {notifyOperation} from '../components/ui/operation-toast.tsx';
export function usePreviewGithub(state:string):GithubController{
  const [busy,setBusy]=useState(state==='busy');
  const items:GithubProject[]=state==='empty'||state==='loading'?[]:Array.from({length:45},(_,i)=>({id:`fixture-${i}`,name:`project-${i+1}`,fullName:`fixture/project-${i+1}`,title:state==='long'?'用于检查长标题自动换行的项目介绍'.repeat(9):['轻量化的本地工作台','面向开发者的开源工具','简洁的图像处理库'][i%3],summary:state==='long'?'这是一段用于检查布局的虚构中文项目简介。'.repeat(20):'提供清晰的操作界面和完整的使用说明，支持本地运行。这是界面验证用的虚构项目。',author:'Fixture',language:['TypeScript','Rust','Python'][i%3],updatedAt:`2026-0${9-i%3}-08T09:00:00+08:00`,views:1500+i*50,comments:i%5}));
  const avatar=useCallback(async()=>{if(state==='github-avatar-error')throw new Error('fixture image failure');return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" rx="8" fill="#525252"/><text x="30" y="40" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white">G</text></svg>');},[state]);
  return {root:null,snapshot:{items,fetchedAt:'2026-10-09T10:00:00Z',hasMore:true,nextPage:4,revision:1},loading:state==='loading',busy,error:state==='error'?'示例：公开来源暂时无法连接，已有项目保留。':'',avatar,refresh:async()=>{setBusy(true);await new Promise(resolve=>setTimeout(resolve,200));setBusy(false);notifyOperation('示例：刷新完成，已有项目保留。');},open:async(name)=>{notifyOperation(`示例：打开 ${name??'HelloGitHub'}，总览不访问外部页面。`);}};
}
