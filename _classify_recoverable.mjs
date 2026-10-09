/* _classify_recoverable.mjs — LECTURE SEULE (aucun accès réseau).
   Rend LISIBLE (UTF-8, une ligne par objet) les 13 fichiers-objets VIVANTS que la
   copie du dataset ne porte plus : nom de l'objet, nombre de générations, et les
   traits qui disent si c'est une VRAIE expérience (un essai avec son instance, sa
   catégorie, ses mesures) ou un ARTEFACT de page (une section nommée « pdb »).

   Usage : node _classify_recoverable.mjs */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = '_recover/recoverable_experiments.json';
const OUT = '_recover/classification.txt';
const lines = [];
const say = (s = '') => lines.push(String(s));

if (!existsSync(SRC)) {
  say(`⚠ ${SRC} absent`);
  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  process.exit(0);
}
const data = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = Array.isArray(data.recoverable) ? data.recoverable : [];
const cut = (v, n = 46) => {
  const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

say(`# Les ${rows.length} fichiers-objets VIVANTS absents de la copie du dataset`);
say(`copie : ${data.copy && data.copy.file}  id=${data.copy && data.copy.datasetId}`
  + `  (${data.copy && data.copy.entries} entrées / ${data.copy && data.copy.experiments} noms)`);
say(`« Test 84 » : copie=${(data.copyNames || []).includes('Test 84')}`
  + `  drive=${(data.driveNames || []).includes('Test 84')}  → absent des deux (seule copie : corbeille, non restaurée)\n`);

/* Un essai RÉEL porte une instance et une catégorie de test : c'est la marque de
   la fabrique (`makeTest`), absente d'une simple section de page. */
const looksReal = (d) => !!(d && (d.instanceName || d.testCategory || d.bestMeasurement || d.storageIndex !== undefined));
const known = (d) => ['moleculeName', 'concentration', 'temperature', 'ratio', 'compound']
  .filter((k) => d && d[k] !== undefined).length;

say('nom de l\'objet        gén.  id de l\'expérience      instance     catégorie      projet           clés  essai?');
say('─'.repeat(112));
const real = [];
const odd = [];
rows.forEach((r) => {
  const d = (r.object && r.object.data) || {};
  const realOne = looksReal(d);
  (realOne ? real : odd).push(r.name);
  say(`${cut(r.name, 20).padEnd(21)} ${String(r.generations).padStart(4)}  ${cut(r.object && r.object.id, 22).padEnd(22)}`
    + ` ${cut(d.instanceName, 12).padEnd(12)} ${cut(d.testCategory, 14).padEnd(14)}`
    + ` ${cut((d.projectNames || []).join(','), 15).padEnd(15)} ${String(Object.keys(d).length).padStart(4)}  ${realOne ? 'OUI' : '??'}`);
});

say(`\n## Verdict`);
say(`   • ${real.length} essai(s) RÉEL(S) : ${real.join(' | ')}`);
if (odd.length) say(`   • ${odd.length} à examiner (pas d'instance ni de catégorie — artefact de page ?) : ${odd.join(' | ')}`);
say(`\n   rappel : « Test 84 » n'est PAS dans cette liste — sa seule copie est à la corbeille,`);
say(`   et la corbeille ne se restaure pas.`);

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`→ ${OUT}`);
