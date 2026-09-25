/* sonde jetable : le découpage nom / prénom et les formes d'auteur */
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);
const A = await import('./src/utils/authorNames.js');

const names = [
  'Smith JA', 'Rossi M', 'Smith, John A.', 'John A. Smith', 'J. A. Smith',
  'Smith, John A., Jr.', 'van der Berg, Jan', 'Jan van der Berg',
  'W.-J. Lu', 'Lu, W.-J.', 'EPPO', 'Müller K', 'Rossi'
];
names.forEach((n) => {
  console.log(n.padEnd(22), JSON.stringify(A.nameParts(n)), '->', A.canonicalName(n));
});
console.log('\n== listes');
[
  'Smith JA, Rossi M',
  'John A. Smith, Maria Rossi',
  'Smith, John A.; Rossi, Maria',
  'Smith, J. A., Rossi, M.',
  'J. A. Smith and M. Rossi',
  'Rossi M, Bianchi A and Smith J, et al.',
  'Rossi, Bianchi A',
  'Smith J, Rossi M, Bianchi A, et al.',
  'Smith, J., Rossi, M., & Bianchi, A.'
].forEach((raw) => {
  console.log(raw.padEnd(42), JSON.stringify(A.splitAuthorNames(raw)), '->', A.normalizeAuthors(raw));
});
console.log('\n== formes');
['Smith JA', 'John A. Smith', 'Smith, John A.', 'EPPO'].forEach((n) => {
  console.log(n.padEnd(16), A.NAME_STYLE_IDS.map((s) => `${s}:${A.formatAuthorName(n, s)}`).join(' | '));
});
console.log('\n== API structurée');
console.log(A.authorsFromParts([{ given: 'John A.', family: 'Smith' }, { given: 'Maria', family: 'Rossi' }]));
console.log(A.authorsFromParts([{ given: 'Jan', family: 'van der Berg' }]));
console.log('familyNameOf:', A.familyNameOf('John A. Smith'), '/', A.familyNameOf('Rossi M'));
