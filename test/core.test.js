// Port of test_msg_to_excel.py: same cases, same expected values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { DOMParser } from 'linkedom';
import * as m from '../src/core.js';
import { HttpError, LLMClient, MAX_INPUT_CHARS } from '../src/llm.js';
import { buildRows, outputName } from '../src/run.js';

const dom = new DOMParser();
const FIXED_TODAY = '2026-10-02';
const SENT = new Date('2026-09-15T10:00:00+02:00');

const QUOTED_EN = `Hi team,
Gentle reminder on the below.
Thanks
From: Jean-Luc Bérard
Sent: Monday, September 1, 2026 9:00 AM
To: Ops
Subject: TLM breaks
Please fix the TLM breaks on the NAV recon. This is urgent.
`;

const QUOTED_FR = `Bonjour,
Je me permets de vous relancer.
De : Hélène Dupré
Envoyé : vendredi 5 septembre 2026 14:50
À : Équipe
Objet : RE: Rapprochement
Petit rappel : merci de valider le fichier.
De : Hélène Dupré
Envoyé : lundi 1 septembre 2026 09:00
Objet : Rapprochement
Merci de valider le fichier.
`;

function mail(subject = 'Subj', text = 'Hello', kw = {}) {
  return m.makeMail({ subject, sender: 'Alice Martin', sent: SENT, text, ...kw });
}

async function build(mails, { llm = null, limits } = {}) {
  const root = m.makeMail({ subject: 'container', children: mails });
  const { xlsx, report } = await buildRows(root, { entryDate: FIXED_TODAY, llm, limits });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx);
  return { ws: wb.worksheets[0], report };
}

const cellValue = c => (c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.value ?? null);

function records(ws) {
  const heads = ws.getRow(1).values.slice(1);
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    out.push(Object.fromEntries(heads.map((h, i) => [h, cellValue(ws.getRow(r).getCell(i + 1))])));
  }
  return out;
}

// ------------------------------------------------------------ table contract

test('headers exact and entry date is run day', async () => {
  const { ws } = await build([mail('Subj', 'Hello', { sent: new Date('2020-01-01T00:00:00+01:00') })]);
  assert.deepEqual(ws.getRow(1).values.slice(1), m.HEADERS);
  assert.equal(ws.columnCount, 11);
  const rec = records(ws)[0];
  assert.equal(rec['Entry date'], FIXED_TODAY);
  assert.equal(ws.getCell('A2').numFmt, 'DD/MM/YYYY');
  assert.equal(rec.Status, 'Open');
  assert.equal(rec['Opening date'], null);
  assert.equal(rec['Last update'], null);
});

test('subject kept verbatim', async () => {
  const subj = 'RE: TR: Réconciliation NAV – Fonds Émeraude (ISIN FR0000) ';
  const { ws } = await build([mail(subj)]);
  assert.equal(records(ws)[0]['Email Subject'], subj);
});

test('formula-like text is stored as text', async () => {
  const { ws } = await build([mail('=HYPERLINK("http://x")', '=1+1 please')]);
  assert.equal(ws.getCell('B2').type, ExcelJS.ValueType.String);
  assert.equal(ws.getCell('B2').value, '=HYPERLINK("http://x")');
});

test('long cell truncated and reported', async () => {
  const { ws, report } = await build([mail('Subj', 'x '.repeat(20000))], { limits: { issuesChars: 1e6 } });
  assert.equal(ws.getCell('D2').value.length, m.EXCEL_CELL_MAX);
  assert.ok(report.some(r => r.includes('row 2') && r.includes('truncated')));
});

// ------------------------------------------------------------ nesting

test('nesting: one row per leaf, errors reported', async () => {
  const inner = m.makeMail({ subject: 'level1 container', children: [mail('deep A'), mail('deep B')],
    errors: ["attachment 'bad.msg' could not be read: boom"] });
  const { ws, report } = await build([mail('top A'), inner]);
  assert.deepEqual(records(ws).map(r => r['Email Subject']), ['top A', 'deep A', 'deep B']);
  assert.ok(report.some(r => r.includes('bad.msg')));
});

test('no mail attachment uses outer mail itself', () => {
  const outer = mail('only outer');
  assert.deepEqual(m.leafMails(outer, []), [outer]);
});

// ------------------------------------------------------------ text handling

test('html to text keeps accents and lines', () => {
  const html = '<html><style>p{}</style><body><p>Bonjour <b>Hélène</b>,</p><div>Merci&nbsp;!</div>A<br>B</body></html>';
  assert.equal(m.cleanText(m.htmlToText(html, dom)), 'Bonjour Hélène,\nMerci !\nA\nB');
});

test('invisible padding removed', () => {
  assert.equal(m.cleanText('Open͏ ͏ now­\x00'), 'Open now');
});

test('disclaimer and quote header removed from excerpt', () => {
  const text = 'Please send the file.\nThis message and any attachments (the "message") is\nconfidential.\n' +
    'From: Bob\nSent: Monday, September 1, 2026 9:00 AM\nSubject: x\nOld text';
  const segs = m.splitSegments(mail('Subj', text));
  assert.equal(segs[0].text, 'Please send the file.');
  assert.equal(segs[1].text, 'Old text');
  assert.equal(segs[1].sent, '2026-09-01');
});

test('bare forward uses quoted content and blank requestor', () => {
  const text = "From: Marc Évrard\nSent: Monday, September 1, 2026 9:00 AM\nSubject: KYC\nMerci d'envoyer le KYC.";
  const row = m.localRow(mail('FW: KYC', text, { sender: 'Forwarder Person' }));
  assert.equal(row.summary, "Merci d'envoyer le KYC.");
  assert.equal(row.requestor, '');
});

test('requestor is sender when not forward', () => {
  assert.equal(m.localRow(mail('RE: x', 'Hello', { sender: 'Zoë Lefèvre' })).requestor, 'Zoë Lefèvre');
});

// ------------------------------------------------------------ urgency

for (const [subject, text, expected] of [
  ['Payment', 'This is urgent, please process.', true],
  ['URGENT Alternance', 'Bonjour', true],
  ['Payment', 'Merci de traiter en urgence.', true],
  ['Payment', 'Please process ASAP.', true],
  ['Payment', 'This is not urgent.', false],
  ['Payment', "Ce n'est pas urgent.", false],
  ['Payment', 'Non urgent : à traiter quand possible.', false],
  ['Payment', "Pas d'urgence.", false],
  ['Payment', 'This is non-urgent.', false],
  ['Payment', 'Not-urgent', false],
  ['Payment', 'Thanks', false],
]) {
  test(`urgency: ${subject} / ${text}`, () => {
    assert.equal(m.localRow(mail(subject, text)).urgent, expected);
  });
}

test('urgency only in quoted history is ignored', () => {
  assert.equal(m.localRow(mail('RE: TLM', QUOTED_EN)).urgent, false);
});

test('high importance flag is urgent', () => {
  assert.equal(m.localRow(mail('Subj', 'Hello', { highImportance: true })).urgent, true);
});

// ------------------------------------------------------------ reminder dates

test('reminder in current message uses its sent date', () => {
  assert.equal(m.localRow(mail('RE: TLM', QUOTED_EN)).lastRemind, '2026-09-15');
});

test('latest reminder in french history', () => {
  assert.equal(m.localRow(mail('RE: Rapprochement', QUOTED_FR)).lastRemind, '2026-09-15');
  const segs = m.splitSegments(mail('Subj', QUOTED_FR));
  assert.deepEqual(segs.slice(1).map(s => s.sent), ['2026-09-05', '2026-09-01']);
});

test('no reminder means blank, not latest sent date', () => {
  assert.equal(m.localRow(mail('Question', 'Nous vous rappelons que le dossier est requis.')).lastRemind, null);
});

test('numeric quoted date is left blank', () => {
  assert.equal(m.parseWrittenDate('02/10/2026 14:50'), null);
});

// ------------------------------------------------------------ follow up by

test('follow up: explicit people kept with accents', () => {
  const row = m.localRow(mail('Subj', 'Please contact Jean-Luc Bérard and Zoë Lefèvre for the TLM breaks.'));
  assert.deepEqual(row.followUpBy, ['Jean-Luc Bérard', 'Zoë Lefèvre']);
});

test('follow up: french', () => {
  assert.deepEqual(m.localRow(mail('Subj', 'Merci de contacter Hélène Dupré pour le KYC.')).followUpBy, ['Hélène Dupré']);
});

test('follow up blank when not designated', async () => {
  const { ws } = await build([mail('Subj', 'Hi Bob, please send the NAV file. Cc: Carla')]);
  assert.equal(records(ws)[0]['Follow up by'], null);
});

test('follow up: multiple joined with semicolon', async () => {
  const { ws } = await build([mail('Subj', 'Please contact Anne Roy, Paul Biya.')]);
  assert.equal(records(ws)[0]['Follow up by'], 'Anne Roy; Paul Biya');
});

// ------------------------------------------------------------ local mode is offline

test('local mode does not touch network', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network used in local mode'); };
  try {
    await build([mail('Subj', QUOTED_EN)]);
  } finally {
    globalThis.fetch = saved;
  }
});

// ------------------------------------------------------------ LLM mode (mocked)

const reply = obj => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] });

const GOOD = {
  summary: 'Ops must fix TLM breaks on the NAV reconciliation.',
  issues_description: 'Jean-Luc Bérard asks Ops to fix the TLM breaks; a reminder was sent.',
  requestor: { name: 'Jean-Luc Bérard', evidence: 'From: Jean-Luc Bérard' },
  follow_up_by: [{ name: 'Ghost Person', evidence: 'Ghost Person will follow up' }],
  urgent: { value: true, evidence: 'This is urgent.' },
  last_remind: { date: '15/09/2026', evidence: 'Gentle reminder on the below.' },
};

function client(responses) {
  const calls = [];
  const transport = async payload => {
    calls.push(payload);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const c = new LLMClient('sk-secret', 'https://example.invalid/v1', 'm', { transport, sleep: async () => {} });
  return { c, calls };
}

test('llm: success and evidence grounding', async () => {
  const { c, calls } = client([reply(GOOD)]);
  const { ws, report } = await build([mail('RE: TLM', QUOTED_EN)], { llm: c });
  const rec = records(ws)[0];
  assert.equal(rec.Summary, GOOD.summary);
  assert.equal(rec.Requestor, 'Jean-Luc Bérard');
  assert.equal(rec['Follow up by'], null);            // ungrounded -> dropped
  assert.equal(rec['Last remind Date'], '2026-09-15');
  assert.equal(rec['Email Subject'], 'RE: TLM');
  assert.equal(rec.Status, 'Open');
  assert.ok(calls[0].messages[1].content.includes('<email>'));
  assert.deepEqual(report, []);
});

test('llm: urgent needs grounded evidence', async () => {
  const { c } = client([reply({ ...GOOD, urgent: { value: true, evidence: 'made up' } })]);
  const mm = mail('RE: TLM', QUOTED_EN);
  assert.equal((await c.enrich(mm, m.localRow(mm), FIXED_TODAY)).urgent, false);
});

test('llm: invalid structure retries then falls back', async () => {
  const { c, calls } = client([reply({ summary: '' }), { oops: 1 }, new Error('x')]);
  const { ws, report } = await build([mail('Subj', 'Please send the NAV file.')], { llm: c });
  assert.equal(calls.length, 3);
  assert.equal(records(ws)[0].Summary, 'Please send the NAV file.');
  assert.ok(report.some(r => r.includes('row 2') && r.includes('LLM failed') && r.includes('NOT an English summary')));
});

test('llm: one failure does not stop others, key never reported', async () => {
  const err = () => new Error('timeout with key sk-secret');
  const { c } = client([err(), err(), err(), reply(GOOD)]);
  const { ws, report } = await build([mail('A', 'first'), mail('RE: TLM', QUOTED_EN)], { llm: c });
  const recs = records(ws);
  assert.equal(recs[0].Summary, 'first');
  assert.equal(recs[1].Summary, GOOD.summary);
  assert.ok(report.every(r => !r.includes('sk-secret')));
});

test('llm: input truncation reported', async () => {
  const { c, calls } = client([reply({ ...GOOD, requestor: { name: null, evidence: null } })]);
  const { report } = await build([mail('Big', 'y '.repeat(20000))], { llm: c });
  assert.ok(calls[0].messages[1].content.length < MAX_INPUT_CHARS + 500);
  assert.ok(report.some(r => r.includes('row 2') && r.includes('truncated')));
});

// ------------------------------------------------------------ review regressions

for (const resp of [{ choices: [] }, { choices: [{ message: { content: null } }] }, 'not a dict']) {
  test(`llm: malformed reply falls back (${JSON.stringify(resp)})`, async () => {
    const { c } = client([resp, resp, resp]);
    const mm = mail('Subj', 'Please send it.');
    const row = await c.enrich(mm, m.localRow(mm), FIXED_TODAY);
    assert.equal(row.summary, 'Please send it.');
    assert.ok(row.notes[0].includes('LLM failed'));
  });
}

test('llm: 4xx is not retried', async () => {
  const err = new HttpError(401, 'Unauthorized');
  const { c, calls } = client([err, err, err]);
  const mm = mail();
  await c.enrich(mm, m.localRow(mm), FIXED_TODAY);
  assert.equal(calls.length, 1);
});

test('llm: urgency only in quoted history is rejected', async () => {
  const { c } = client([reply({ ...GOOD, urgent: { value: true, evidence: 'urgent' } })]);
  const mm = mail('RE: TLM', QUOTED_EN);
  assert.equal((await c.enrich(mm, m.localRow(mm), FIXED_TODAY)).urgent, false);
});

test('llm: name must match whole word', async () => {
  const { c } = client([reply({ ...GOOD, requestor: { name: 'Al', evidence: 'From: Jean-Luc Bérard' } })]);
  const mm = mail('RE: TLM', QUOTED_EN);
  assert.equal((await c.enrich(mm, m.localRow(mm), FIXED_TODAY)).requestor, '');
});

for (const text of ['This is now urgent.', 'Nonetheless urgent.', 'Nothing more urgent than this.']) {
  test(`negation needs a whole word: ${text}`, () => {
    assert.equal(m.localRow(mail('Subj', text)).urgent, true);
  });
}

test('stray From line does not cut current message', () => {
  const text = 'Hi,\nFrom: our side the NAV is fine.\nPlease contact Anne Roy, urgent.\nThanks\n' +
    'From: Bob\nSent: Monday, September 1, 2026 9:00 AM\nSubject: x\nOld';
  const row = m.localRow(mail('Subj', text));
  assert.deepEqual(row.followUpBy, ['Anne Roy']);
  assert.equal(row.urgent, true);
});

test('bare forward rules read the forwarded content', () => {
  const text = 'From: Marc Évrard\nSent: Monday, September 1, 2026 9:00 AM\nSubject: KYC\n' +
    'Please contact Anne Roy. This is urgent.';
  const row = m.localRow(mail('FW: KYC', text));
  assert.deepEqual(row.followUpBy, ['Anne Roy']);
  assert.equal(row.urgent, true);
});

for (const [s, expected] of [
  ['lun. 1 sept. 2026 09:00', '2026-09-01'],
  ['Mon 1 Sept 2026', '2026-09-01'],
  ['Tue, Oct 6, 2026 10:00', '2026-10-06'],
  ['mer. 3 déc. 2026', '2026-12-03'],
]) {
  test(`abbreviated months: ${s}`, () => assert.equal(m.parseWrittenDate(s), expected));
}

test('table cells are separated', () => {
  assert.equal(m.cleanText(m.htmlToText('<table><tr><td>Fund</td><td>NAV</td></tr></table>', dom)), 'Fund NAV');
});

test('container whose mail attachments all fail gets no row', () => {
  const report = [];
  const outer = m.makeMail({ subject: 'wrapper', hadMailAttachments: true, errors: ["attachment 'a.msg' could not be read: x"] });
  assert.deepEqual(m.leafMails(outer, report), []);
  assert.ok(report.some(r => r.includes('a.msg')));
});

test('issues include quoted context and disclaimer cut', () => {
  const text = 'Pour votre information…\nDe : Corinne Chinazzo\nEnvoyé : vendredi 2 octobre 2026 15:36\n' +
    'Objet : Offres\nStage Analyste M&A chez Ecrins Partners\n' +
    'Ce courriel et ses pièces jointes peuvent contenir des informations confidentielles';
  const row = m.localRow(mail('Stages', text));
  assert.equal(row.summary, 'Pour votre information…');
  assert.equal(row.issues, 'Pour votre information…\n\nStage Analyste M&A chez Ecrins Partners');
});

// ------------------------------------------------------------ web-only

test('llm: unreachable endpoint (CORS/proxy) is not retried for every remaining row', async () => {
  const { c, calls } = client([new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  const { report } = await build([mail('A', 'first'), mail('B', 'second')], { llm: c });
  assert.equal(calls.length, 3);                       // row 2 only; row 3 skipped
  assert.ok(report.some(r => r.startsWith('row 2') && r.includes('CORS')));
  assert.ok(report.some(r => r.startsWith('row 3') && r.includes('unreachable')));
});

test('output name is stem + Paris timestamp', () => {
  assert.equal(outputName('Mail.MSG', new Date('2026-10-02T13:04:05Z')), 'Mail_followup_20261002_150405.xlsx');
});
