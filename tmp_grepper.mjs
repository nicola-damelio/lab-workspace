/* Grep paramétrable, sortie TOUJOURS en UTF-8 dans un fichier (la console
   PowerShell abîme les accents et les redirections écrivent en UTF-16).
   Usage : node tmp_grepper.mjs <motif> <fichier|dossier...> [--out=nom] [--ctx=n]
   Un dossier est parcouru récursivement (extensions de code seulement).
   TEMPORAIRE. */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';

const CODE = /\.(js|jsx|mjs|cjs|ts|tsx|md|json|css)$/i;
const SKIP = /(node_modules|\.git|dist|^_|\\_)/;

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const outName = (flags.find((f) => f.startsWith('--out=')) || '--out=tmp_grep_out.txt').slice(6);
const ctx = Number((flags.find((f) => f.startsWith('--ctx=')) || '--ctx=0').slice(6));
const [pattern, ...roots] = positional;

const walk = (p) => {
  let s;
  try { s = statSync(p); } catch { return []; }
  if (s.isFile()) return [p];
  if (!s.isDirectory()) return [];
  const out = [];
  for (const e of readdirSync(p)) {
    const child = `${p}/${e}`;
    if (SKIP.test(child)) continue;
    const cs = statSync(child);
    if (cs.isDirectory()) out.push(...walk(child));
    else if (CODE.test(child)) out.push(child);
  }
  return out;
};

const files = roots.flatMap(walk);
const re = new RegExp(pattern, 'i');
const out = [`motif : ${pattern}`, `fichiers examinés : ${files.length}`, ''];
let total = 0;
for (const f of files) {
  let lines;
  try { lines = readFileSync(f, 'utf8').split(/\r?\n/); } catch (e) { out.push(`!! ${f} : ${e.message}`); continue; }
  let hit = 0;
  lines.forEach((l, i) => {
    if (re.test(l)) {
      hit += 1;
      total += 1;
      out.push(`${f}:${i + 1}: ${l.trim().slice(0, 190)}`);
      for (let k = 1; k <= ctx; k += 1) if (lines[i + k] !== undefined) out.push(`${f}:${i + k + 1}:    | ${lines[i + k].trim().slice(0, 190)}`);
    }
  });
  if (hit) out.push(`-- ${f} : ${hit} ligne(s) sur ${lines.length}`);
}
out.splice(2, 0, `lignes retenues : ${total}`);
writeFileSync(outName, out.join('\n'), 'utf8');
console.log(`${outName} écrit (${out.length} lignes, ${total} retenues)`);
