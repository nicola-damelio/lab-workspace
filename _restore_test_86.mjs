/* =========================================================================
   _restore_test_86.mjs — RENDRE « Test 86 » AU PROGRAMME, PAR LE CHEMIN NORMAL.

   Le constat : l'expérience « Test 86 » est SUR le Drive (la lecture du 13/10/2026
   l'a trouvée dans le dossier de son projet, fichier-objet `<expérience>.json`,
   `kind: lab-workspace/object`), mais elle n'est plus dans la liste du dataset —
   et AUCUN code de l'application ne relit les fichiers-objets du Drive (le miroir
   est à sens unique, voir _recover_experiments_scan.mjs). Le seul chemin de retour
   est donc l'import d'une sauvegarde : 📂 Load HTML → page « Expériences » → ➕ AJOUT
   (l'ajout vise le dataset OUVERT et n'efface rien ; une expérience retrouvée lève
   en plus sa suppression locale, `recordExperimentRevivals`).

   Ce script ne fait AUCUNE requête : il travaille sur la reprise déjà écrite et
   validée par l'application le 13/10/2026
   (`_recover/GEC-UPJV-projects_774488_experiences-retrouvees_2026-10-13.json`,
   12 expériences dont « Test 86 »), en extrait la SEULE expérience demandée, et
   écrit à côté un fichier d'import d'UNE LIGNE — plus rien à décocher dans la
   fenêtre, et aucun risque d'ajouter ses voisines par mégarde.

   Usage :
     node _restore_test_86.mjs                    (l'expérience « Test 86 »)
     node _restore_test_86.mjs --name=Test 86     (un autre nom, si besoin)
     node _restore_test_86.mjs --list             (ce que la reprise porte, et rien d'autre)
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const WANT = String(args.get('name') || 'Test 86').trim();
const SOURCE = String(args.get('from') || '_recover/GEC-UPJV-projects_774488_experiences-retrouvees_2026-10-13.json');

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const text = readFileSync(SOURCE, 'utf8');
const read = B.parseBackupText(text);
if (!read.ok) { say(`✖ la reprise « ${SOURCE} » n’est pas relisible : ${read.reason}`); process.exit(1); }
const state = read.state || {};
const tests = Array.isArray(state.tests) ? state.tests : [];
say(`# Reprise lue : ${SOURCE}`);
say(`   ${tests.length} expérience(s) · dataset ${state.datasetId || '—'} · « ${state.datasetTitle || ''} »`);
tests.forEach((t) => {
  const p = (Array.isArray(t.projectNames) ? t.projectNames : []).filter(Boolean);
  say(`   • « ${t.name} »  id=${t.id}  instance ${t.instanceName || '—'}  ${t.testCategory || ''}`
    + `  projet(s) ${p.join(', ') || '—'}  enregistrée ${t.savedAt || ''}`);
});
if (args.has('list')) process.exit(0);

const hits = tests.filter((t) => String(t.name || '').trim() === WANT);
if (!hits.length) { say(`\n✖ aucune expérience « ${WANT} » dans cette reprise (voir --list).`); process.exit(1); }
/* La génération la plus RÉCENTE fait foi si le même nom apparaît deux fois (deux
   instances, ou un renommage) : c’est la règle de _recover_experiments.mjs. */
const chosen = hits.slice().sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))[0];
say(`\n## L’expérience retenue : « ${chosen.name} »`);
say(`   id ${chosen.id} · instance ${chosen.instanceName || '—'} · catégorie ${chosen.testCategory || '—'}`
  + ` · projet(s) ${(chosen.projectNames || []).filter(Boolean).join(', ') || '—'}`);
say(`   enregistrée ${chosen.savedAt || ''}${hits.length > 1 ? `  ⚠ ${hits.length} homonymes, la plus récente est prise` : ''}`);

const built = {
  datasetTitle: state.datasetTitle || 'Untitled Dataset',
  datasetSubtitle: state.datasetSubtitle || '',
  tests: [chosen],
};
const doc = B.buildBackupDocument({
  payload: B.encodeBackupPayload(built, true),
  title: built.datasetTitle,
  subtitle: `${chosen.name} — 1 expérience retrouvée dans les fichiers-objets du Drive (id ${chosen.id})`,
  datasetId: state.datasetId || '',
  savedAt: Date.now(),
  counts: null,
  compressed: true,
});
const fileText = B.backupDocumentText(doc);
const safe = String(chosen.name).replace(/[^\w.-]+/g, '_');
const outPath = path.join('_recover', `RESTORE-${safe}_${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(outPath, fileText, 'utf8');

const verdict = B.parseBackupText(fileText);
const back = (verdict.state && Array.isArray(verdict.state.tests)) ? verdict.state.tests : [];
say('\n## Le fichier écrit (LOCAL — rien n’a été écrit sur le Drive)');
say(`   ${outPath}  (${Math.round(Buffer.byteLength(fileText, 'utf8') / 1024)} Ko)`);
say(`   comptes déclarés : ${JSON.stringify(doc.counts)}`);
say(`   ${verdict.ok ? '✔ VALIDÉ par le validateur de l’application' : `✖ REFUSÉ : ${verdict.reason}`}`);
say(`   relecture : ${back.length} expérience(s) — ${back.map((t) => `« ${t.name} » (id ${t.id})`).join(', ')}`);
say(`   id conservé : ${back.length === 1 && String(back[0].id) === String(chosen.id) ? 'oui' : 'NON'}`);

say('\n## Le geste, dans l’application');
say(`   1. ouvrir le dataset « ${built.datasetTitle} » (celui qui a perdu l’expérience) ;`);
say(`   2. 📂 Load HTML → ${path.basename(outPath)}  (dossier _recover/) ;`);
say('   3. cocher la page « Expériences » seulement — une seule ligne, déjà cochée ;');
say('   4. valider avec ➕ AJOUT (Add), jamais ♻️ REMPLACEMENT.');
say('   → l’expérience revient avec son id d’origine, et sa suppression locale est levée ;');
say('     le dossier de son projet sur le Drive la reconnaît donc à nouveau.');

writeFileSync(path.join('_recover', `HOW-TO_restaurer-${safe}.txt`), `${lines.join('\n')}\n`, 'utf8');
say(`\n   (ce mode d’emploi : _recover/HOW-TO_restaurer-${safe}.txt)`);
