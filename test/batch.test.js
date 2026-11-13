import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { DOMParser } from 'linkedom';
import { burn } from '@kenjiuno/msgreader/lib/Burner.js';
import * as runner from '../src/run.js';

function msgFile(name, subject, nested = false) {
  const entries = [{ name: 'Root Entry', type: 5, length: 0, children: [] }];
  const folder = (parent, name) => {
    const index = entries.length;
    entries[parent].children.push(index);
    entries.push({ name, type: 1, length: 0, children: [] });
    return index;
  };
  const stream = (parent, tag, text) => {
    const bytes = Uint8Array.from(Buffer.from(text + '\0', 'utf16le'));
    entries[parent].children.push(entries.length);
    entries.push({ name: '__substg1.0_' + tag, type: 2, length: bytes.length, binaryProvider: () => bytes });
  };
  const email = (parent, subject) => {
    stream(parent, '0037001F', subject);
    stream(parent, '1000001F', 'Please send the NAV file.');
  };
  email(0, subject);
  if (nested) {
    for (const [i, suffix] of ['A', 'B'].entries()) {
      const attachment = folder(0, '__attach_version1.0_#' + String(i).padStart(8, '0'));
      stream(attachment, '3707001F', suffix + '.msg');
      email(folder(attachment, '__substg1.0_3701000D'), subject + ' ' + suffix);
    }
  }
  const bytes = burn(entries);
  return { name, arrayBuffer: async () => bytes.buffer };
}

const options = () => ({ domParser: new DOMParser(), entryDate: '2026-11-13' });
const invalid = { name: 'broken.msg', arrayBuffer: async () => new ArrayBuffer(0) };

test('one batch produces one workbook containing all files and embedded emails in order', async () => {
  const result = await runner.runBatch([msgFile('one.msg', 'First'), msgFile('bundle.msg', 'Attached', true)], options());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.xlsx);
  assert.equal(wb.worksheets.length, 1);
  const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 4);
  assert.deepEqual([2, 3, 4].map(n => ws.getCell(n, 2).value), ['First', 'Attached A', 'Attached B']);
  assert.equal(ws.getCell('C4').value, '"Please send the NAV file."');
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
});

test('an unreadable file does not stop other files in the same workbook', async () => {
  const result = await runner.runBatch([invalid, msgFile('good.msg', 'Good')], options());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.xlsx);
  assert.equal(wb.worksheets[0].getCell('B2').value, 'Good');
  assert.equal(result.failed, 1);
  assert.equal(result.succeeded, 1);
  assert.ok(result.report.some(note => note.includes('broken.msg')));
});

test('an empty or wholly unreadable batch does not download an empty workbook', async () => {
  for (const files of [[], [invalid]]) {
    const result = await runner.runBatch(files, options());
    assert.equal(result.xlsx, null);
    assert.deepEqual(result.rows, []);
  }
});
