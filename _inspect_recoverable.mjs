/* Inspection de _recover/recoverable_experiments.json : QUI est chaque objet
   classé « expérience », pour séparer une vraie expérience d'un artefact de
   page (une section nommée « pdb », par exemple). LECTURE SEULE. */
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('_recover/recoverable_experiments.json', 'utf8'));
const cut = (v, n = 60) => {
  const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
console.log(`copie : ${data.copy.file}  id=${data.copy.datasetId}  ${data.copy.entries} entrées / ${data.copy.experiments} noms\n`);
console.log(`copyNames (${data.copyNames.length}) : ${data.copyNames.join(' | ')}\n`);
console.log(`driveNames (${data.driveNames.length}) : ${data.driveNames.join(' | ')}\n`);
console.log(`« Test 84 » : copie=${data.copyNames.includes('Test 84')}  drive=${data.driveNames.includes('Test 84')}\n`);
console.log(`── Les ${data.recoverable.length} objets à récupérer, examinés un par un :`);
data.recoverable.forEach((r, i) => {
  const d = (r.object && r.object.data) || {};
  console.log(`\n${String(i + 1).padStart(2)}. nom de l'objet : "${r.name}"   generations=${r.generations}`);
  console.log(`    object.id=${r.object.id}  data.name="${cut(d.name)}"  data.id=${d.id}`);
  console.log(`    clés de data (${Object.keys(d).length}) : ${Object.keys(d).slice(0, 18).join(', ')}`);
  console.log(`    projectNames=${JSON.stringify(d.projectNames || d.projects || '')}  instanceName="${cut(d.instanceName || d.instance)}"  section="${cut(d.section || d.pageSection, 30)}"  condition=${cut(d.condition ?? d.cond, 20)}`);
  console.log(`    textes : comments=${cut(d.comments, 40)} | notes=${cut(d.notes, 40)} | name.txt=${cut(d.instanceLabel || d.label, 30)}`);
});
