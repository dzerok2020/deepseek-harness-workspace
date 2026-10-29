import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Independent, model-keyed expectations: swapping valid numbers must not pass.
const expected = {
  or: {
    'cx/gpt-6-astra': 872000, 'cx/gpt-6-sol': 872000, 'cx/gpt-6-luna': 872000,
    'b-ai/deepseek-v4.1-flash': 128000, 'b-ai/qwen3.8-flash': 128000,
    'b-ai/glm-5.3-flash': 1000000, 'b-ai/gemini-4-argon': 1000000,
    'antigravity/gemini-3.8-flash-tiered': 1048576, 'gpt-free': 104000,
    'b-ai/gpt-6.1-sol': 400000, 'cx/gpt-6.1-sol': 872000, 'cx/gpt-6.1-sol-fast': 400000,
  },
  cgw: Object.fromEntries([
    'chatgpt-web/gpt-6-sol-instant', 'chatgpt-web/gpt-6-sol', 'chatgpt-web/gpt-6-pro',
    'chatgpt-web/gpt-5.6-sol-instant', 'chatgpt-web/gpt-5.6-sol', 'chatgpt-web/gpt-5.6-pro',
  ].map(id => [id, 128000])),
};

for (const name of ['vibe-native.yml', 'vibe-cgw.yml', 'web-model-budgets.yml']) {
  test(`${name} uses exact provider/model budgets, not a numeric allowlist`, () => {
    const path = new URL(`../tools/${name}`, import.meta.url).pathname;
    const result = spawnSync('python3', ['-c',
      'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', path],
    { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const providers = JSON.parse(result.stdout).find(row => row.id === 'llm-pi-ai').config.providers;
    for (const [provider, config] of Object.entries(providers)) {
      assert.ok(expected[provider], `unknown provider ${provider}`);
      assert.equal(config.defaultContextWindow, 128000);
      assert.equal(config.defaultMaxTokens, 16384);
      assert.ok(config.models.length > 0);
      assert.equal(new Set(config.models.map(model => model.id)).size, config.models.length);
      for (const model of config.models) {
        assert.ok(Object.hasOwn(expected[provider], model.id), `unknown model ${model.id}`);
        assert.equal(model.contextWindow, expected[provider][model.id], model.id);
        assert.equal(model.maxTokens, 16384, model.id);
      }
      if (name === 'web-model-budgets.yml') {
        assert.deepEqual(config.models.map(model => model.id).sort(), Object.keys(expected[provider]).sort());
      }
    }
  });
}
