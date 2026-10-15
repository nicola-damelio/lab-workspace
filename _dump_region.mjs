/* Outil de travail : extrait des tranches de fichiers dans _dump/ pour lecture sûre. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('_dump', { recursive: true });

const dump = (file, from, to, out) => {
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const slice = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
  writeFileSync(out, slice, 'utf8');
  console.log(`${out}  (${from}-${to}) lignes=${Math.min(to, lines.length) - from + 1}`);
};

const [, , file, from, to, out] = process.argv;
dump(file, Number(from), Number(to), out);
