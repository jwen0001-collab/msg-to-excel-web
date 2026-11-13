import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeMail, localRow } from '../src/core.js';
import { LLMClient } from '../src/llm.js';

const response = data => ({ choices: [{ message: { content: JSON.stringify(data) } }] });

test('model selects an original sentence by number without copying or rephrasing it', async () => {
  const mail = makeMail({ subject: 'NAV', text: 'Bonjour,\nMerci de transmettre le fichier NAV.\nCordialement,\nAlice' });
  let prompts = 0;
  const client = new LLMClient('sk-test', 'https://example.invalid', 'test', { sleep: async () => {}, transport: async payload => {
    prompts++;
    const list = JSON.parse(payload.messages[1].content.match(/<issue-excerpts>\n([\s\S]*?)\n<\/issue-excerpts>/)[1]);
    const chosen = list.find(item => item.text === 'Merci de transmettre le fichier NAV.');
    assert.ok(chosen);
    assert.ok(list.every(item => !['Bonjour,', 'Cordialement,', 'Alice'].includes(item.text)));
    return response({ summary: 'The NAV file is needed.', issue_excerpt_id: chosen.id });
  } });
  const row = await client.enrich(mail, localRow(mail, { coreOnly: true }), '2026-11-13');
  assert.equal(row.issues, 'Merci de transmettre le fichier NAV.');
  assert.equal(row.summary, 'The NAV file is needed.');
  assert.equal(client.failureCount, 0);
  assert.equal(prompts, 1);
});

test('line wrapping in a legacy copied excerpt does not trigger fallback', async () => {
  const mail = makeMail({ subject: 'NAV', text: 'Please send the\nNAV file.' });
  const client = new LLMClient('sk-test', 'https://example.invalid', 'test', {
    sleep: async () => {}, transport: async () => response({ summary: 'The NAV file is needed.', issues_description: 'Please send the NAV file.' }),
  });
  const row = await client.enrich(mail, localRow(mail, { coreOnly: true }), '2026-11-13');
  assert.equal(row.issues, 'Please send the NAV file.');
  assert.equal(client.failureCount, 0);
});

test('invalid excerpt numbers are retried and still require permission before fallback', async () => {
  const mail = makeMail({ subject: 'NAV', text: 'Please send the NAV file.' });
  let calls = 0;
  const client = new LLMClient('sk-test', 'https://example.invalid', 'test', { sleep: async () => {}, transport: async () => {
    calls++;
    return response({ summary: 'The NAV file is needed.', issue_excerpt_id: 999 });
  } });
  client.confirmFallback = async () => false;
  await assert.rejects(client.enrich(mail, localRow(mail), '2026-11-13'), /cancelled/i);
  assert.equal(calls, 3);
});

test('a message without body content can leave its original issue excerpt blank', async () => {
  const mail = makeMail({ subject: 'NAV', text: '' });
  const client = new LLMClient('sk-test', 'https://example.invalid', 'test', { sleep: async () => {}, transport: async () => response({ summary: 'The subject concerns NAV.', issue_excerpt_id: null }) });
  const row = await client.enrich(mail, localRow(mail), '2026-11-13');
  assert.equal(row.issues, '');
  assert.equal(client.failureCount, 0);
});

test('a substantive request after 32 background sentences remains selectable', async () => {
  const { issueCandidates } = await import('../src/issue-excerpts.js');
  const background = Array.from({ length: 35 }, (_, n) => `Background item ${n} was reviewed.`).join(' ');
  const source = `Subject: NAV\n\n${background} Please send the missing NAV file.`;
  assert.ok(issueCandidates(source).some(item => item.text === 'Please send the missing NAV file.'));
});
