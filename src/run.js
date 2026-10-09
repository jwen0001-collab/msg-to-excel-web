// One .msg -> one .xlsx + report lines (port of run() in msg_to_excel.py).
import { isoDate, leafMails, localRow } from './core.js';
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

/** <stem>_followup_YYYYMMDD_HHMMSS.xlsx, Paris time, like the Python tool. */
export function outputName(fileName, now = new Date()) {
  const stem = fileName.replace(/\.msg$/i, '');
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${stem}_followup_${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}.xlsx`;
}
