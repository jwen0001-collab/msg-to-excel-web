import { DEFAULT_BASE_URL, DEFAULT_MODEL, llmFromSettings } from './llm.js';
import { outputName, runBatch, todayParis } from './run.js';

const $ = id => document.getElementById(id);
const domParser = new DOMParser();
let files = [];
let busy = false;
$('url').value = DEFAULT_BASE_URL;
$('model').value = DEFAULT_MODEL;

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
  const batch = [...files];
  busy = true;
  $('go').disabled = true;
  $('files').disabled = true;
  $('results').replaceChildren();
  try {
    const { xlsx, report, rows, succeeded, failed } = await runBatch(batch, {
      domParser, entryDate: todayParis(), llm,
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
    let mode = llm ? 'English summaries and issue descriptions; see processing notes for any fallback' : 'Original excerpts enclosed in double quotes';
    if (llm && llm.unreachable) mode = 'The AI endpoint could not be reached (network or CORS); affected emails use quoted original excerpts';
    $('status').textContent = `Done: ${succeeded}/${batch.length} file(s) read, ${failed} skipped. ${rows.length} email(s). ${mode}. ${xlsx ? 'One Excel file contains the entire batch. Use the link below to download it again.' : 'No Excel file generated.'}`;
  } catch (e) {
    $('status').textContent = `Failed to generate the batch workbook: ${e && e.message ? e.message : e}`;
  } finally {
    busy = false;
    $('files').disabled = false;
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
