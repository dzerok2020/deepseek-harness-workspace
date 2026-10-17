import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const name of ['vibe-native.yml', 'vibe-cgw.yml']) {
  test(`${name} uses explicit conservative budgets for every model`, () => {
    const text = readFileSync(new URL(`../tools/${name}`, import.meta.url), 'utf8');
    assert.match(text, /defaultContextWindow: 128000/);
    assert.match(text, /defaultMaxTokens: 16384/);
    const models = text.split(/\n\s+- id: /).slice(1);
    assert.ok(models.length > 0);
    for (const model of models) {
      assert.match(model, /contextWindow: 128000/);
      assert.match(model, /maxTokens: 16384/);
    }
  });
}
