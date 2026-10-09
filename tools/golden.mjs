// Local parity check against the Python tool (never commit real .msg files):
//   node tools/golden.mjs <input.msg> <out.xlsx> <YYYY-MM-DD entry date>
import fs from 'node:fs';
import { DOMParser } from 'linkedom';
import { run } from '../src/run.js';

const [inp, out, entryDate] = process.argv.slice(2);
const { xlsx, report } = await run(fs.readFileSync(inp), { domParser: new DOMParser(), entryDate });
fs.writeFileSync(out, xlsx);
console.log(JSON.stringify(report));
