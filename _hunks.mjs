// Temporary probe: for each hunk of the WIP diffs, check whether its added lines
// are present in the CURRENT working tree. Writes _hunks.txt.
import fs from 'fs';

const norm = (s) => s.replace(/\r\n/g, '\n');
const out = [];
const log = (...a) => out.push(a.join(' '));

const parse = (diffPath) => {
  const files = [];
  if (!fs.existsSync(diffPath)) return files;
  const lines = norm(fs.readFileSync(diffPath, 'utf8')).split('\n');
  let cur = null, hunk = null;
  for (const l of lines) {
    if (l.startsWith('diff --git ')) {
      const m = l.match(/b\/(.+)$/);
      cur = { path: m ? m[1] : '?', hunks: [] };
      files.push(cur);
      hunk = null;
    } else if (l.startsWith('@@')) {
      hunk = { header: l, added: [], removed: [] };
      if (cur) cur.hunks.push(hunk);
    } else if (hunk) {
      if (l.startsWith('+') && !l.startsWith('+++')) hunk.added.push(l.slice(1));
      else if (l.startsWith('-') && !l.startsWith('---')) hunk.removed.push(l.slice(1));
    }
  }
  return files;
};

const check = (diffPath, label) => {
  const files = parse(diffPath);
  log(`############ ${label} (${diffPath}) — ${files.length} file(s)`);
  for (const f of files) {
    let live = '';
    try { live = norm(fs.readFileSync(f.path, 'utf8')); } catch { live = null; }
    log('');
    log(`===== ${f.path} ${live === null ? '(FILE MISSING IN TREE)' : `(${live.split('\n').length} lines live)`} — ${f.hunks.length} hunk(s)`);
    f.hunks.forEach((h, i) => {
      const sig = h.added.filter((a) => a.trim()).map((a) => a.trim());
      const present = sig.filter((a) => live !== null && live.includes(a));
      const missing = sig.filter((a) => live === null || !live.includes(a));
      const status = missing.length === 0 ? 'APPLIED' : (present.length === 0 ? 'MISSING' : 'PARTIAL');
      log(`--- hunk#${i} ${status} (${present.length}/${sig.length} added lines present)  ${h.header}`);
      if (missing.length) {
        log('    first missing: ' + missing.slice(0, 4).map((m) => JSON.stringify(m.slice(0, 110))).join(' | '));
      }
    });
  }
};

check('_wip_src.diff', 'SRC');
check('_wip_tests.diff', 'TESTS');

fs.writeFileSync('_hunks.txt', out.join('\n'), 'utf8');
console.log('wrote _hunks.txt lines', out.length);
