// Outlook .msg bytes -> Mail tree (port of read_msg in msg_to_excel.py).
import MsgReaderModule from '@kenjiuno/msgreader';
import { cleanText, htmlToText, makeMail } from './core.js';

const MsgReader = MsgReaderModule.default || MsgReaderModule;
const PR_IMPORTANCE = '00170003';

function open(bytes) {
  const reader = new MsgReader(bytes);
  reader.parserConfig = { includeRawProps: true };
  const fields = reader.getFileData();
  if (fields.error) throw new Error(fields.error);
  return { reader, fields };
}

// windows-1252 bytes 0x80-0x9f; Node's TextDecoder leaves them as C1 controls, browsers map them like this.
const CP1252_C1 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';

/** TextDecoder, except windows-1252 is decoded the same way in Node and in browsers. */
function decode(bytes, label, fatal = false) {
  const text = new TextDecoder(label, { fatal }).decode(bytes);
  if (new TextDecoder(label).encoding !== 'windows-1252') return text;
  return text.replace(/[-]/g, c => CP1252_C1[c.charCodeAt(0) - 0x80]);
}

/** Same order as BeautifulSoup's UnicodeDammit without chardet: BOM, <meta charset>, utf-8, windows-1252. */
export function decodeHtml(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = decode(bytes.subarray(0, 4096), 'windows-1252');
  const meta = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i);
  const tryDecode = label => {
    try { return decode(bytes, label, true); } catch { return null; }
  };
  return (meta && tryDecode(charsetLabel(meta[1]))) ?? tryDecode('utf-8') ?? decode(bytes, 'windows-1252');
}

/** Mails labelled latin-1/ascii are really windows-1252 (smart quotes in 0x80-0x9f). Browsers already do this;
 *  Node's TextDecoder does not, so be explicit to get the same result everywhere. */
function charsetLabel(label) {
  const l = label.toLowerCase();
  return ['iso-8859-1', 'iso8859-1', 'latin1', 'latin-1', 'us-ascii', 'ascii'].includes(l) ? 'windows-1252' : l;
}

/** Unfolded value of the first header `name`, or null. */
function header(headers, name) {
  const unfolded = (headers || '').replace(/\r?\n[ \t]+/g, ' ');
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'im'));
  return m ? m[1] : null;
}

/** RFC 2047 encoded words (=?charset?B|Q?...?=); whitespace between adjacent words is dropped. */
export function decodeRfc2047(s) {
  return s.replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?)/gi, '$1')
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, cs, enc, text) => {
      try {
        let bytes;
        if (enc.toLowerCase() === 'b') {
          bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
        } else {
          const raw = text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
          bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        }
        return decode(bytes, charsetLabel(cs));
      } catch {
        return whole;
      }
    });
}

/** Display name, else address (Python email.utils.parseaddr semantics for the common forms). */
export function parseAddrName(s) {
  s = s.trim();
  const angle = s.match(/^(.*?)\s*<([^<>]*)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
    return name || angle[2].trim();
  }
  const comment = s.match(/^(\S+)\s*\((.*)\)\s*$/);
  if (comment) return comment[2].trim() || comment[1];
  return s.replace(/^"(.*)"$/, '$1');
}

/** Same source order as extract_msg: From header, else PR_SENDER_NAME <PR_SENDER_SMTP_ADDRESS>. */
function senderOf(f) {
  const from = header(f.headers, 'From');
  let raw;
  if (from !== null) raw = decodeRfc2047(from);
  else if (f.senderName) raw = f.senderSmtpAddress ? `${f.senderName} <${f.senderSmtpAddress}>` : f.senderName;
  else raw = f.senderSmtpAddress || '';
  return parseAddrName(raw.replaceAll('\x00', '').replace(/\s+/g, ' '));
}

function sentOf(f) {
  const hdr = header(f.headers, 'Date');
  for (const s of [hdr, f.clientSubmitTime, f.messageDeliveryTime]) {
    const d = s ? new Date(s.replace(/\s*\([^)]*\)\s*$/, '')) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function toMail(fields, reader, domParser) {
  const mail = makeMail({ subject: (fields.subject || '').replaceAll('\x00', '') });
  mail.sender = senderOf(fields);
  mail.sent = sentOf(fields);
  const imp = (fields.rawProps || []).find(p => p.propertyTag === PR_IMPORTANCE);
  mail.highImportance = !!imp && Number(imp.value) === 2;

  let body = (fields.body || '').replaceAll('\x00', '');
  if (!body.trim() && fields.html && fields.html.length) body = htmlToText(decodeHtml(fields.html), domParser);
  else if (!body.trim() && fields.bodyHtml) body = htmlToText(fields.bodyHtml, domParser);
  else if (!body.trim() && fields.compressedRtf) mail.errors.push('body is stored as RTF only; text not extracted');
  mail.text = cleanText(body);

  for (const att of fields.attachments || []) {
    const label = (att.fileName || att.name || '?').replaceAll('\x00', '');
    const lower = label.toLowerCase();
    let isMail = lower.endsWith('.msg') || lower.endsWith('.eml');
    try {
      if (att.innerMsgContent) {
        isMail = true;
        const inner = att.innerMsgContentFields;
        if (!inner || inner.error) throw new Error(inner ? inner.error : 'embedded message is empty');
        mail.children.push(toMail(inner, reader, domParser));
      } else if (lower.endsWith('.msg')) {
        const { content } = reader.getAttachment(att);
        const sub = open(content);
        mail.children.push(toMail(sub.fields, sub.reader, domParser));
      } else if (isMail) {
        mail.errors.push(`attachment '${label}' looks like a mail item but is not a supported .msg (bytes); not processed`);
      }
      // other files: images, documents -> not extracted
    } catch (exc) {
      mail.errors.push(`attachment '${label}' could not be read: ${exc && exc.message ? exc.message : exc}`);
    }
    mail.hadMailAttachments ||= isMail;
  }
  return mail;
}

export function readMsg(bytes, domParser) {
  const { reader, fields } = open(bytes);
  return toMail(fields, reader, domParser);
}
