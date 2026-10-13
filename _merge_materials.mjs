/* =========================================================================
   _merge_materials.mjs — fusionne deux MATIÈRES de reprise en une seule.

   Pourquoi : une expérience peut avoir PLUSIEURS générations de fichier-objet
   sur le Drive (renommages, republications). Le script de reprise
   (`_recover_experiments.mjs`) garde, par `id`, la charge de `savedAt` le plus
   récent — il lui faut donc TOUTES les générations connues, anciennes comprises
   (celles relevées le 2026-10-09 peuvent être plus riches que ce que le Drive
   porte aujourd'hui : une génération intermédiaire a pu partir à la corbeille,
   et la corbeille ne se lit pas).

   Usage :
     node _merge_materials.mjs
     node _merge_materials.mjs --a=_recover/recoverable_new.json --b=_recover/recoverable_experiments.json
   ========================================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const A = String(args.get('a') || '_recover/recoverable_new.json');
const B = String(args.get('b') || '_recover/recoverable_experiments.json');
const OUT = String(args.get('out') || '_recover/recoverable_merged.json');

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const read = (p) => {
  if (!existsSync(p)) { say(`⚠ absent : ${p}`); return []; }
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const rows = Array.isArray(j.recoverable) ? j.recoverable : [];
  say(`   ${p} → ${rows.length} ligne(s)`);
  return rows;
};
say('## Les matières lues');
const a = read(A);
const b = read(B);

const merged = [...b, ...a];                       // l'ordre ne compte pas : l'id décide
const ids = new Map();
merged.forEach((r) => {
  const id = String((r.object && r.object.id) || '');
  if (!id) return;
  const at = String((r.object && r.object.savedAt) || '');
  const cur = ids.get(id);
  if (!cur || at > cur.at) ids.set(id, { id, at, name: String(r.name || ''), keys: Object.keys((r.object && r.object.data) || {}).length });
});

say(`\n## Le résultat : ${ids.size} expérience(s) distincte(s) (par id)`);
[...ids.values()].sort((x, y) => String(y.at).localeCompare(String(x.at))).forEach((e) => {
  say(`   • « ${e.name} »  id=${e.id}  génération retenue ${e.at}  (${e.keys} clés de charge)`);
});

writeFileSync(OUT, `${JSON.stringify({
  at: new Date().toISOString(),
  sources: [A, B],
  recoverable: merged
}, null, 2)}\n`, 'utf8');
say(`\n→ ${OUT}  (${merged.length} ligne(s), ${ids.size} expérience(s))`);
say(`→ suite : node _recover_experiments.mjs --mat=${OUT}`);
