import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolCallName } from '../lib/index.js';

const resolveFrom = (names) => (name) => (names.includes(name) ? { name } : undefined);

test('leaves an already-resolvable name untouched', () => {
  const resolve = resolveFrom(['bash', 'read']);
  assert.equal(normalizeToolCallName('bash', resolve), 'bash');
  assert.equal(normalizeToolCallName('read', resolve), 'read');
});

test('maps a Claude-cased name to its registered lowercase tool', () => {
  const resolve = resolveFrom(['bash', 'read', 'skill', 'edit', 'glob', 'grep', 'write']);
  assert.equal(normalizeToolCallName('Bash', resolve), 'bash');
  assert.equal(normalizeToolCallName('Read', resolve), 'read');
  assert.equal(normalizeToolCallName('Skill', resolve), 'skill');
  assert.equal(normalizeToolCallName('Edit', resolve), 'edit');
  assert.equal(normalizeToolCallName('Glob', resolve), 'glob');
  assert.equal(normalizeToolCallName('Grep', resolve), 'grep');
  assert.equal(normalizeToolCallName('Write', resolve), 'write');
});

test('does not invent a name when the lowercase form is not registered', () => {
  const resolve = resolveFrom(['todo_write']);
  assert.equal(normalizeToolCallName('TodoWrite', resolve), 'TodoWrite');
});

test('returns unknown names unchanged so the registry still reports them', () => {
  const resolve = resolveFrom(['bash']);
  assert.equal(normalizeToolCallName('Nope', resolve), 'Nope');
  assert.equal(normalizeToolCallName('Nope', resolve), 'Nope');
});

test('exact match wins over a lowercase fallback', () => {
  const resolve = resolveFrom(['Bash', 'bash']);
  assert.equal(normalizeToolCallName('Bash', resolve), 'Bash');
});

test('passes through non-string and empty names untouched', () => {
  const resolve = resolveFrom(['bash']);
  assert.equal(normalizeToolCallName(undefined, resolve), undefined);
  assert.equal(normalizeToolCallName('', resolve), '');
  assert.equal(normalizeToolCallName(42, resolve), 42);
});
