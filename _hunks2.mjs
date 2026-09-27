// Temporary probe (v2): repair CP437-mojibake in the WIP diffs, then check each
// hunk's added lines against the CURRENT working tree. Writes _hunks2.txt.
import fs from 'fs';

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';
const rev = new Map();
for (let i = 0; i < CP437.length; i++) rev.set(CP437[i], 0x80 + i);

const repair = (s) => {
  const bytes = [];
  for (const ch of s) {
    const b = rev.get(ch);
    if (b !== undefined) bytes.push(b);
    else {
      const c = ch.codePointAt(0);
      if (c < 0x80) bytes.push(c);
      else { bytes.push(0x3f); } // '?'
    }
  }
  try { return Buffer.from(bytes).toString('utf8'); } catch { return s; }
};

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
      cur = { path: m ? m[1].trim() : '?', hunks: [] };
      files.push(cur); hunk = null;
    } else if (l.startsWith('@@')) {
      hunk = { header: l, added: [], removed: [] };
      if (cur) cur.hunks.push(hunk);
    } else if (hunk) {
      if (l.startsWith('+') && !l.startsWith('+++')) hunk.added.push(repair(l.slice(1)));
      else if (l.startsWith('-') && !l.startsWith('---')) hunk.removed.push(repair(l.slice(1)));
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
      const sig = h.added.filter((a) => a.trim());
      const present = sig.filter((a) => live !== null && live.includes(a));
      const missing = sig.filter((a) => live === null || !live.includes(a));
      const status = sig.length === 0 ? 'N/A' : (missing.length === 0 ? 'APPLIED' : (present.length === 0 ? 'MISSING' : 'PARTIAL'));
      log(`--- hunk#${i} ${status} (${present.length}/${sig.length})  ${repair(h.header)}`);
      missing.slice(0, 6).forEach((m) => log('    MISS: ' + JSON.stringify(m.slice(0, 130))));
    });
  }
};

check('_wip_src.diff', 'SRC');
check('_wip_tests.diff', 'TESTS');

fs.writeFileSync('_hunks2.txt', out.join('\n'), 'utf8');
console.log('wrote _hunks2.txt lines', out.length);
