/* _chk.mjs — vérification jetable : ces rouges sont-ils ANTÉRIEURS à la session ?
   Compare le fichier de travail à sa version HEAD (git show) sur les extraits EXACTS
   que les suites rouges cherchent, et liste les lignes qui portent l'extraît. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = [];
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const head = (p) => execSync(`git show HEAD:${p}`, { maxBuffer: 1 << 30 }).toString().replace(/\r\n/g, '\n');
const count = (s, n) => s.split(n).length - 1;
const lines = (s, n) => s.split('\n').map((l, i) => (l.includes(n) ? i + 1 : 0)).filter(Boolean);

const cmp = (file, needle, label) => {
  let cur = '';
  let old = null;
  try { cur = read(file); } catch { }
  try { old = head(file); } catch { }
  out.push(`── ${label}   [${file}]`);
  out.push(`   extrait     : ${needle}`);
  out.push(`   ACTUEL  : ${count(cur, needle)}${count(cur, needle) ? '  (lignes ' + lines(cur, needle).join(', ') + ')' : ''}`);
  out.push(`   HEAD    : ${old === null ? '(git show impossible)' : count(old, needle) + (count(old, needle) ? '  (lignes ' + lines(old, needle).join(', ') + ')' : '')}`);
};

cmp('src/components/NMRSections.jsx', '<textarea value={d.rawSequence}', 'cysteine : la case de séquence du polymère');
cmp('src/components/NMRSections.jsx', ') : d.isPolymer ? (', 'cysteine : ouverture de la branche polymère');
cmp('src/components/NMRSections.jsx', ') : d.moleculeType === \'sugar\' ? (', 'cysteine : fin de la branche polymère');
cmp('src/components/SequenceReadingLine.jsx', 'const resolved = useMemo(', 'sequence_charge : la lecture mémorisée');

/* Les lignes de SequenceReadingLine qui portent un useMemo : ce que le test cherche vraiment. */
try {
  const rd = read('src/components/SequenceReadingLine.jsx');
  out.push(`── SequenceReadingLine.jsx — lignes « useMemo » : ${lines(rd, 'useMemo').join(', ') || '(aucune)'}`);
  for (const l of rd.split('\n').map((t, i) => ({ t, i: i + 1 })).filter((x) => x.t.includes('useMemo')).slice(0, 8)) {
    out.push(`   ${l.i}| ${l.t.trim().slice(0, 120)}`);
  }
} catch (e) { out.push('   (SequenceReadingLine.jsx illisible : ' + e.message + ')'); }

/* Les rouges connus pour antérieurs : les suites qui littéralisent l'ancienne valeur du texte. */
const files = readdirSync('.').filter((f) => f.endsWith('_test.mjs') || f.endsWith('_test.cjs'));
const hits = [];
for (const f of files) {
  const s = read(f);
  for (const n of ['structureTextExt="pdb"', "structureTextExt='pdb'", 'structureTextExt={']) {
    if (s.includes(n)) hits.push(`${f} :: ${n}`);
  }
}
out.push('── suites qui littéralisent structureTextExt :');
out.push(hits.length ? hits.map((h) => '   ' + h).join('\n') : '   (aucune)');

out.push('── git diff --stat :');
out.push(execSync('git diff --stat', { maxBuffer: 1 << 30 }).toString().trim().split('\n').map((l) => '   ' + l).join('\n'));

writeFileSync('_chk_out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
