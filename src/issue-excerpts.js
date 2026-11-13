import { cpSlice, makeMail, splitSegments } from './core.js';

const greeting = /^(?:hi|hello|dear|bonjour|bonsoir|salut)(?:[ \t]+[\p{L}'’-]+){0,3}[,!:]?[ \t]*$/iu;
const closing = /^(?:thanks|thank you|regards|kind regards|best regards|sincerely|cordialement|bien cordialement|merci|bonne journée)[,!.]?[ \t]*$/iu;
const header = /^(?:Subject|Objet|From|De|Sent|Envoyé|Date|To|À|Cc|Importance)\s*:/iu;
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Number original body sentences so the model selects text instead of copying it. */
export function issueCandidates(source) {
  const separator = source.indexOf('\n\n');
  const body = separator < 0 ? source : source.slice(separator + 2);
  const out = [];
  const seen = new Set();
  for (const segment of splitSegments(makeMail({ text: body }))) {
    const lines = [];
    for (const raw of segment.text.split('\n')) {
      const line = raw.trim();
      if (closing.test(line)) break;
      if (!line || greeting.test(line) || header.test(line) || line.startsWith('Attached email context (')) continue;
      lines.push(raw);
    }
    for (const { segment: original } of segmenter.segment(lines.join('\n'))) {
      const text = cpSlice(original.trim(), 0, 320).trimEnd();
      const key = text.normalize('NFC').replace(/\s+/gu, ' ');
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: out.length + 1, text });
    }
  }
  return out;
}

/** Legacy responses may wrap lines differently; keep the words from the source. */
export function matchOriginal(source, text) {
  if (!text) return null;
  const escaped = text.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return source.match(new RegExp(escaped.join('\\s+'), 'u'))?.[0] ?? null;
}
