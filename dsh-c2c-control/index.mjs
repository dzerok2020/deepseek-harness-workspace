import path from 'node:path';
import os from 'node:os';
import { OwnedBrowser } from './src/browser.mjs';
import { Controller } from './src/controller.mjs';
export const name = 'dsh-c2c-control';
export const inject = ['tools'];

export function apply(ctx) {
 const base = path.join(os.homedir(), '.local/share/dsh-c2c-control');
 const browser = new OwnedBrowser({ profileDir: path.join(base, 'chromium'), executablePath: '/usr/bin/chromium' });
 const controller = new Controller({stateDir:path.join(base, 'checkpoints'), browser});
 let owner = null;
 let busy = false;
 let disposed = false;
 const lifetime = new AbortController();
 let drained = Promise.resolve();
 ctx.on('dispose', async () => {
  disposed = true;
  lifetime.abort(new Error('C2C plugin disposed'));
  await drained;
  await controller.close();
 });
 ctx.tools.register({
  name: 'c2c_control',
  description: 'DSH-owned ChatGPT control adapter; no BrowserSkill. Requires explicit user consent for dedicated Chromium. begin binds a task/workspace; open shows login/chat; send accepts only short C2C state messages; read reconciles UI history without resubmission; status reports state; stop closes owned browser. No code/diffs/log bodies, arbitrary browser JS, cookie access or remote command execution. Login/CAPTCHA/2FA/connector approval are human-owned. Use only consented workspace; read-only MCP pairing is separate.',
  parameters: {
   action: {type:'string',required:true,enum:['begin','open','send','read','status','stop']},
   workspace: {type:'string',description:'Absolute consented workspace, begin only.'},
   taskId: {type:'string',description:'Stable task identifier, begin only.'},
   url: {type:'string',description:'ChatGPT chat URL or allowlisted OpenAI login URL, open only.'},
   message: {type:'string',description:'C2C state wire message below 1024 UTF-8 bytes; send only.'},
  },
  output: {
   schema: {type:'object',additionalProperties:false,required:['result'],properties:{result:{type:'string'}}},
   render: (_args, value) => [{type:'text',text:value.result}],
  },
  async execute(args, exec) {
   if (!exec.agent) throw new Error('c2c_control requires owning agent');
   if (disposed) throw new Error('C2C plugin disposed');
   exec = { ...exec, signal: AbortSignal.any([exec.signal, lifetime.signal]) };
   exec.signal.throwIfAborted();
   if (owner && owner !== exec.agent.session) throw new Error('Browser belongs to another DSH session');
   if (busy) throw new Error('c2c_control operation already in progress');
   busy = true;
   let release;
   drained = new Promise(resolve => { release = resolve; });
   try {
    let result;
    switch (args.action) {
     case 'begin':
      result = await controller.begin({workspace:args.workspace,taskId:args.taskId},exec.signal);
      owner = exec.agent.session;
      break;
     case 'open':
      if (!owner) throw new Error('begin required before browser open');
      result = await browser.open(args.url ?? (await controller.status(exec.signal)).checkpoint?.chatUrl,exec.signal);
      break;
     case 'send':
      result = await controller.send(args.message,exec.signal);
      break;
     case 'read': result = await controller.readReply(exec.signal); break;
     case 'status':
      result = await controller.status(exec.signal);
      if (browser.status().running) {
       const view = await browser.inspect(exec.signal);
       result.readiness = {editorReady:view.editorReady,generating:view.generating,composerDiagnostics:view.composerDiagnostics};
      }
      break;
     case 'stop': await controller.close(); controller.checkpoint = null; owner = null; result = {status:'stopped'}; break;
     default: throw new Error('Unsupported c2c_control action');
    }
    exec.signal.throwIfAborted();
    return {result:JSON.stringify(result)};
   } finally { busy = false; release(); }
  },
 });
}
