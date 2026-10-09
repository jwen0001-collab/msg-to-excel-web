// Rules ported 1:1 from msg_to_excel.py (the Python tool is the reference implementation).
// JS regex \w and \b are ASCII-only, Python's are Unicode: W / NW / WB below restore Python semantics.

export const HEADERS = [
  'Entry date', 'Email Subject', 'Summary', 'Issues description', 'Requestor',
  'Follow up by', 'Status', 'Priority', 'Opening date', 'Last remind Date', 'Last update',
];
export const SUMMARY_CHARS = 200;
export const ISSUES_CHARS = 1000;
export const EXCEL_CELL_MAX = 32767;

const W = '[\\p{L}\\p{N}_]';        // Python \w
const NB = `(?<!${W})`;             // \b before a word char
const NA = `(?!${W})`;              // \b after a word char

// ---------------------------------------------------------------- data model

export function makeMail(fields = {}) {
  return {
    subject: '', sender: '', sent: null, highImportance: false, text: '',
    children: [], errors: [], hadMailAttachments: false, ...fields,
  };
}

export function makeRow(subject) {
  return { subject, summary: '', issues: '', requestor: '', followUpBy: [], urgent: false, lastRemind: null, notes: [] };
}

// ---------------------------------------------------------------- dates (Europe/Paris)

const PARIS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function parisParts(d) {
  const p = Object.fromEntries(PARIS_FMT.formatToParts(d).map(x => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, H: p.hour, M: p.minute, S: p.second };
}

/** Calendar date as 'YYYY-MM-DD'; a Date instant is read in Paris time. */
export function isoDate(v) {
  if (typeof v === 'string') return v;
  const p = parisParts(v);
  return `${p.y}-${p.m}-${p.d}`;
}

function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- text cleaning

const INVISIBLE_RE = /[­͏​-‏⁠﻿   ]/gu;
const SPACE_LIKE = '   ';
const BLOCK_TAGS = ['p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote'];

export function cleanText(text) {
  text = text.replaceAll('\x00', '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(INVISIBLE_RE, c => (SPACE_LIKE.includes(c) ? ' ' : ''));
  return text.split('\n').map(ln => ln.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** domParser: a DOMParser instance (window.DOMParser in the browser, linkedom in tests). */
export function htmlToText(html, domParser) {
  const doc = domParser.parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, style, head, title')) el.remove();
  for (const el of doc.querySelectorAll('br')) el.replaceWith(doc.createTextNode('\n'));
  for (const el of doc.querySelectorAll(BLOCK_TAGS.filter(t => t !== 'br').join(','))) el.append(doc.createTextNode('\n'));
  for (const el of doc.querySelectorAll('td, th')) el.append(doc.createTextNode(' '));
  return (doc.documentElement && doc.documentElement.textContent) || '';
}

// ---------------------------------------------------------------- nesting

/** Each mail attachment becomes one row; a container with mail attachments gets no row. */
export function leafMails(mail, report, path = '') {
  for (const err of mail.errors) report.push(`${path || mail.subject}: ${err}`);
  if (!mail.children.length) return mail.hadMailAttachments ? [] : [mail];
  const out = [];
  for (const child of mail.children) out.push(...leafMails(child, report, `${path || mail.subject} > ${child.subject}`));
  return out;
}

// ---------------------------------------------------------------- local rules

const QUOTE_START_RE = new RegExp(
  "^(?:-{2,}\\s*(?:Original Message|Message d'origine|Forwarded message|Message transféré)\\s*-{2,}" +
  '|(?:From|De)\\s?:.*)$', 'gimu');
const SENT_LINE_RE = /^(?:Sent|Envoyé|Date)\s?:\s*(.+)$/imu;
const DISCLAIMER_RE = new RegExp(
  '^(?:This message and any attachments \\(the "message"\\)|This e-mail and any attachments' +
  '|Ce message et toutes les pi[eè]ces jointes|Ce courriel et ses pi[eè]ces jointes|Classification\\s?:)', 'imu');
const QUOTE_HEADER_LINE_RE = /^(?:From|De|Sent|Envoyé|Date|To|À|A|Cc|Subject|Objet)\s?:/iu;

/** Current message first, then each quoted earlier message. sent: Date (current) or 'YYYY-MM-DD' or null. */
export function splitSegments(mail) {
  const text = mail.text;
  const starts = [];
  for (const m of text.matchAll(QUOTE_START_RE)) {
    const window = text.slice(m.index).split('\n').slice(0, 4).join('\n');   // Sent/Date must be in this header
    const g = m[0].toLowerCase();
    if ((g.startsWith('from') || g.startsWith('de')) && !SENT_LINE_RE.test(window)) continue;  // stray "From:"
    starts.push(m.index);
  }
  const bounds = [0, ...starts, text.length];
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let chunk = text.slice(bounds[i], bounds[i + 1]);
    let sent;
    if (i === 0) {
      sent = mail.sent;
    } else {
      const m = SENT_LINE_RE.exec(cpSlice(chunk, 0, 600));
      sent = m ? parseWrittenDate(m[1]) : null;
      chunk = stripQuoteHeader(chunk);
    }
    const d = DISCLAIMER_RE.exec(chunk);
    if (d) chunk = chunk.slice(0, d.index);
    segs.push({ text: chunk.trim(), sent, quoted: i > 0 });
  }
  return segs;
}

export function stripQuoteHeader(chunk) {
  const lines = chunk.split('\n');
  let i = 0;
  if (lines.length && lines[0].startsWith('-')) i = 1;
  while (i < lines.length && (QUOTE_HEADER_LINE_RE.test(lines[i]) || (i < 2 && !lines[i].trim()))) i++;
  return lines.slice(i).join('\n');
}

export const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  'décembre': 12, decembre: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12, janv: 1, 'févr': 2, fevr: 2, avr: 4, juil: 7, 'déc': 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_DMY_RE = new RegExp(`${NB}(\\d{1,2})(?:er)?\\s+(${MONTH_ALT})\\.?\\s+(\\d{4})${NA}`, 'iu');
const DATE_MDY_RE = new RegExp(`${NB}(${MONTH_ALT})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${NA}`, 'iu');

/** Only dates with a written month name; purely numeric dates are ambiguous -> null. */
export function parseWrittenDate(s) {
  let m = DATE_DMY_RE.exec(s);
  let d, mon, y;
  if (m) {
    [d, mon, y] = [Number(m[1]), MONTHS[m[2].toLowerCase()], Number(m[3])];
  } else {
    m = DATE_MDY_RE.exec(s);
    if (!m) return null;
    [mon, d, y] = [MONTHS[m[1].toLowerCase()], Number(m[2]), Number(m[3])];
  }
  return validDate(y, mon, d);
}

const NEGATED_URGENT_RE = new RegExp(
  `${NB}(?:not|no|non|pas)${NA}[\\s-]*(?:${W}+\\s+){0,2}(?:urgent${W}*|urgence)` +
  `|${NB}(?:nothing|rien d')\\s*urgent${NA}|${NB}pas d'urgence${NA}|${NB}no rush${NA}`, 'giu');
const URGENT_RE = new RegExp(
  `${NB}urgent${W}*|${NB}urgence${NA}|${NB}asap${NA}|${NB}as soon as possible${NA}|${NB}au plus vite${NA}` +
  `|${NB}high priority${NA}|${NB}priorité haute${NA}|${NB}très prioritaire${NA}`, 'iu');

export function isUrgent(mail, currentText) {
  if (mail.highImportance) return true;
  for (const text of [mail.subject, currentText]) {
    if (URGENT_RE.test(text.replace(NEGATED_URGENT_RE, ' '))) return true;
  }
  return false;
}

const REMINDER_RE = new RegExp(
  `${NB}(?:reminder|following up on|follow(?:ing)?[- ]up on my|chasing|` +
  'relance|relancer|je reviens vers vous|petit rappel|rappel\\s?:)', 'iu');
const SUBJECT_REMINDER_RE = new RegExp(`${NB}(?:reminder|rappel|relance|2nd request|second request)${NA}`, 'iu');

export function lastRemindDate(mail, segs) {
  const found = [];
  segs.forEach((seg, i) => {
    const hit = REMINDER_RE.test(seg.text) || (i === 0 && SUBJECT_REMINDER_RE.test(mail.subject));
    if (hit && seg.sent) found.push(isoDate(seg.sent));
  });
  return found.length ? found.sort().at(-1) : null;
}

/** Python's (?i:...) group, without relying on JS regex modifiers: letters become [xX]. */
function caseless(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { out += c + pattern[++i]; continue; }
    const lo = c.toLowerCase(), up = c.toUpperCase();
    out += lo !== up ? `[${lo}${up}]` : c;
  }
  return out;
}

const NAME_WORD = "[A-ZÀ-ÖØ-Þ][\\p{L}\\p{N}_'’\\-À-ÿ]+";
const NAME = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,3}`;
const FOLLOW_UP_TRIGGER = caseless(
  'please (?:contact|reach out to|get in touch with|liaise with|follow up with)' +
  '|(?:point of )?contact person\\s?:|follow[- ]up by\\s?:?|to be followed (?:up )?by' +
  '|(?:merci|veuillez|je vous remercie) de (?:contacter|vous rapprocher de|voir avec)' +
  '|votre (?:contact|interlocut(?:eur|rice))\\s?:|suivi par\\s?:?|à suivre par\\s?:?');
const FOLLOW_UP_RE = new RegExp(
  `(?:${FOLLOW_UP_TRIGGER})\\s+(${NAME}(?:\\s*(?:,|;|${NB}and${NA}|${NB}et${NA}|&)\\s*${NAME})*)`, 'gu');
const NAME_RE = new RegExp(NAME, 'gu');
const NAME_STOPWORDS = new Set(['Mr', 'Mrs', 'Ms', 'M', 'Mme', 'Madame', 'Monsieur', 'Dr']);

export function followUpPeople(text) {
  const people = [];
  for (const m of text.matchAll(FOLLOW_UP_RE)) {
    for (const [raw] of m[1].matchAll(NAME_RE)) {
      const name = raw.split(/\s+/u).filter(w => w && !NAME_STOPWORDS.has(w)).join(' ');
      if (name && !people.includes(name)) people.push(name);
    }
  }
  return people;
}

const FORWARD_RE = /^\s*(?:fw|fwd|tr)\s?:/iu;

/** Slice by code points (Python str semantics), not UTF-16 units. */
export function cpSlice(s, start, end) {
  return Array.from(s).slice(start, end).join('');
}

export function excerpt(text, limit, oneLine) {
  if (oneLine) text = text.replace(/\s*\n\s*/gu, ' ');
  const cps = Array.from(text);
  if (cps.length <= limit) return text;
  const cut = cps.slice(0, limit);
  const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (sp > limit * 0.6 ? cut.slice(0, sp) : cut).join('').trimEnd() + '…';
}

/** The current message; for a bare forward, the first quoted message with content. */
export function currentContent(segs) {
  return segs[0].text || (segs.slice(1).find(s => s.text) || { text: '' }).text;
}

export function localRow(mail, limits = {}) {
  const { summaryChars = SUMMARY_CHARS, issuesChars = ISSUES_CHARS } = limits;
  const segs = splitSegments(mail);
  const content = currentContent(segs);
  const row = makeRow(mail.subject);
  row.summary = excerpt(content, summaryChars, true);
  // quoted messages are context for the request (e.g. "FYI" on top of the real content)
  row.issues = excerpt(segs.filter(s => s.text).map(s => s.text).join('\n\n'), issuesChars, false);
  row.requestor = FORWARD_RE.test(mail.subject) ? '' : mail.sender;
  row.followUpBy = followUpPeople(content);
  row.urgent = isUrgent(mail, content);
  row.lastRemind = lastRemindDate(mail, segs);
  return row;
}
