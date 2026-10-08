import { Disclosure } from './components/ui/disclosure.tsx';
import { MessageMarkdown } from './components/ui/message-markdown.tsx';
import type { TaskView } from './task-panel-contract.ts';

// Older generated tasks put the wire contract in goal. Only move recognised
// boilerplate out of the reading view; unknown text stays visible and the full
// original remains available. This never changes stored or dispatched content.
const protocolSentence = /^(?:任务包\s+allowed_actions\s+中\s+render_architecture|先用包中的\s+agent_cli|阻塞和完成也必须调用\s+submit_result|三件产物必须共享\s+analysis_id|graph-facts\s+字段[：:]|初始图基线使用派发包\s+graphRevision|产物交到本次派发包\s+output_directory|任务包未派发时先不执行|目录归属于\s|接收和交付均用\s+submit_result|交付按\s+task-result-v1)/;

function readableGoal(goal: string) {
  // Keep existing Markdown formatting intact for ordinary tasks. Separate
  // sentences when older plain text mixes the objective with the contract.
  const sentences = goal.match(/[^。！？\n]+[。！？]?/g) ?? [];
  const hasProtocol = sentences.some(sentence => protocolSentence.test(sentence.trim()));
  if (!hasProtocol) {
    const text = goal.trim();
    // Older plain-text descriptions can be one long paragraph. Give each
    // sentence room without rewriting paths, colour values or requirements.
    return text.length > 180 && !/[\n`*]/.test(text)
      ? sentences.map(sentence => sentence.trim()).join('\n\n')
      : text;
  }
  return sentences.filter(sentence => !protocolSentence.test(sentence.trim()))
    .map(sentence => sentence.trim().replace(/^按所选 Archify Skill 在允许范围\s*\[[^\]]*\]\s*查证\s*/, '使用 Archify 分析仓库，重点查证：'))
    .join('\n\n');
}

export function TaskContent({ task }: { task: TaskView }) {
  const goal = readableGoal(task.goal);
  return <div className="tp-task-content">
    <section><h3>本次要做什么</h3>{goal ? <div className="tp-task-copy"><MessageMarkdown text={goal} /></div> : <p className="tp-meta">{task.goal.trim() ? '任务说明中只有交接约定，请补充具体目标。' : '任务目标尚未补充。'}</p>}</section>
    <section><h3>改动或分析范围</h3>{task.scope.length ? <ul className="tp-plain-list tp-task-scope">{task.scope.map(scope => <li key={scope}>{scope === '.' ? '整个仓库' : <code>{scope}</code>}</li>)}</ul> : <p className="tp-meta">尚未指定范围。</p>}</section>
    <section><h3>怎样算完成</h3>{task.criteria.length ? <ol className="tp-criteria">{task.criteria.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ol> : <p className="tp-meta">尚未填写完成条件。</p>}</section>
  </div>;
}

export function TaskOriginal({ task }: { task: TaskView }) {
  return <Disclosure key={task.id}>
    <summary>任务原文与 Agent 交接约定</summary>
    <div className="tp-task-original"><h3>完整任务说明</h3><div className="tp-task-copy"><MessageMarkdown text={task.goal || '任务目标尚未补充。'} /></div><h3>来源</h3><p className="tp-source">{task.source || '未提供'}</p></div>
  </Disclosure>;
}
