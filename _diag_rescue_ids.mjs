/* Diagnostic : décoder les fichiers de reprise du dossier _recover pour lire
   les IDS réels des expériences reprises (le payload est compressé LZString). */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import LZString from 'lz-string';

/** Tous les couples (nom d'expérience → id) trouvés dans un document quelconque :
 *  sert à voir si UN MÊME id porte PLUSIEURS noms (les jumeaux de reprise). */
const nameIdPairs = (doc, pairs = []) => {
  if (Array.isArray(doc)) { doc.forEach((d) => nameIdPairs(d, pairs)); return pairs; }
  if (!doc || typeof doc !== 'object') return pairs;
  const name = String(doc.name || '').trim();
  const id = String(doc.id || '').trim();
  if (name && /^t\d+$/.test(id)) pairs.push({ id, name });
  Object.values(doc).forEach((v) => nameIdPairs(v, pairs));
  return pairs;
};

const out = [];
const files = readdirSync('_recover').filter((f) => f.toLowerCase().endsWith('.json'));
for (const f of files) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(`_recover/${f}`, 'utf8')); } catch (err) { out.push(`=== ${f} === (illisible : ${err.message})`); continue; }
  out.push(`=== ${f} ===`);
  out.push(`  datasetId=${doc.datasetId || ''}  savedAt=${doc.savedAt || ''}  counts=${JSON.stringify(doc.counts || {})}`);
  if (Object.prototype.hasOwnProperty.call(doc, 'payload')) {
    try {
      const raw = doc.compressed ? LZString.decompressFromUTF16(doc.payload) : doc.payload;
      const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const tests = Array.isArray(payload && payload.tests) ? payload.tests : [];
      out.push(`  tests (${tests.length}) :`);
      const byId = new Map();
      tests.forEach((t) => {
        out.push(`    id=${t.id}  name=${JSON.stringify(t.name)}  inst=${t.instanceName || ''}  datasetId=${t.datasetId || ''}`);
        const id = String(t.id === undefined ? '' : t.id);
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(String(t.name || ''));
      });
      const shared = Array.from(byId.entries()).filter(([, names]) => new Set(names).size > 1);
      out.push(`  ⚠ ids partagés par PLUSIEURS noms : ${shared.length ? JSON.stringify(shared) : 'aucun'}`);
      out.push(`  deletedExperiments=${JSON.stringify(payload.deletedExperiments || null)}`);
      out.push(`  revivedExperiments=${JSON.stringify(payload.revivedExperiments || null)}`);
    } catch (err) {
      out.push(`  payload non décodable : ${err.message}`);
    }
  } else {
    out.push('  (pas de payload — fichier d’objets/diagnostic)');
    const pairs = nameIdPairs(doc);
    const byId = new Map();
    pairs.forEach((p) => { if (!byId.has(p.id)) byId.set(p.id, new Set()); byId.get(p.id).add(p.name); });
    const shared = Array.from(byId.entries()).filter(([, names]) => names.size > 1);
    out.push(`  couples (nom,id) : ${pairs.length} — ids DISTINCTS : ${byId.size}`);
    out.push(`  ⚠ ids partagés par PLUSIEURS noms : ${shared.length ? shared.map(([id, n]) => `${id} → ${[...n].join(' + ')}`).join(' | ') : 'aucun'}`);
  }
  out.push('');
}
writeFileSync('_diag_rescue_ids.txt', out.join('\n'), 'utf8');
console.log('_diag_rescue_ids.txt écrit — ' + files.length + ' fichier(s) examiné(s)');
if (!existsSync('_diag_rescue_ids.txt')) process.exit(2);
