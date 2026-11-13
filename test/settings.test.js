import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as llm from '../src/llm.js';

test('API key alone enables DeepSeek Flash with the default endpoint', () => {
  const client = llm.llmFromSettings({ key: ' sk-test ' });
  assert.equal(client.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(client.model, 'deepseek-flash');
});

test('prefilled settings without a key keep conversion offline', () => {
  assert.equal(llm.llmFromSettings({ key: ' ', url: 'https://api.deepseek.com', model: 'deepseek-flash' }), null);
});

test('blank advanced settings fall back to DeepSeek defaults', () => {
  const client = llm.llmFromSettings({ key: 'sk-test', url: ' ', model: ' ' });
  assert.equal(client.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(client.model, 'deepseek-flash');
});

test('custom OpenAI-compatible endpoint and model override the defaults', () => {
  const client = llm.llmFromSettings({ key: 'sk-test', url: ' https://example.invalid/v1/ ', model: ' custom-model ' });
  assert.equal(client.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(client.model, 'custom-model');
});

test('AI settings reject non-HTTPS and malformed endpoints before sending the key', () => {
  for (const url of ['http://example.invalid', 'https://', 'https://user:password@example.invalid', 'https://example.invalid/?key=secret']) {
    assert.throws(() => llm.llmFromSettings({ key: 'sk-test', url }), /HTTPS base URL/);
  }
});
