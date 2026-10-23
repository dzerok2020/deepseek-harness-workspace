import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,original} from './harness.mjs';
const source=process.env.CANDIDATE?fs.readFileSync(process.env.CANDIDATE,'utf8'):original;
const unchanged=f=>JSON.stringify(f.session.state);

test('full preflight recovers oversized active summary pair using bounded subcalls',async()=>{
 const f=fixture(source);const r=await f.run();
 assert.equal(r.fitsWindow,true,JSON.stringify(r));
 assert.ok(f.calls.length>=2);assert.equal(f.applies.length,1);
 assert.ok(f.calls.every(c=>c.content.length<=60000));
});
test('fitting pair keeps one model call and one apply',async()=>{const f=fixture(source,{size:29900,limit:30000,wireOverhead:16000});const r=await f.run();assert.equal(r.fitsWindow,true);assert.equal(f.calls.length,1);assert.equal(f.applies.length,1)});
test('30000 char pair includes headers and splits rather than rejects',async()=>{const f=fixture(source,{size:30000,limit:14000});assert.equal((await f.run()).fitsWindow,true);assert.ok(f.calls.length>=2)});
test('raw gaps remain intact in ordered source chunks',async()=>{const gap='RAW_GAP_UNIQUE'.repeat(100);const f=fixture(source,{gap});await f.run();assert.ok(f.calls.map(c=>c.content).join('').includes(gap));assert.equal(f.applies.length,1)});
test('token budget and system/output headroom also bound every chunk',async()=>{const f=fixture(source,{size:20000,limit:12000,tokenScale:1});await f.run();assert.ok(f.calls.length>1);for(const c of f.calls){assert.ok(c.content.length<=7200);assert.ok(c.content.length+c.system.length+256+2000<=12000)}});
for(const [label,reply] of [['unusable',n=>n===2?{unusable:'offline empty'}:{summary:'valid '.repeat(30)}],['throw',n=>{if(n===2)throw Error('offline failure');return{summary:'valid '.repeat(30)}}]])test('partial '+label+' failure preserves blocks and counts both attempts',async()=>{const f=fixture(source,{reply});const before=unchanged(f);const r=await f.run();assert.equal(f.calls.length,2);assert.equal(f.applies.length,0);assert.equal(unchanged(f),before);assert.match(r.failure.detail,/2 summary call/)});
test('over-six-chunk span dispatches nothing and reports cap honestly',async()=>{const f=fixture(source,{size:300000,limit:18000});const before=unchanged(f);const r=await f.run();assert.equal(f.calls.length,0);assert.equal(f.applies.length,0);assert.equal(unchanged(f),before);assert.match(r.failure.detail,/bounded distillation call budget/)});
test('joined maxSummaryLength failure never truncates or applies',async()=>{const f=fixture(source,{maxSummary:500,reply:()=>({summary:'z'.repeat(400)})});const before=unchanged(f);const r=await f.run();assert.equal(f.applies.length,0);assert.equal(unchanged(f),before);assert.equal(r.fitsWindow,false);assert.ok(f.logs.some(l=>l.text.includes('exceeds maxSummaryLength')))});
test('apply refusal remains authoritative and leaves blocks intact',async()=>{const f=fixture(source,{refuse:true});const before=unchanged(f);const r=await f.run();assert.equal(f.applies.length,1);assert.equal(unchanged(f),before);assert.equal(r.fitsWindow,false);assert.ok(f.logs.some(l=>l.text.includes('hard-protected')))});
test('no-shrink measurement remains failure rather than false success',async()=>{const f=fixture(source,{noShrink:true});const r=await f.run();assert.equal(r.fitsWindow,false);assert.equal(f.applies.length,1);assert.match(r.failure.detail,/no further shrink/)});
test('abort after last reply still prevents apply',async()=>{let f;f=fixture(source,{reply:()=>{f.signal.aborted=true;return{summary:'valid '.repeat(30)}}});const before=unchanged(f);await f.run();assert.equal(f.calls.length,1);assert.equal(f.applies.length,0);assert.equal(unchanged(f),before)});
test('shared preflight summaryBudget reserves all chunks before dispatch',async()=>{const f=fixture(source,{size:100000,maxCalls:1});const before=unchanged(f);const r=await f.run();assert.equal(f.calls.length,0);assert.equal(f.applies.length,0);assert.equal(unchanged(f),before);assert.equal(r.fitsWindow,false)});
test('aborted input dispatches and applies nothing',async()=>{const f=fixture(source,{aborted:true});const r=await f.run();assert.equal(f.calls.length,0);assert.equal(f.applies.length,0);assert.equal(r.failure.kind,'aborted')});
