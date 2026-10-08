/* Dump des codes de caractères autour de « unavailable » : est-ce bien une ESPACE
   qui sépare les mots, et pas autre chose (le défaut d'origine était un mot collé).
   Fichier TEMPORAIRE. */
import { readFileSync } from 'node:fs';

const bytes = readFileSync('_workspace_resync_ui_test.mjs', 'utf8');
const idx = [];
let from = 0;
for (;;) {
  const at = bytes.indexOf('unavailable', from);
  if (at < 0) break;
  idx.push(at);
  from = at + 1;
}
for (const at of idx) {
  const slice = bytes.slice(Math.max(0, at - 14), at + 12);
  const codes = [...slice].map((c) => `${c}(${c.codePointAt(0)})`).join(' ');
  const line = bytes.slice(0, at).split('\n').length;
  console.log(`ligne ${line} : ${codes}`);
}
