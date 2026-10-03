// Synthetic business presentation shared by real SQLite and the approved HTML reference.
// Reference adaptation is test-memory-only: one shot per row, independent date/delivered,
// full-year dates and derived card copy. No production/prototype source is rewritten.
const { randomUUID } = require('node:crypto');
function projectPresentation() {
  const ids = Object.fromEntries(['project','intro','list','references','acopy','bcopy','final','shot','stage','date','done','note','a','b','c'].map(key => [key, randomUUID()]));
  const document = { id: ids.project, name: '雾港 · 片头', labels: ['acopy','bcopy','final'].map(key => ({ id: ids[key], name: key.toUpperCase() })), blocks: [
    { id: ids.intro, kind: 'text', title: '项目说明', body: '虚构示例 · 用于查看项目界面，不是真实工作资料。\n片头镜头的工作记录放在这里。交付安排在下方清单，参考资料与修改意见可以继续往文档里添加。' },
    { id: ids.list, kind: 'list', title: '镜头交付清单', included: true, columns: [
      { id: ids.shot, name: '镜头 / 事项', kind: 'shot' }, { id: ids.stage, name: '阶段', kind: 'stage' },
      { id: ids.date, name: '当前交期', kind: 'date' }, { id: ids.done, name: '已交完', kind: 'delivered' }, { id: ids.note, name: '备注', kind: 'text' }
    ], rows: [['a','FG_021','bcopy','2026-10-14','灯光合成预览'],['b','FG_024','bcopy','2026-10-14','材质灯光预览'],['c','FG_028','final','2026-10-20','最终序列']].map(([key,shot,stage,date,note]) => ({ id: ids[key], cells: { [ids.shot]: shot, [ids.stage]: ids[stage], [ids.date]: date, [ids.done]: 'false', [ids.note]: note } })) },
    { id: ids.references, kind: 'text', title: '参考资料', body: '在这里粘贴资料说明、原始链接或工作笔记。自由文字不会自动变成交付日期。' }
  ] };
  return { ids, document };
}
function referenceScript(source, document) {
  const table = document.blocks[1], cols = Object.fromEntries(table.columns.map(column => [column.kind, column.id]));
  const sample = {
    id: 'film', group: 'company', name: document.name, description: document.blocks.map(block => block.title).join(' · '),
    tags: document.labels.map(label => ({ id: label.id, name: label.name })),
    blocks: document.blocks.map((block, index) => block.kind === 'text' ? { id: index === 0 ? 'intro' : 'references', type: 'text', title: block.title, text: block.body } : {
      id: 'deliveries', type: 'table', title: block.title, summarize: true,
      columns: [ {id:'subject',role:'subject',name:'镜头 / 事项',type:'text'}, {id:'stage',role:'stage',name:'阶段',type:'stage'}, {id:'date',role:'date',name:'当前交期',type:'date'}, {id:'status',role:'status',name:'已交完',type:'status'}, {id:'note',name:'备注',type:'text'} ],
      rows: table.rows.map((row, index) => ({id: `d${index + 2}`, cells: {subject:row.cells[cols.shot],stage:row.cells[cols.stage],date:row.cells[cols.date],status:row.cells[cols.delivered] === 'true' ? '已提交' : '未提交',note:row.cells[cols.text]}}))
    }), sourceDraft:{name:'',text:'',fileName:''},pending:null,reviewed:false
  };
  const start = source.indexOf('  const projects=[{'), end = source.indexOf('  const createDraft=', start);
  if (start < 0 || end < 0) throw Error('Approved reference fixture anchor changed');
  return source.slice(0, start) + `  const projects=${JSON.stringify([sample])};\n` + source.slice(end);
}
module.exports = { projectPresentation, referenceScript };
