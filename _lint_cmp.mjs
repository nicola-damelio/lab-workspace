/* Compare oxlint diagnostics between the committed NMRSections.jsx (_base_nmr.jsx)
   and the working copy — by RULE + MESSAGE (line numbers shift when code is added). */
import { execFileSync } from 'node:child_process';

const lint = (target) => {
  let out = '';
  try {
    out = execFileSync('npx', ['oxlint', target], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const entries = [];
  let last = null;
  for (const raw of String(out).split(/\r?\n/)) {
    const head = raw.match(/^\s+([!x])\s+(\S+):\s*(.*)$/);
    if (head) {
      last = { sev: head[1], rule: head[2], msg: head[3].trim(), at: '' };
      entries.push(last);
      continue;
    }
    const loc = raw.match(/,-\[([^\]]+)\]/);
    if (loc && last && !last.at) last.at = loc[1];
  }
  return { out, entries };
};

const keyOf = (e) => `${e.rule} | ${e.msg}`;
const tally = (entries) => {
  const map = new Map();
  for (const e of entries) map.set(keyOf(e), (map.get(keyOf(e)) || 0) + 1);
  return map;
};

const base = lint('_base_nmr.jsx');
const cur = lint('src/components/NMRSections.jsx');
const tb = tally(base.entries);
const tc = tally(cur.entries);

const lines = [];
lines.push(`base diagnostics: ${base.entries.length} | current diagnostics: ${cur.entries.length}`);
lines.push(base.out.match(/Found .*/)?.[0] || '(base summary not found)');
lines.push(cur.out.match(/Found .*/)?.[0] || '(current summary not found)');
lines.push(`base errors: ${base.entries.filter((e) => e.sev === 'x').length} | current errors: ${cur.entries.filter((e) => e.sev === 'x').length}`);
lines.push('');
lines.push('--- WARNINGS PRESENT IN CURRENT BUT NOT IN BASE ---');
let added = 0;
for (const [k, n] of tc) {
  const prev = tb.get(k) || 0;
  if (n > prev) {
    added += n - prev;
    lines.push(`+${n - prev}  ${k}   [${cur.entries.filter((e) => keyOf(e) === k).map((e) => e.at).join(', ')}]`);
  }
}
if (!added) lines.push('(none)');
lines.push('');
lines.push('--- WARNINGS PRESENT IN BASE BUT NOT IN CURRENT ---');
let gone = 0;
for (const [k, n] of tb) {
  const now = tc.get(k) || 0;
  if (now < n) { gone += n - now; lines.push(`-${n - now}  ${k}`); }
}
if (!gone) lines.push('(none)');

console.log(lines.join('\n'));
