import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Independent, model-keyed expectations: swapping valid numbers must not pass.
const legacyExpected = {
  or: {
    'cx/gpt-6-astra': [872000, 128000], 'cx/gpt-6-sol': [872000, 128000],
    'cx/gpt-6-luna': [872000, 128000], 'cx/gpt-6.1-sol': [872000, 128000],
    'cx/gpt-5.6-terra': [872000, 128000], 'cx/gpt-6.1-sol-fast': [400000, 16384],
    'b-ai/deepseek-v4.1-flash': [128000, 16384], 'b-ai/qwen3.8-flash': [128000, 16384],
    'b-ai/glm-5.3-flash': [1000000, 131072], 'b-ai/gemini-4-argon': [1048576, 65536],
    'antigravity/gemini-3.8-flash-tiered': [1048576, 65536], 'gpt-free': [104000, 16384],
    'b-ai/gpt-6.1-sol': [1050000, 128000],
    'nr-ai/deepseek-v4-flash': [1000000, 384000],
    'nr-ai/deepseek-v4.1-flash': [128000, 16384],
    'nr-ai/deepseek-v4-flash-0731': [1000000, 384000],
    'nr-ai/glm-5.1': [200000, 128000], 'nr-ai/glm-5.3-flash': [1000000, 131072],
    'nr-ai/qwen3.8-flash': [128000, 16384], 'nr-ai/grok-4.7': [128000, 16384],
  },
  cgw: Object.fromEntries([
    'chatgpt-web/gpt-6-sol-instant', 'chatgpt-web/gpt-6-sol', 'chatgpt-web/gpt-6-pro',
    'chatgpt-web/gpt-5.6-sol-instant', 'chatgpt-web/gpt-5.6-sol', 'chatgpt-web/gpt-5.6-pro',
  ].map(id => [id, [128000, 16384]])),
};

// Saved Settings is newer than the opt-in legacy overlays. Keep both exact
// expectations independent of the YAML under test; never flatten them together.
const referenceExpected = {
  ...legacyExpected,
  or: {
    ...legacyExpected.or,
    'cx/gpt-6-astra': [128000, 16384], 'cx/gpt-6-sol': [128000, 16384],
    'cx/gpt-6-luna': [128000, 16384], 'cx/gpt-6.1-sol': [1000000, 128000],
    'cx/gpt-5.6-terra': [872000, 128000],
    'nr-ai/glm-5.1': [200000, 65000],
    'b-ai/glm-5.3-flash': [128000, 16384], 'b-ai/gemini-4-argon': [128000, 16384],
    'antigravity/gemini-3.8-flash-tiered': [128000, 16384], 'b-ai/gpt-6.1-sol': [128000, 16384],
    'nr-ai/deepseek-v4.1-flash': [1048576, 384000],
    'nr-ai/deepseek-v4-pro-0813': [1000000, 384000],
    // Routes added in Settings and synced on 2026-11-01.
    'anapinex/free/deepseek-v4-flash-0731': [1048576, 384000],
    'anapinex/free/glm-5.3-flashx': [1048576, 128000],
    'anapinex/free/minimax-m3.1-flash': [1000000, 128000],
    'antigravity/claude-opus-5-5-medium': [1048576, 128000],
    'cx/gpt-5.6-sol': [872000, 128000],
    'gh/gpt-4.1': [1047576, 32768],
    // Routes added in Settings and synced on 2026-11-04.
    'gpt-5.6-terra': [872000, 128000],
    'antigravity/gemini-3.8-flash-high': [1048576, 65536],
  },
};

for (const name of ['vibe-native.yml', 'vibe-cgw.yml', 'web-model-budgets.yml']) {
  test(`${name} uses exact provider/model budgets, not a numeric allowlist`, () => {
    const expected = name === 'web-model-budgets.yml' ? referenceExpected : legacyExpected;
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
        assert.deepEqual([model.contextWindow, model.maxTokens], expected[provider][model.id], model.id);
      }
      if (name === 'web-model-budgets.yml') {
        assert.deepEqual(config.models.map(model => model.id).sort(), Object.keys(expected[provider]).sort());
      }
    }
  });
}
