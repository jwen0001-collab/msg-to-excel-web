import { DEFAULT_BASE_URL, DEFAULT_MODEL, llmFromSettings } from './llm.js';
import { outputName, runBatch, todayParis } from './run.js';

const $ = id => document.getElementById(id);
const domParser = new DOMParser();
let files = [];
let busy = false;
$('url').value = DEFAULT_BASE_URL;
$('model').value = DEFAULT_MODEL;
if (import.meta.env.VITE_AI_RELAY_PATH) {
  $('key-help').textContent = 'Ready to use with deepseek-flash. Only your API key is required. Requests are forwarded through this website; no deployment secrets need to be configured.';
}

function setFiles(list) {
  if (busy) return;
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
  return llmFromSettings({ ...Object.fromEntries(['key', 'url', 'model'].map(id => [id, $(id).value])),
    relayPath: import.meta.env.VITE_AI_RELAY_PATH || '' });
}

function showAIError(message) {
  $('ai-error').hidden = false;
  $('ai-error').textContent = `AI error: ${message}`;
}

async function processAll() {
  $('ai-error').hidden = true;
  $('ai-error').textContent = '';
  let llm;
  try {
    llm = llmFromForm();
  } catch (e) {
    showAIError(e.message);
    $('status').textContent = e.message;
    return;
  }
  const batch = [...files];
  const mode = document.querySelector('input[name="mode"]:checked').value;
  let fallbackApproved = false;
  if (llm) {
    llm.onError = showAIError;
    llm.confirmFallback = async message => {
      if (fallbackApproved) return true;
      fallbackApproved = window.confirm(`AI error: ${message}\n\nUse quoted original excerpts for affected entries and continue this batch?\nCancel stops the batch without downloading an Excel file.`);
      return fallbackApproved;
    };
  }
  busy = true;
  $('go').disabled = true;
  $('files').disabled = true;
  document.querySelectorAll('input[name="mode"]').forEach(input => { input.disabled = true; });
  $('results').replaceChildren();
  try {
    const { xlsx, report, rows, succeeded, failed } = await runBatch(batch, {
      domParser, entryDate: todayParis(), llm, mode,
      log: line => { $('status').textContent = line; },
    });
    const item = li('');
    $('results').append(item);
    const name = outputName(batch.length === 1 ? batch[0].name : 'batch');
    if (xlsx) {
      const link = download(xlsx, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      item.append(`${rows.length} email(s) from ${succeeded} file(s) → `, link);
      link.click();
    } else {
      item.append('No readable emails found. No Excel file was generated.');
      item.classList.add('warn');
    }
    if (report.length) {
      const box = document.createElement('details');
      box.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `${report.length} processing note(s) (separate from the worksheet)`;
      const pre = document.createElement('pre');
      pre.textContent = report.join('\n');
      box.append(summary, pre, download(report.join('\n') + '\n', name.replace(/\.xlsx$/, '_report.txt'), 'text/plain;charset=utf-8'));
      item.append(box);
    }
    let resultMode = llm ? 'One-sentence English topics and quoted original issue excerpts' : 'Original excerpts enclosed in double quotes';
    if (llm && llm.failureCount) resultMode = `AI error affected ${llm.failureCount} entry/entries; original-excerpt fallback was approved`;
    $('status').textContent = `Done: ${succeeded}/${batch.length} file(s) read, ${failed} skipped. ${rows.length} entry/entries. ${resultMode}. ${xlsx ? 'One Excel file contains the entire batch. Use the link below to download it again.' : 'No Excel file generated.'}`;
  } catch (e) {
    $('status').textContent = `Failed to generate the batch workbook: ${e && e.message ? e.message : e}`;
  } finally {
    busy = false;
    $('files').disabled = false;
    document.querySelectorAll('input[name="mode"]').forEach(input => { input.disabled = false; });
    $('go').disabled = !files.length;
  }
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
