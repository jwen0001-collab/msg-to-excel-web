import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelay } from '../server/relay.js';

const payload = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Synthetic test request.' }], temperature: 0 };
function request(overrides = {}) {
  return { method: 'POST', headers: { host: 'tracker.example', origin: 'https://tracker.example', 'content-type': 'application/json', authorization: 'Bearer sk-test', 'x-ai-endpoint': 'https://api.deepseek.com/chat/completions' }, body: payload, ...overrides };
}
async function invoke(handler, req) {
  const headers = {};
  let body;
  const res = { statusCode: 200, setHeader: (name, value) => { headers[name.toLowerCase()] = value; }, end: text => { body = text; } };
  await handler(req, res);
  return { status: res.statusCode, headers, body: body ? JSON.parse(body) : null };
}

test('relay forwards a request to DeepSeek without requiring environment variables', async () => {
  let forwarded;
  const handler = createRelay({ fetchImpl: async (url, options) => {
    forwarded = { url, options };
    return Response.json({ choices: [{ message: { content: 'result' } }] });
  } });
  const result = await invoke(handler, request());
  assert.equal(result.status, 200);
  assert.equal(result.body.choices[0].message.content, 'result');
  assert.equal(forwarded.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(forwarded.options.headers.Authorization, 'Bearer sk-test');
  assert.equal(JSON.parse(forwarded.options.body).model, 'deepseek-flash');
  assert.equal(JSON.parse(forwarded.options.body).stream, false);
  assert.equal(forwarded.options.redirect, 'error');
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('relay preserves provider error status and removes credentials from returned messages', async () => {
  const handler = createRelay({ fetchImpl: async () => Response.json({ error: { message: 'Invalid key sk-test' } }, { status: 401 }) });
  const result = await invoke(handler, request());
  assert.equal(result.status, 401);
  assert.ok(!JSON.stringify(result.body).includes('sk-test'));
  assert.match(result.body.error.message, /Invalid key/);
});

test('relay does not forward arbitrary destinations or requests without a key', async () => {
  const handler = createRelay({ fetchImpl: () => { throw new Error('must not forward'); } });
  for (const endpoint of ['http://api.deepseek.com/chat/completions', 'https://127.0.0.1/chat/completions', 'https://api.deepseek.com.evil.test/chat/completions', 'https://api.deepseek.com/chat/completions?key=x', 'https://user:pass@api.deepseek.com/chat/completions']) {
    const req = request(); req.headers['x-ai-endpoint'] = endpoint;
    assert.equal((await invoke(handler, req)).status, 400);
  }
  const req = request(); delete req.headers.authorization;
  assert.equal((await invoke(handler, req)).status, 401);
});

test('relay rejects cross-origin callers and unsupported methods', async () => {
  const handler = createRelay({ fetchImpl: () => { throw new Error('must not forward'); } });
  const req = request(); req.headers.origin = 'https://another-site.example';
  assert.equal((await invoke(handler, req)).status, 403);
  assert.equal((await invoke(handler, request({ method: 'GET' }))).status, 405);
});

test('relay rejects malformed and oversized bodies', async () => {
  const handler = createRelay({ fetchImpl: () => { throw new Error('must not forward'); } });
  assert.equal((await invoke(handler, request({ body: 'not json' }))).status, 400);
  assert.equal((await invoke(handler, request({ body: { model: 'x', messages: [] } }))).status, 400);
  assert.equal((await invoke(handler, request({ body: { ...payload, messages: [{ role: 'user', content: 'x'.repeat(150000) }] } }))).status, 413);
});

test('server connection failures become readable errors without exposing raw exception text', async () => {
  const handler = createRelay({ fetchImpl: async () => { throw new Error('secret sk-test'); } });
  const result = await invoke(handler, request());
  assert.equal(result.status, 502);
  assert.match(result.body.error.message, /could not reach/i);
  assert.ok(!JSON.stringify(result.body).includes('sk-test'));
});
