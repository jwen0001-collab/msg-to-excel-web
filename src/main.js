import { DEFAULT_BASE_URL, DEFAULT_MODEL, llmFromSettings } from './llm.js';
import { outputName, run, todayParis } from './run.js';

const $ = id => document.getElementById(id);
const domParser = new DOMParser();
let files = [];
$('url').value = DEFAULT_BASE_URL;
$('model').value = DEFAULT_MODEL;

function setFiles(list) {
  files = [...list].filter(f => f.name.toLowerCase().endsWith('.msg'));
  const skipped = list.length - files.length;
  $('picked').replaceChildren(...files.map(f => li(f.name)));
  if (skipped) $('picked').append(li(`Skipped ${skipped} file(s) that are not .msg files.`, 'warn'));
  $('go').disabled = !files.length;
  $('status').textContent = '';
}

function li(text, cls) {
  const el = document.createElement('li');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.textContent = name;
  return a;
}

/** No key = offline mode, even with prefilled advanced settings. */
function llmFromForm() {
  return llmFromSettings(Object.fromEntries(['key', 'url', 'model'].map(id => [id, $(id).value])));
}

async function processAll() {
  let llm;
  try {
    llm = llmFromForm();
  } catch (e) {
    $('status').textContent = e.message;
    return;
  }
  $('go').disabled = true;
  $('results').replaceChildren();
  const entryDate = todayParis();
  let failed = 0;

  for (const [n, file] of files.entries()) {
    $('status').textContent = `Processing ${n + 1}/${files.length}: ${file.name}`;
    const item = li('');
    const title = document.createElement('b');
    title.textContent = file.name;
    item.append(title);
    $('results').append(item);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const log = line => { $('status').textContent = `${file.name}: ${line}`; };
      const { xlsx, report, rows } = await run(bytes, { domParser, entryDate, llm, log });
      const name = outputName(file.name);
      const link = download(xlsx, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      item.append(` — ${rows.length} email(s) → `, link);
      link.click();
      if (report.length) {
        const box = document.createElement('details');
        box.open = true;
        const s = document.createElement('summary');
        s.textContent = `${report.length} processing note(s): truncation, AI failures or unreadable attachments (separate from the worksheet)`;
        const pre = document.createElement('pre');
        pre.textContent = report.join('\n');
        box.append(s, pre, download(report.join('\n') + '\n', name.replace(/\.xlsx$/, '_report.txt'), 'text/plain;charset=utf-8'));
        item.append(box);
      }
    } catch (e) {
      failed++;
      item.classList.add('warn');
      item.append(` — Failed; no Excel file generated: ${e && e.message ? e.message : e}`);
    }
  }
  let mode = llm ? 'AI mode: English summaries and issue descriptions; check processing notes for any fallback to original excerpts' : 'Offline mode: Summary / Issues description contain original excerpts, not summaries or translations';
  if (llm && llm.unreachable) {
    mode = 'The AI endpoint could not be reached (network or CORS). Affected emails use original excerpts; see processing notes';
  }
  $('status').textContent = `Done: ${files.length - failed}/${files.length} file(s). ${mode}. Downloads were started automatically; use the links below to download again.`;
  $('go').disabled = false;
}

$('files').addEventListener('change', e => setFiles(e.target.files));
const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  setFiles(e.dataTransfer.files);
});
$('go').addEventListener('click', processAll);
