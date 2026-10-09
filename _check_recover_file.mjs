/* Contrôle rapide d'un fichier de restauration : les comptes par page et, pour
   chaque page, combien de lignes l'import REMPLACERAIT (identifiants). */
import fs from 'node:fs';
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');

const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const v = B.parseBackupText(raw);
console.log('ok', v.ok, v.reason || '', 'état ?', !!v.state);
const state = v.state || {};
const adm = state.administration || {};
Object.keys(adm).forEach((k) => {
  const val = adm[k];
  if (!Array.isArray(val)) return;
  const ids = val.filter((r) => r && typeof r === 'object' && r.id !== undefined && r.id !== null);
  console.log(`  ${k} : ${val.length} ligne(s) · ${ids.length} avec un id · 1re clé : ${JSON.stringify(Object.keys(val[0] || {}).slice(0, 8))}`);
});
