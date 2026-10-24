import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

test('host assembly agent identity isolates parent/child memory and turn refresh', async () => {
  const home = mkdtempSync(join(tmpdir(), 'loop-guard-test-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const handlers = new Map();
    apply({ on(name, fn) { handlers.set(name, fn); }, logger: {} }, {});
    const parent = { id: 'parent' }, child = { id: 'child' };
    const assemble = async (agent, text) => {
      const assembly = { contexts: [{ name: 'lingshu:auto-recall', text }] };
      return handlers.get('system-prompt/assemble')(assembly, { agent, scope: agent }, async () => assembly);
    };
    assert.equal((await assemble(parent, 'parent-1')).contexts[0].text, 'parent-1');
    assert.equal((await assemble(child, 'child-1')).contexts[0].text, 'child-1');
    assert.equal((await assemble(parent, 'parent-2')).contexts[0].text, 'parent-1');
    handlers.get('session/event')({ id: 'parent' }, { type: 'turn/start', data: {} });
    assert.equal((await assemble(parent, 'parent-3')).contexts[0].text, 'parent-3');
    assert.equal((await assemble(child, 'child-2')).contexts[0].text, 'child-1');
    handlers.get('session/event')({ id: 'child' }, { type: 'user/message', data: { message: { source: { kind: 'runtime-context' } } } });
    assert.equal((await assemble(child, 'child-3')).contexts[0].text, 'child-1');
    handlers.get('session/event')({ id: 'child' }, { type: 'user/message', data: { message: { source: { kind: 'user' } } } });
    assert.equal((await assemble(child, 'child-4')).contexts[0].text, 'child-4');
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    // home is the exact directory returned by mkdtempSync above.
    rmSync(home, { recursive: true, force: true });
  }
});
