// Request-scoped relay: no environment secrets, database, storage, or request logging.
const MAX_BODY_BYTES = 128000;
const ENDPOINTS = new Set([
  'https://api.deepseek.com/chat/completions',
  'https://api.deepseek.com/v1/chat/completions',
  'https://api.openai.com/v1/chat/completions',
]);

class InputError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) throw new InputError(413, 'Request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!serialized) throw new InputError(400, 'A JSON request body is required.');
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) throw new InputError(413, 'Request is too large.');
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new InputError(400, 'Invalid JSON request body.'); }
}

export function createRelay({ fetchImpl = fetch } = {}) {
  return async function relay(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    const error = (status, message) => send(status, { error: { message } });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return error(405, 'Use POST for AI requests.');
    }
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return error(403, 'Invalid request origin.'); }
      if (origin.host !== req.headers.host) return error(403, 'Use the relay from its own website.');
    }
    const authorization = req.headers.authorization || '';
    if (!/^Bearer [^\r\n]{1,2048}$/.test(authorization)) return error(401, 'Enter your API key on the page.');
    const endpoint = req.headers['x-ai-endpoint'] || 'https://api.deepseek.com/chat/completions';
    if (!ENDPOINTS.has(endpoint)) return error(400, 'This relay supports the official DeepSeek and OpenAI Chat Completions endpoints only.');
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return error(415, 'Send an application/json request.');

    let body;
    try { body = await readBody(req); }
    catch (e) { return error(e instanceof InputError ? e.status : 400, e instanceof InputError ? e.message : 'Could not read the request.'); }
    if (!body || typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 ||
        !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 10 ||
        body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
      return error(400, 'A model and text messages are required.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ model: body.model.trim(), messages: body.messages.map(m => ({ role: m.role, content: m.content })), temperature: 0, stream: false }),
      });
      let data;
      try { data = await upstream.json(); }
      catch { return error(502, 'The AI provider returned an unreadable response.'); }
      if (!upstream.ok) {
        const key = authorization.slice(7);
        const message = typeof data?.error?.message === 'string' ? data.error.message : `The AI provider returned HTTP ${upstream.status}.`;
        return error(upstream.status, message.split(key).join('***').slice(0, 500));
      }
      if (!Array.isArray(data?.choices)) return error(502, 'The AI provider returned an unexpected response.');
      return send(200, { choices: data.choices });
    } catch {
      return error(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'The AI provider took too long to respond. Try again.' : 'The relay could not reach the AI provider. Try again later.');
    } finally { clearTimeout(timer); }
  };
}
