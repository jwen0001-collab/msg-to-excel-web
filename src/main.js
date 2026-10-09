import { LLMClient } from './llm.js';
import { outputName, run, todayParis } from './run.js';

const $ = id => document.getElementById(id);
const domParser = new DOMParser();
let files = [];

function setFiles(list) {
  files = [...list].filter(f => f.name.toLowerCase().endsWith('.msg'));
  const skipped = list.length - files.length;
  $('picked').replaceChildren(...files.map(f => li(f.name)));
  if (skipped) $('picked').append(li(`已忽略 ${skipped} 个不是 .msg 的文件`, 'warn'));
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

/** null = local mode; throws when the AI fields are only partly filled. */
function llmFromForm() {
  const [key, url, model] = ['key', 'url', 'model'].map(id => $(id).value.trim());
  if (!key && !url && !model) return null;
  if (!key || !url || !model) throw new Error('AI 总结需要同时填 API Key、接口地址、模型；不用 AI 就三项都清空。');
  if (!/^https:\/\//i.test(url)) throw new Error('接口地址必须以 https:// 开头。');
  return new LLMClient(key, url, model);
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
    $('status').textContent = `正在处理 ${n + 1}/${files.length}：${file.name}`;
    const item = li('');
    const title = document.createElement('b');
    title.textContent = file.name;
    item.append(title);
    $('results').append(item);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const log = line => { $('status').textContent = `${file.name}：${line}`; };
      const { xlsx, report, rows } = await run(bytes, { domParser, entryDate, llm, log });
      const name = outputName(file.name);
      const link = download(xlsx, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      item.append(` — ${rows.length} 封邮件 → `, link);
      link.click();
      if (report.length) {
        const box = document.createElement('details');
        box.open = true;
        const s = document.createElement('summary');
        s.textContent = `${report.length} 条说明（截断、AI 失败、读不了的附件等），不在表格里`;
        const pre = document.createElement('pre');
        pre.textContent = report.join('\n');
        box.append(s, pre, download(report.join('\n') + '\n', name.replace(/\.xlsx$/, '_report.txt'), 'text/plain;charset=utf-8'));
        item.append(box);
      }
    } catch (e) {
      failed++;
      item.classList.add('warn');
      item.append(` — 失败，没有生成 Excel：${e && e.message ? e.message : e}`);
    }
  }
  let mode = llm ? 'AI 总结' : '本地模式（Summary / Issues 为原文摘录，不是总结或翻译）';
  if (llm && llm.unreachable) {
    mode = 'AI 接口连不上（多半是公司网络拦截，或接口不允许网页直接调用），这次用的是原文摘录';
  }
  $('status').textContent = `完成：${files.length - failed}/${files.length} 个文件。${mode}。Excel 已自动下载，也可以点下面的文件名再下载一次。`;
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
