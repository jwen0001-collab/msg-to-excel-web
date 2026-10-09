// Rows -> .xlsx bytes (port of write_excel in msg_to_excel.py).
import ExcelJS from 'exceljs';
import { EXCEL_CELL_MAX, HEADERS } from './core.js';

const ILLEGAL_CHARACTERS_RE = /[\x00-\x08\x0b-\x0c\x0e-\x1f]/g;   // same set as openpyxl
// ExcelJS drops a column whose width is exactly 9 (its "default"), so 9 is nudged to 9.0001.
const WIDTHS = [12, 40, 50, 70, 22, 22, 9, 9, 12, 14, 12].map(w => (w === 9 ? 9.0001 : w));

/** 'YYYY-MM-DD' -> Date at UTC midnight, which ExcelJS stores as a whole-day serial. */
function excelDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function writeExcel(rows, entryDate, report) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Follow-up', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2' }] });
  ws.columns = WIDTHS.map(width => ({ width }));
  ws.addRow(HEADERS).eachCell(c => { c.font = { bold: true }; });

  rows.forEach((r, idx) => {
    const i = idx + 2;
    const values = [
      { date: entryDate }, r.subject, r.summary, r.issues, r.requestor,
      r.followUpBy.join('; '), 'Open', r.urgent ? 'Urgent' : null,
      null, r.lastRemind ? { date: r.lastRemind } : null, null,
    ];
    values.forEach((v, c) => {
      const cell = ws.getCell(i, c + 1);
      if (v && typeof v === 'object') {
        cell.value = excelDate(v.date);
        cell.numFmt = 'DD/MM/YYYY';
      } else if (v) {
        v = v.replace(ILLEGAL_CHARACTERS_RE, '');
        const cps = Array.from(v);
        if (cps.length > EXCEL_CELL_MAX) {
          v = cps.slice(0, EXCEL_CELL_MAX).join('');
          report.push(`row ${i}: '${HEADERS[c]}' truncated to ${EXCEL_CELL_MAX} chars`);
        }
        cell.value = v;          // plain string: never a formula, even if it starts with '='
      }
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
    for (const note of r.notes) report.push(`row ${i} (${r.subject}): ${note}`);
  });

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
