// Convert one email or a batch into a follow-up workbook.
import { isoDate, leafMails, localRow, makeMail } from './core.js';
import { writeExcel } from './excel.js';
import { readMsg } from './readmsg.js';

export const todayParis = () => isoDate(new Date());

/** Builds rows from an already-read Mail tree; shared by run() and the tests. */
export async function buildRows(root, { entryDate, llm = null, log = () => {}, limits } = {}) {
  const report = [];
  const mails = leafMails(root, report);
  const rows = [];
  for (const [n, mail] of mails.entries()) {
    let row = localRow(mail, limits);
    if (llm) {
      log(`[LLM] row ${n + 2}: ${mail.subject}`);
      row = await llm.enrich(mail, row, entryDate);
    }
    rows.push(row);
  }
  const xlsx = await writeExcel(rows, entryDate, report);
  return { xlsx, report, rows };
}

export async function run(bytes, { domParser, entryDate = todayParis(), llm = null, log = () => {} }) {
  const root = readMsg(bytes, domParser);
  if (!llm) {
    log('[local] Summary / Issues description are excerpts of the original text, ' +
        'not summaries or translations. Rule-based fields are left blank when unclear.');
  }
  return buildRows(root, { entryDate, llm, log });
}

/** Read every selected file, then write all email rows into one worksheet. */
export async function runBatch(files, { domParser, entryDate = todayParis(), llm = null, log = () => {} } = {}) {
  const roots = [];
  const errors = [];
  for (const [n, file] of files.entries()) {
    log(`Reading ${n + 1}/${files.length}: ${file.name}`);
    try {
      roots.push(readMsg(new Uint8Array(await file.arrayBuffer()), domParser));
    } catch {
      // Parser exceptions can contain source data; keep the batch report concise.
      errors.push(`${file.name}: could not read this .msg file; skipped`);
    }
  }
  const counts = { succeeded: roots.length, failed: errors.length };
  if (!roots.length) return { xlsx: null, rows: [], report: errors, ...counts };
  const root = makeMail({ subject: 'Batch', children: roots, hadMailAttachments: true, errors });
  const result = await buildRows(root, { entryDate, llm, log });
  return { ...result, xlsx: result.rows.length ? result.xlsx : null, ...counts };
}

/** <stem>_followup_YYYYMMDD_HHMMSS.xlsx, Paris time, like the Python tool. */
export function outputName(fileName, now = new Date()) {
  const stem = fileName.replace(/\.msg$/i, '');
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${stem}_followup_${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}.xlsx`;
}
