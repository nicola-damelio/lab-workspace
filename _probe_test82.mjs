/* =========================================================================
   _probe_test82.mjs — LECTURE SEULE, LOCAL. Que dit le Drive de « Test 82 »
   (id t17912925988435618) — l'expérience que la copie du dataset donne SANS
   projet, et qu'aucun projet ne liste ?

   On lit le recensement LOCAL déjà téléchargé (_recover/found2.json, écrit par
   _recover_experiments_scan.mjs) : aucun accès Drive, aucune corbeille.
   ========================================================================= */
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const ID = 't17912925988435618';
const OUT = '_recover_test82.txt';
const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const found = JSON.parse(readFileSync('_recover/found2.json', 'utf8'));
const exps = Array.isArray(found.experiments) ? found.experiments : [];
say(`found2.json : ${exps.length} fichier(s)-objet(s) recensés · lu le ${String(found.at || '').slice(0, 19)}`);

const hits = exps.filter((e) => JSON.stringify(e).includes(ID));
say(`\n═══ « Test 82 » sur le Drive : ${hits.length} fichier(s) ═══`);
hits.forEach((h) => {
  const o = h.object || {};
  const pn = Array.isArray(o.projectNames) ? o.projectNames : null;
  say(`\n• fichier : ${h.file}  id=${h.id}`);
  say(`  dossier  : ${h.path || h.parentPath || h.folder || '—'}`);
  say(`  nom      : « ${o.name || h.name || '—'} »  instance=${o.instanceName || '—'}  type=${o.type || '—'}  catégorie=${o.testCategory || '—'}`);
  say(`  savedAt  : ${String(h.savedAt || o.savedAt || '').slice(0, 19)}`);
  say(`  projectNames : ${pn ? JSON.stringify(pn) : 'ABSENT'}`);
  say(`  créé/modifié : ${String(h.createdTime || '').slice(0, 19)} / ${String(h.modifiedTime || '').slice(0, 19)}`);
  say(`  clés de l'objet : ${Object.keys(o).slice(0, 18).join(', ')}`);
  /* La charge UTILE (l'expérience elle-même) est dans `object.data`. */
  const d = (o.data && typeof o.data === 'object' ? o.data : null);
  if (d) {
    const dpn = Array.isArray(d.projectNames) ? d.projectNames : null;
    say(`  — l'expérience portée (object.data) : « ${d.name || '—'} »  id=${d.id || '—'}  type=${d.type || '—'}`);
    say(`    projectNames : ${dpn ? JSON.stringify(dpn) : `ABSENT (clé présente : ${'projectNames' in d})`}`);
  }
});

/* Le dossier du Drive, en clair : `projects/<projet>/<expérience>/…` ou le bac
   des expériences sans projet (`projects/test/…`). */
say('\n═══ ce que le CHEMIN du Drive dit ═══');
hits.forEach((h) => {
  const p = String(h.path || '');
  const m = /projects[\\/]([^\\/]+)[\\/]([^\\/]+)/.exec(p);
  say(`  ${h.file}  →  projet du chemin : ${m ? `« ${m[1]} »  ·  expérience : « ${m[2]} »` : '(pas de projets/… dans le chemin)'}`);
});

/* Et la copie du dataset : rappel du verdict. */
say('\n═══ verdict de la copie du dataset (ds_ds_1788383774488.json) ═══');
say('  « Test 82 »  id=t17912925988435618  type=flow_cytometry  projectNames=[]');
say('  aucun projet du dataset ne le liste (projects[].experiments[] sans cet id)');

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
say(`\n→ ${OUT}`);
