import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.mjs';
import { makeMessage } from '../src/protocol.mjs';
const init = makeMessage({state:'INIT', taskId:'toy', iteration:0, body:'GOAL:\nInspect via MCP.'});
const plan = makeMessage({state:'PLAN', taskId:'toy', iteration:1, body:'ACTIONS:\nRun tests.'});
class Transport {
 messages=[]; sends=0; generating=false;
 status() { return {running:true,url:'https://chatgpt.com/c/toy'}; }
 async open() { return {running:true}; }
 async inspect() { return {running:true, url:'https://chatgpt.com/c/toy', editorReady:true, generating:this.generating, messages:this.messages}; }
 async send(text) { this.sends++; this.messages.push({role:'user', text}); }
 async close() {}
}
async function fixture(run) {
 const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-controller-'));
 try { await run(dir); } finally { await rm(dir,{recursive:true,force:true}); }
}
test('controller sends once, verifies UI receipt and accepts only later matching assistant reply', () => fixture(async dir => {
 const browser = new Transport();
 browser.messages.push({role:'assistant',text:plan});
 const controller = new Controller({stateDir:dir, browser});
 await controller.begin({workspace:dir, taskId:'toy'});
 assert.equal((await controller.send(init)).delivery, 'sent');
 assert.equal(browser.sends,1);
 assert.equal((await controller.readReply()).status,'waiting');
 browser.messages.push({role:'assistant',text:plan});
 browser.generating=true;
 assert.equal((await controller.readReply()).status,'waiting');
 browser.generating=false;
 assert.equal((await controller.readReply()).reply.state,'PLAN');
 assert.equal((await controller.readReply()).reply.state,'PLAN');
 await assert.rejects(controller.send(init));
 assert.equal(browser.sends,1);
}));
test('ambiguous send is reconciled from visible history without resubmission', () => fixture(async dir => {
 const browser = new Transport();
 browser.send = async text => { browser.sends++; browser.messages.push({role:'user',text}); throw new Error('transport disconnected after click'); };
 const controller = new Controller({stateDir:dir, browser});
 await controller.begin({workspace:dir, taskId:'toy'});
 await assert.rejects(controller.send(init), /disconnected/);
 const resumed = new Controller({stateDir:dir,browser});
 await resumed.begin({workspace:dir, taskId:'toy'});
 assert.equal((await resumed.readReply()).status,'waiting');
 await assert.rejects(resumed.send(init));
 assert.equal(browser.sends,1);
}));
test('unseen pending send pauses instead of retry; concurrent submissions cannot both reach browser', () => fixture(async dir => {
 const browser = new Transport();
 const controller = new Controller({stateDir:dir,browser});
 await controller.begin({workspace:dir, taskId:'toy'});
 browser.send = async () => {browser.sends++; throw new Error('no receipt');};
 await assert.rejects(controller.send(init));
 assert.equal((await controller.readReply()).status,'paused');
 await assert.rejects(controller.send(init));
 assert.equal(browser.sends,1);
}));

test('resume refuses a different conversation and restores original URL', () => fixture(async dir => {
 const browser = new Transport();
 const controller = new Controller({stateDir:dir,browser});
 await controller.begin({workspace:dir,taskId:'toy'});
 await controller.send(init);
 browser.inspect = async () => ({running:true,url:'https://chatgpt.com/c/wrong',generating:false,messages:[{role:'user',text:init},{role:'assistant',text:plan}]});
 assert.equal((await controller.readReply()).status,'paused');
 assert.equal((await controller.status()).checkpoint.chatUrl,'https://chatgpt.com/c/toy');
}));

test('first INIT creates a chat and binds returned conversation URL', () => fixture(async dir => {
 const browser=new Transport(); let url='https://chatgpt.com/';
 browser.inspect=async()=>({running:true,url,editorReady:true,generating:false,messages:browser.messages});
 browser.send=async text=>{browser.sends++;browser.messages.push({role:'user',text});url='https://chatgpt.com/c/new';};
 const controller=new Controller({stateDir:dir,browser});
 await controller.begin({workspace:dir,taskId:'toy'});
 assert.equal((await controller.send(init)).delivery,'sent');
 assert.equal((await controller.status()).checkpoint.chatUrl,'https://chatgpt.com/c/new');
}));
test('definitely-not-submitted transport failure can retry after human fixes readiness', () => fixture(async dir => {
 const browser=new Transport();
 const controller=new Controller({stateDir:dir,browser});
 await controller.begin({workspace:dir,taskId:'toy'});
 browser.send=async()=>{throw Object.assign(new Error('composer draft'),{submission:'not-submitted'});};
 await assert.rejects(controller.send(init), /draft/);
 browser.send=async text=>{browser.sends++;browser.messages.push({role:'user',text});};
 assert.equal((await controller.send(init)).delivery,'sent');
 assert.equal(browser.sends,1);
}));
