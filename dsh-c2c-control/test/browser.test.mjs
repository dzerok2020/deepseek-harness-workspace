import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { allowedUrl, OwnedBrowser } from '../src/browser.mjs';
import puppeteer from 'puppeteer-core';

test('recognizes current homepage composer without sending or exposing its draft', async () => {
 const chromium = await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true});
 try {
  const page = await chromium.newPage();
  await page.setContent('<textarea id="pending-home-input" placeholder="Ask ChatGPT">private draft</textarea>');
  const browser = new OwnedBrowser({profileDir:'/tmp/example-dsh-profile',executablePath:'/usr/bin/chromium'});
  browser.browser = chromium;
  browser.page = page;
  browser.assertPage = () => {}; // Offline DOM fixture; production origin check remains unchanged.
  const result = await browser.inspect();
  assert.equal(result.editorReady, true);
  assert.deepEqual(result.composerDiagnostics, {revision:1, readyState:'complete', matched:1, visible:1, homepage:1, legacy:0});
  assert.equal(JSON.stringify(result).includes('private draft'), false);
  await page.setContent('<textarea id="pending-home-input" hidden></textarea>');
  assert.equal((await browser.inspect()).editorReady, false);
  await page.setContent('<textarea id="prompt-textarea"></textarea>');
  assert.equal((await browser.inspect()).editorReady, true);
 } finally { await chromium.close(); }
});

test('only explicit ChatGPT and OpenAI login origins are allowed', () => {
 for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/c/demo', 'https://auth.openai.com/log-in']) assert.equal(allowedUrl(url), true);
 for (const url of ['http://chatgpt.com/', 'https://chatgpt.com.evil.test', 'https://chatgpt.com@evil.test/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://evil.test/']) assert.equal(allowedUrl(url), false);
});

test('browser requires owned dedicated profile and rejects arbitrary navigation before launch', async () => {
 const browser = new OwnedBrowser({profileDir:'/tmp/example-dsh-profile', executablePath:'/usr/bin/chromium'});
 await assert.rejects(browser.open('https://example.com/'), /allowlist/);
 assert.equal(browser.status().running, false);
 await browser.close();
});

test('cancellation during send-button lookup prevents submission', async () => {
 const abort = new AbortController(); let clicks=0;
 const browser = new OwnedBrowser({profileDir:'/tmp/example-dsh-profile',executablePath:'/usr/bin/chromium'});
 browser.browser={connected:true};
 browser.inspect=async()=>({editorReady:true,generating:false,url:'https://chatgpt.com/c/toy'});
 const text='[C2C]'; let draft='';
 const editor={evaluate:async(_fn,expected)=>{ if(expected !== undefined && draft === expected) draft=''; return draft; },focus:async()=>{}};
 browser.page={url:()=> 'https://chatgpt.com/c/toy',isClosed:()=>false,keyboard:{insertText:async value=>{draft=value;}},$:async selector=>{
  if(selector.startsWith('button')) {abort.abort();return {evaluate:async()=>false,click:async()=>{clicks++;}};}
  return editor;
 }};
 await assert.rejects(browser.send(text,abort.signal));
 assert.equal(clicks,0);
 assert.equal(draft,'');
});

test('close during deferred launch closes late browser and never opens page', async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), 'c2c-launch-'));
 const browser = new OwnedBrowser({profileDir:dir, executablePath:'/usr/bin/chromium'});
 let resolveLaunch, started;
 const launching = new Promise(resolve => { started = resolve; });
 let closes = 0;
 browser.launch = () => { started(); return new Promise(resolve => { resolveLaunch = resolve; }); };
 try {
  const opening = browser.open();
  await launching;
  await browser.close();
  resolveLaunch({connected:true, close:async()=>{closes++;}, newPage:async()=>{throw new Error('must not open page');}});
  await assert.rejects(opening, /closed during launch/);
  assert.equal(closes,1);
  assert.equal(browser.status().running,false);
 } finally { await browser.close(); await rm(dir,{recursive:true,force:true}); }
});
