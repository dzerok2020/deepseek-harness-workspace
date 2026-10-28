import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
function build(args,file){
 const r=spawnSync('npm',['exec','--','vite','build',...args],{encoding:'utf8'});
 const log=r.stdout+r.stderr;writeFileSync(`evidence/${file}`,log);assert.equal(r.status,0,log);return log;
}
const baseline=build(['--config','vite.baseline.config.js'],'baseline-build.txt');
assert.match(baseline,/IMPORT_IS_UNDEFINED/,'upstream baseline must reproduce warning');
assert.match(baseline,/LinearEncoding|sRGBEncoding/);
const fixed=build([],'fixed-build.txt');
assert.doesNotMatch(fixed,/IMPORT_IS_UNDEFINED|outputEncoding|sRGBEncoding|LinearEncoding/);
const renderer=readFileSync('src/vendor/templeNightRenderer.js','utf8');
assert.match(renderer,/outputColorSpace = le \? o.LinearSRGBColorSpace : o.SRGBColorSpace/);
assert.match(renderer,/t.colorSpace = o.SRGBColorSpace/);
assert.doesNotMatch(readFileSync('package-lock.json','utf8'),/\/tmp\/|"link": true|"file:/);
console.log('PASS build/provenance compatibility assertions; upstream warning reproduced, fixed build has no undefined-import warning. Bundle-size warning remains visible.');
