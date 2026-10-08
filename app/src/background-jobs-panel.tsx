import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { AgentJobsPanel } from './agent-jobs-panel.tsx';
import { NewsProcessingPanel } from './news-processing-panel.tsx';
import type { AgentJobsController } from './use-agent-jobs.ts';
import type { EditorialController } from './use-news-editorial.ts';
import type { NewsController } from './use-news.ts';
import type { NewsProcessingController } from './use-news-processing.ts';

export function BackgroundJobsPanel({ jobs, editorial, news, processing }: {
  jobs: AgentJobsController; editorial: EditorialController; news: NewsController; processing: NewsProcessingController;
}) {
  return <Tabs defaultValue="news" className="background-jobs">
    <div className="background-jobs-toolbar">
      <TabsList aria-label="后台任务类型">
        <TabsTrigger value="news">资讯处理{editorial.active && <span className="meta"> · 进行中</span>}</TabsTrigger>
        <TabsTrigger value="agent">Agent 整理</TabsTrigger>
      </TabsList>
      <p className="meta">仅在电脑和应用运行时执行</p>
    </div>
    <TabsContent value="news" forceMount className="background-jobs-tab">
      <NewsProcessingPanel model={editorial} news={news} processing={processing}/>
    </TabsContent>
    <TabsContent value="agent" forceMount className="background-jobs-tab">
      <AgentJobsPanel model={jobs}/>
    </TabsContent>
  </Tabs>;
}
