import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRange} from '../src/self-evolution-types.ts';
test('Shift selects only the visible range and preserves selections on other pages',()=>{
  assert.deepEqual([...selectRange(new Set(['other']),['a','b','c','d'],'a','c',true,true)].sort(),['a','b','c','other']);
});
test('Ctrl deselection keeps unrelated selections and reverse Shift can remove a range',()=>{
  assert.deepEqual([...selectRange(new Set(['a','b','c']),['a','b','c'],'a','b',false,false)],['a','c']);
  assert.deepEqual([...selectRange(new Set(['a','b','c','other']),['a','b','c'],'c','a',false,true)],['other']);
});
test('A filtered-out anchor does not select hidden candidates',()=>{
  assert.deepEqual([...selectRange(new Set(),['b','d'],'a','d',true,true)],['d']);
});
