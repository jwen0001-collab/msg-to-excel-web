import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeHtml, decodeRfc2047, parseAddrName } from '../src/readmsg.js';

test('latin-1 labelled html is decoded as windows-1252 (smart quotes)', () => {
  const html = '<meta charset="iso-8859-1">qu\x92\xe0';
  assert.ok(decodeHtml(Uint8Array.from(html, c => c.charCodeAt(0))).endsWith('qu’à'));
});

test('html without charset: utf-8 first, then windows-1252', () => {
  assert.equal(decodeHtml(new TextEncoder().encode('Hélène')), 'Hélène');
  assert.equal(decodeHtml(Uint8Array.from([0x48, 0xe9])), 'Hé');
});

test('rfc 2047 encoded display names', () => {
  assert.equal(decodeRfc2047('=?utf-8?B?SMOpbMOobmU=?= <h@x.fr>'), 'Hélène <h@x.fr>');
  assert.equal(decodeRfc2047('=?iso-8859-1?Q?Dupr=E9_H?= =?iso-8859-1?Q?=E9l=E8ne?= <h@x.fr>'), 'Dupré Hélène <h@x.fr>');
  assert.equal(decodeRfc2047('Plain Name <p@x.fr>'), 'Plain Name <p@x.fr>');
});

test('parseaddr: name, else address', () => {
  assert.equal(parseAddrName('ACME -- SHARED MAILBOX <team@example.com>'), 'ACME -- SHARED MAILBOX');
  assert.equal(parseAddrName('"Martin, Alice" <a@x.fr>'), 'Martin, Alice');
  assert.equal(parseAddrName('<a@x.fr>'), 'a@x.fr');
  assert.equal(parseAddrName('a@x.fr'), 'a@x.fr');
  assert.equal(parseAddrName('a@x.fr (Alice Martin)'), 'Alice Martin');
});
