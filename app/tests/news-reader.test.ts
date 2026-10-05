import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPipeline,parsePipeline,parseReader,parseArticle,parseDetail} from '../src/news-reader-contract.ts';
test('Legacy preferences receive new independent stage configuration without changing existing values',()=>{assert.deepEqual(parsePipeline(undefined),defaultPipeline());const v=defaultPipeline();v.models.score={provider:'fixture',id:'fixture'};v.requestsPerMinute=0;assert.equal(parsePipeline(v).models.score?.id,'fixture');assert.throws(()=>parsePipeline({...v,requestsPerMinute:-1}));assert.throws(()=>parsePipeline({...v,models:{constructor:{provider:'fixture',id:'fixture'}}}));assert.throws(()=>parsePipeline({...v,sources:[{sourceId:'fixture',tier:'invalid',fetchBody:true,displayBody:true}]}));});
test('Incomplete reader data fails visibly instead of displaying partial articles',()=>{assert.throws(()=>parseReader({items:[],stories:[],editions:[],total:0,taxonomy:null}));assert.throws(()=>parseArticle({id:'legacy-event-id',titleZh:'Fixture',summaryZh:'Fixture',material:{url:'https://example.org',sourceName:'Fixture'},tags:[]}));assert.throws(()=>parseDetail({article:null,bookmarked:true,position:0,related:[],steps:[]}));});


import {resolveRoute} from '../src/routes.ts';
test('Old history bookmarks return to the single news reader',()=>{assert.equal(resolveRoute('#news/history'),'news');});
