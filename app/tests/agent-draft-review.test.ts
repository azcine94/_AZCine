import test from 'node:test';
import assert from 'node:assert/strict';
import {draftChanges} from '../src/agent-draft-review.ts';
test('partial status operation shows only the changed field',()=>assert.deepEqual(draftChanges({id:'one',title:'保留',completed:false,revision:1},{completed:true}),[{field:'完成状态',before:'否',after:'是'}]));
test('source configuration compares config values without showing transport fields',()=>assert.deepEqual(draftChanges({config:{name:'原名',enabled:false},revision:1},{name:'新名',enabled:false}),[{field:'名称',before:'原名',after:'新名'}]));
test('project table edits use the existing column label and stable row identity',()=>{
 const before={blocks:[{id:'list',title:'镜头表',columns:[{id:'date',name:'交期'}],rows:[{id:'row',cells:{date:'2026-10-07'}}]}]};
 const after=structuredClone(before);after.blocks[0].rows[0].cells.date='2026-10-08';
 const changes=draftChanges(before,after);assert.equal(changes.length,1);assert.match(changes[0].field,/交期/);assert.equal(changes[0].before,'2026-10-07');assert.equal(changes[0].after,'2026-10-08');
});
test('新增镜头行的核对内容使用列名并隐藏内部编号',()=>{
 const before={blocks:[{id:'list',title:'镜头表',columns:[{id:'internal-column',name:'镜头编号'}],rows:[]}]};
 const after={blocks:[{...before.blocks[0],rows:[{id:'internal-row',cells:{'internal-column':'WOW_0241'}}]}]};
 const changes=draftChanges(before,after);assert.equal(changes.length,1);assert.match(changes[0].after,/镜头编号：WOW_0241/);assert.doesNotMatch(changes[0].after,/internal-/);
});
test('removed rows remain visible for human review',()=>{
 const changes=draftChanges({items:[{id:'a',text:'需要保留',checked:false}]},{items:[]});
 assert.equal(changes.length,1);assert.match(changes[0].before,/需要保留/);assert.equal(changes[0].after,'无');
});
test('receipt metadata does not turn an unchanged attachment into a proposed edit',()=>{
 assert.deepEqual(draftChanges({receipts:[{id:'a',name:'票据'}],note:'原备注'},{receiptIds:['a'],note:'新备注'}),[{field:'备注',before:'原备注',after:'新备注'}]);
});
test('clearing a stored table cell shows the original value for review',()=>{
 const changes=draftChanges({blocks:[{id:'list',columns:[{id:'date',name:'交期'}],rows:[{id:'row',cells:{date:'2026-10-07'}}]}]},{blocks:[{id:'list',columns:[{id:'date',name:'交期'}],rows:[{id:'row',cells:{}}]}]});
 assert.equal(changes.length,1);assert.match(changes[0].field,/交期/);assert.equal(changes[0].before,'2026-10-07');assert.equal(changes[0].after,'无');
});
