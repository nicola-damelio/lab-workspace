/* _scan42.mjs — the WIP patch vs the live tree: which hunks mention plates + frames. */
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';

const names = ['_wip_src.diff', '_cur_src.diff', '_wip_tests.diff', '_cur_tests.diff',
  '_verify_wip4.txt', '_check_wip.mjs', '_check_wip2.mjs', '_check_wip3.mjs', '_wipcheck_view.mjs'];
let out = '';
for (const n of names) {
  out += `${existsSync(n) ? String(statSync(n).size).padStart(9) : '   MISSING'}  ${n}\n`;
}

const grepp = (file, re, title) => {
  if (!existsSync(file)) { out += `\n########## ${title}: MISSING ##########\n`; return; }
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  out += `\n########## ${file} :: ${title} (${lines.length} lines) ##########\n`;
  lines.forEach((l, i) => { if (re.test(l)) out += `${i + 1}| ${l.slice(0, 240)}\n`; });
};

for (const f of ['_wip_src.diff', '_cur_src.diff']) {
  grepp(f, /plate|Plate/, 'plates');
  grepp(f, /frame|Frame/, 'frames');
  grepp(f, /^@@/, 'hunk headers');
  grepp(f, /^\+\+\+ |^--- /, 'files touched');
}
writeFileSync('_live_scan42.txt', out);
console.log('_live_scan42.txt written');
