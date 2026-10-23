import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export const OWNER='/home/dzerok/.dsh/profiles/web/node_modules/billion-context/dist/index.js';
export const HASH='104502cb11fa98e205f61ba9cc0dde8d3d03b57d8330bfcbafe84f8d130ed2d9';
export function patch(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==HASH)throw Error('Owner SHA256 mismatch; refusing candidate generation');
 const replace=(oldText,newText)=>{if(source.split(oldText).length!==2)throw Error('Exact anchor missing or non-unique: '+oldText.slice(0,100));source=source.replace(oldText,newText)};
 // Retain the original fitting-span preference. Only the rejected oversized pair gets a fallback.
 replace('if(cLast<0){poolProblems.push(`tier-${pool.tier}: no two-block span stayed under the ${TIER_DISTILL_SOURCE_CHAR_BUDGET.toLocaleString("en-US")}-character source budget`);continue}',
 'if(cLast<0){cFirst=0;cLast=1;cLo=Math.min(positioned[0].ext[0],positioned[1].ext[0]);cHi=Math.max(positioned[0].ext[1],positioned[1].ext[1])}');
 replace('const content=spanContent(lo2,hi2);let outcome;try{outcome=await summarizeRange(deps,content,first.blockId,last.blockId,void 0,system)}',
 `const content=spanContent(lo2,hi2);const sourceBudget=Math.min(budget,limit-defaultCountTokens(system)-SUMMARY_SCRAFFOLDING_TOKENS-MIN_CHUNK_TOKENS);if(sourceBudget<=0){stopReason="unavailable";break}const chunks=splitSummaryContent(content,1,text2=>Math.max(countText(text2)/sourceBudget,text2.length/TIER_DISTILL_SOURCE_CHAR_BUDGET));if(chunks.some(chunk=>countText(chunk)>sourceBudget||chunk.length>TIER_DISTILL_SOURCE_CHAR_BUDGET)){stopReason="unavailable";break}if(callsUsed+chunks.length>MAX_TIER_DISTILL_CALLS||summaryCalls+chunks.length>summaryBudget){stopReason="cap";break}const maxSummary=activeConfig.compress.maxSummaryLength;const perChunkBudget=maxSummary>0?Math.floor((maxSummary-(chunks.length-1)*SUMMARY_JOIN_GAP)/chunks.length):void 0;if(perChunkBudget!==void 0&&perChunkBudget<MIN_SUMMARY_CHARS){stopReason="unavailable";break}let outcome;try{const parts=[];for(const chunk of chunks){if(deps.signal?.aborted){outcome={unusable:"client disconnected during tier distillation"};break}callsUsed+=1;summaryCalls+=1;const part=await summarizeRange(deps,chunk,first.blockId,last.blockId,perChunkBudget,system);if("unusable"in part){outcome=part;break}parts.push(part.summary)}if(!outcome&&deps.signal?.aborted)outcome={unusable:"client disconnected during tier distillation"};if(!outcome){const summary=parts.join("\\n\\n");outcome=maxSummary>0&&summary.length>maxSummary?{unusable:\`joined tier summary (\${summary.length} chars) exceeds maxSummaryLength (\${maxSummary})\`}:summary.length<activeConfig.compress.minSummaryLength?{unusable:"joined tier summary below minSummaryLength"}:{summary}}}`);
 replace('const gained=est-after;callsUsed+=1;summaryCalls+=1;result.compressedRanges+=1;','const gained=est-after;result.compressedRanges+=1;');
 return source;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const pkg=JSON.parse(fs.readFileSync(path.join(path.dirname(OWNER),'../package.json'),'utf8'));
 if(pkg.name!=='billion-context'||pkg.version!=='0.1.204')throw Error('Expected billion-context 0.1.204');
 const output=path.resolve(process.argv[2]??path.join(root,'candidate-index.js'));
 if(path.dirname(output)!==root||output===OWNER)throw Error('Output must be directly inside candidate directory');
 fs.writeFileSync(output,patch(fs.readFileSync(OWNER,'utf8')),{flag:'wx'});
 console.log('Workspace candidate generated: '+output);
}
