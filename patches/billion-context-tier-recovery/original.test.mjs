import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const digest=source=>crypto.createHash('sha256').update(source).digest('hex');
const expectedHash='104502cb11fa98e205f61ba9cc0dde8d3d03b57d8330bfcbafe84f8d130ed2d9';

test('vendored original is the exact pinned 0.1.204 bundle in deterministic gzip',async()=>{
 const {HASH,loadOriginal}=await import('./original.mjs');
 const compressed=fs.readFileSync(new URL('original-index.js.gz',root));
 const source=loadOriginal();
 assert.equal(HASH,expectedHash);
 assert.equal(Buffer.byteLength(source),5248857);
 assert.equal(digest(source),HASH);
 assert.equal(compressed.length,1227183);
 assert.equal(digest(compressed),'1b2adf72b07894b03ae1ddd5cf2de749c4ce20ae02828f4e802ed5dfcc5f2dd0');
 assert.deepEqual(compressed.subarray(0,10),Buffer.from([31,139,8,0,0,0,0,0,2,3]));
 assert.deepEqual(gunzipSync(compressed),Buffer.from(source));
});

test('shared loader rejects corrupt gzip and recompressed source drift',async()=>{
 const {loadOriginal}=await import('./original.mjs');
 assert.throws(()=>loadOriginal(Buffer.from('not gzip')));
 assert.throws(()=>loadOriginal(gzipSync(Buffer.from('changed original'))),/SHA256 mismatch/);
});

test('fixture provenance preserves the full original license and Product Surfaces term',()=>{
 const provenance=JSON.parse(fs.readFileSync(new URL('original.provenance.json',root),'utf8'));
 const license=fs.readFileSync(new URL('LICENSE.original.txt',root));
 assert.equal(provenance.package,'billion-context');
 assert.equal(provenance.version,'0.1.204');
 assert.equal(provenance.source.sha256,expectedHash);
 assert.equal(provenance.source.bytes,5248857);
 assert.equal(provenance.gzip.sha256,'1b2adf72b07894b03ae1ddd5cf2de749c4ce20ae02828f4e802ed5dfcc5f2dd0');
 assert.equal(provenance.gzip.bytes,1227183);
 assert.equal(license.length,2652);
 assert.equal(digest(license),'f27574cd3f4b0b4877da2869953945d66d76a665e7ebb9320a5e87aa76f7ab58');
 assert.equal(provenance.license.sha256,digest(license));
 assert.match(license.toString(),/Additional Term — Attribution on Product Surfaces/);
 assert.match(license.toString(),/附加条款（中文）/);
});

test('generator CLI uses the pinned fixture without installed source/version reads from any cwd',async()=>{
 const {patch,OWNER}=await import('./generate.mjs');
 const {loadOriginal}=await import('./original.mjs');
 const generator=fileURLToPath(new URL('generate.mjs',root));
 const output=fileURLToPath(new URL('fixture-cli-check.js',root));
 const installed=fileURLToPath(new URL('./',new URL('file://'+OWNER)));
 const code=`import fs from 'node:fs';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
 const read=fs.readFileSync;fs.readFileSync=function(file,...args){const name=file instanceof URL?fileURLToPath(file):String(file);if(name.startsWith(${JSON.stringify(installed)})||name===${JSON.stringify(OWNER.replace(/dist\/index\.js$/,'package.json'))})throw Error('Forbidden installed owner read: '+name);return read.call(this,file,...args)};
 fs.writeFileSync=(file,source,options)=>{if(file!==${JSON.stringify(output)}||options.flag!=='wx')throw Error('Unsafe candidate write');console.log('Candidate SHA256: '+crypto.createHash('sha256').update(source).digest('hex'))};
 process.argv=[process.execPath,${JSON.stringify(generator)},${JSON.stringify(output)}];await import(${JSON.stringify(new URL('generate.mjs',root).href)});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:'/',encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,new RegExp('Candidate SHA256: '+digest(patch(loadOriginal()))));
});
