// Real-browser check of the built site (run `npm run build` first). Never commit real .msg files.
//   node tools/e2e.mjs <input.msg> <outdir> [chrome.exe]
//   SITE_URL=https://.../ node tools/e2e.mjs ...   (test the deployed site instead of dist/)
// Writes <outdir>/local.xlsx, <outdir>/llm.xlsx, <outdir>/blocked.xlsx and a screenshot.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const [msgPath, outDir, executablePath] = process.argv.slice(2);
const DIST = path.resolve('dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
}).listen(0);
const base = process.env.SITE_URL || `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath });
const fail = msg => { console.log('FAIL', msg); process.exitCode = 1; };

async function session(name, { ai, route } = {}) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  let downloads = 0;
  page.on('download', () => { downloads++; });
  page.on('dialog', dialog => dialog.accept()); // explicitly approve fallback in this test session
  const outside = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:')) outside.push(r.url()); });
  if (route) await page.route('https://ai.example.test/**', route);
  await page.goto(base);
  await page.setInputFiles('#files', [msgPath, msgPath]);
  if (ai) {
    await page.fill('#key', 'sk-e2e-secret');
    await page.fill('#url', 'https://ai.example.test/v1');
    await page.fill('#model', 'm');
  }
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#go')]);
  await dl.saveAs(path.join(outDir, `${name}.xlsx`));
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Done:'), null, { timeout: 60000 });
  const status = await page.textContent('#status');
  const results = await page.textContent('#results');
  if (downloads !== 1) fail(`${name}: expected one download for the entire batch, got ${downloads}`);
  if (await page.locator('#results a[download$=".xlsx"]').count() !== 1) fail(`${name}: expected one workbook link`);
  if (!status.includes('2/2 file(s)')) fail(`${name}: did not process both input files`);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  await page.close();
  console.log(`[${name}] download=${dl.suggestedFilename()}\n  status=${status}\n  results=${results.slice(0, 300)}`);
  console.log(`  requests outside the site: ${JSON.stringify(outside)}  console errors: ${JSON.stringify(errors)}`);
  return { outside, errors, results };
}

// 1. local mode: no request may leave the page
const local = await session('local');
if (local.outside.length) fail('local mode made outside requests');
if (local.errors.length) fail('console errors in local mode');

// 2. AI mode against a mocked endpoint that allows CORS
const ok = JSON.stringify({ choices: [{ message: { content: JSON.stringify({
  summary: 'E2E summary.', issues_description: 'E2E issues.', requestor: { name: null, evidence: null },
  follow_up_by: [], urgent: { value: false, evidence: null }, last_remind: { date: null, evidence: null } }) } }] });
let auth = '';
const llm = await session('llm', { ai: true, route: async r => {
  if (r.request().method() === 'OPTIONS') {
    return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' } });
  }
  auth = r.request().headers().authorization;
  return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: ok });
} });
if (auth !== 'Bearer sk-e2e-secret') fail(`Authorization header was ${auth}`);
if (llm.results.includes('sk-e2e-secret')) fail('key shown on page');

// 3. AI mode, endpoint blocked (what CORS / a proxy looks like): Excel must still come out, with a clear note
const blocked = await session('blocked', { ai: true, route: r => r.abort('blockedbyclient') });
if (!blocked.results.includes('CORS')) fail('blocked endpoint not explained');

await browser.close();
server.close();
