import { useLayoutEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { NewsSourceManager, NewsSourceEditor } from './news-panels.tsx';
import { NewsProcessingPanel } from './news-processing-panel.tsx';
import type { Route } from './routes.ts';
import type { NewsController } from './use-news.ts';
import type { EditorialController } from './use-news-editorial.ts';
import type { NewsProcessingController } from './use-news-processing.ts';

export function SourcesWorkspace({route,sourceId,news,editorial,processing}:{route:Route;sourceId:string|null;news:NewsController;editorial:EditorialController;processing:NewsProcessingController}){
  const tab=route==='sources/processing'?'processing':'sources';
  const content=useRef<HTMLDivElement>(null);
  const positions=useRef<Record<string,number>>({});
  useLayoutEffect(()=>{
    const node=content.current;
    node?.scrollTo(0,positions.current[route]??0);
    return()=>{if(node)positions.current[route]=node.scrollTop;};
  },[route]);
  return <Tabs value={tab} onValueChange={value=>{location.hash=value==='processing'?'sources/processing':'sources';}} className="sources-workspace">
    <TabsList variant="line" aria-label="信源页面">
      <TabsTrigger value="sources">信源管理</TabsTrigger>
      <TabsTrigger value="processing">处理与记录</TabsTrigger>
    </TabsList>
    <div ref={content} className="sources-content">
      <TabsContent value="sources" forceMount className="sources-tab">
        <div hidden={!!sourceId&&sourceId!=='new'}><NewsSourceManager model={news} create={sourceId==='new'}/></div>
        {sourceId&&sourceId!=='new'&&<NewsSourceEditor model={news} sourceId={sourceId}/>}
      </TabsContent>
      <TabsContent value="processing" forceMount className="sources-tab"><NewsProcessingPanel model={editorial} news={news} processing={processing}/></TabsContent>
    </div>
  </Tabs>;
}
