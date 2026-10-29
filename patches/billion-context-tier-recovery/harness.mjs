import {loadOriginal} from './original.mjs';
import vm from 'node:vm';
export {OWNER as owner} from './original.mjs';
export function extract(source,name,end){const start=source.indexOf(`function ${name}(`);if(start<0)throw Error(name);return source.slice(start,source.indexOf(end,start));}
export function fixture(source,{size=40000,gap='',reply,limit=18000,maxSummary=10000,tokenScale=4,aborted=false,refuse=false,noShrink=false,wireOverhead=0,maxCalls=16}={}){
 const calls=[],logs=[],applies=[];
 const messages=[{id:'m1',role:'assistant',text:'original1'},...(gap?[{id:'gap',role:'assistant',text:gap}]:[]),{id:'m2',role:'assistant',text:'original2'}];
 const blocks=[1,2].map(i=>({blockId:`b${i}`,tier:1,active:true,summary:String(i).repeat(size),effectiveMessageIds:[`m${i}`]}));
 const session={id:'offline',state:{blocks},stats:{lastInputTokens:30000},metadata:{}};
 const count=s=>Math.ceil(s.length/tokenScale);
 const view=()=>session.state.blocks.filter(b=>b.active).map(b=>({id:b.blockId,text:b.summary,role:'assistant'}));
 const core={processTurn:({state})=>({state,messages:noShrink?blocks.map(b=>({id:b.blockId,text:String(1).repeat(size),role:'assistant'})):view(),nudge:{compressibleRanges:[]}})};
 const identity=x=>x;
 const context={Math,Map,Set,Number,Error,console,ABORTED_FAILURE:{kind:'aborted',detail:'client disconnected'},MAX_TIER_DISTILL_CALLS:6,TIER_DISTILL_SOURCE_CHAR_BUDGET:60000,MIN_CHUNK_TOKENS:2000,CHUNK_FRACTION:.6,MIN_SUMMARY_CHARS:100,SUMMARY_SCRAFFOLDING_TOKENS:256,SUMMARY_JOIN_GAP:2,MAX_SUMMARY_CALLS_PER_PREFLIGHT:maxCalls,MAX_PREFLIGHT_ROUNDS:8,EMERGENCY_FOLD_COVERAGE:100,EMERGENCY_ROUND_CAP:16,TRANSIENT_EMPTY_RETRY_BUDGET:2,DETERMINISTIC_EMPTY_STICKY_LIMIT:3,
 epochConfirmPending:()=>false,estimateCoreMessages:ms=>ms.reduce((n,m)=>n+count(m.text??''),0),estimateCoreMessagesUpper:ms=>ms.reduce((n,m)=>n+(m.text??'').length,0),defaultCountTokens:count,currentCalibrationFactor:()=>1,applyEstimateCalibration:identity,deadSkipKeys:()=>[],safeHost:()=> 'offline',readDeterministicProbeState:()=>undefined,ccrLoopConfig:(_s,c)=>c,noEmergencyTruncate:identity,contentStoreOf:()=>undefined,adoptContentStore:()=>{},applyAbsorbView:identity,viableRanges:identity,filterDeadRanges:(_s,r)=>r,relaxedConfig:c=>({...c,preserveRecentMessages:0}),buildCompressSystemPrompt:()=> 'OFFLINE RULES',safePrefix:(s,n)=>s.slice(0,n),UpstreamHttpError:class extends Error{},parseCompressInput:x=>x,
 applyRanges:(fold)=>{applies.push(fold);if(refuse)return{outcome:'refused',text:'hard-protected range'};for(const b of session.state.blocks)b.active=false;session.state.blocks.push({blockId:'b3',tier:2,active:true,summary:fold.content[0].summary,effectiveMessageIds:messages.map(m=>m.id)});return{outcome:'applied'}},
 summarizeRange:async(_deps,content,start,end,lengthBudget,system)=>{calls.push({content,start,end,lengthBudget,system});return reply?reply(calls.length,calls.at(-1)):{summary:'offline summary '.repeat(20)}}};
 vm.createContext(context);
 vm.runInContext(extract(source,'splitSummaryContent','function truncateSummaryToLimit'),context);
 vm.runInContext('async '+extract(source,'preflightCompress','var SELF_HEAL_WINDOW'),context);
 const deps={session,core,wireOverhead,config:{modelContextLimit:limit,compress:{minCompressRange:0,maxSummaryLength:maxSummary,minSummaryLength:100},preserveRecentMessages:2,tiers:{enabled:true}},externalSummary:{stats:{calls:0,attempts:0}},prompts:{tier2DistillRules:'TIER2',tier3CondenseRules:'TIER3'},url:'offline',model:'fake',log:(level,text)=>logs.push({level,text}),signal:{aborted}};
 return {calls,logs,applies,session,signal:deps.signal,run:()=>context.preflightCompress(deps,messages)};
}
export const original=loadOriginal();
