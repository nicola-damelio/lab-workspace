/* =========================================================================
   _md_analysis_cache_test.mjs — les graphes MD calculés et leur CACHE.

   Ce qui est vérifié ici est ce qui doit rester vrai (domanda 2) :

     • un calcul (RMSD / RMSF / Rg / SASA) est CONSERVÉ avec le test, borné pour
       tenir dans la fiche (pas de re-calcul à chaque visite de la page) ;
     • la série d'énergie (.xvg chargé à part) SURVIT à un recalcul des courbes
       de la trajectoire ;
     • une empreinte (nom + taille + date de la trajectoire) est mémorisée : si
       la trajectoire chargée n'est plus la même, le cache est PÉRIMÉ et le
       message le dit — mais une empreinte inconnue n'inquiète personne ;
     • une copie locale (localStorage) sert d'affichage instantané, et un
       résultat vide laisse le cache VIDE au lieu d'y laisser un objet bancal ;
     • la page MD utilise bien ce cache : restauration locale, écriture après
       calcul, bouton 🔁 Recalculate et bouton 🗑 Clear.

   Le VRAI module est importé : src/utils/mdAnalysisCache.js (aucun faux Drive,
   aucun React : l'utilitaire est pur).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const CACHE = await import('./src/utils/mdAnalysisCache.js');

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
};
// Bornage factice : on garde les N premières valeurs (le vrai « downsample »
// vit dans MDSections.jsx, injecté ici pour rester testable).
const keep = (n) => (arr) => arr.slice(0, n);
const series = (n) => Array.from({ length: n }, (_, i) => ({ time: i, value: i }));

/* ── 1. L'empreinte de la trajectoire ─────────────────────────────────────── */
eq(CACHE.mdTrajectoryFingerprint(null), '', 'sans fichier : pas d’empreinte');
eq(CACHE.mdTrajectoryFingerprint({}), '', 'un fichier sans nom n’a pas d’empreinte');
eq(CACHE.mdTrajectoryFingerprint({ name: 'run.xtc', size: 1000, lastModified: 42 }), 'run.xtc|1000|42',
  'l’empreinte = nom | taille | date');
eq(CACHE.mdTrajectoryFingerprint({ name: 'run.xtc', size: 1000 }) !== CACHE.mdTrajectoryFingerprint({ name: 'run.xtc', size: 2000 }),
  true, 'deux fichiers différents ont deux empreintes différentes');

/* ── 2. Dates lisibles ────────────────────────────────────────────────────── */
eq(CACHE.formatSavedAt(''), '', 'pas de date : rien à afficher');
eq(CACHE.formatSavedAt('n’importe quoi'), '', 'une date illisible ne casse pas l’affichage');
eq(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(CACHE.formatSavedAt('2026-09-20T14:03:00')), true,
  'une date ISO s’affiche en jj/mm/aaaa hh:mm');

/* ── 3. Un cache exploitable ──────────────────────────────────────────────── */
eq(CACHE.hasAnalysisData(null), false, 'rien n’est pas un cache');
eq(CACHE.hasAnalysisData({}), false, 'un objet vide n’est pas un cache');
eq(CACHE.hasAnalysisData({ rmsd: [], sasa: [] }), false, 'des séries vides ne sont pas un cache');

/* ── 4. La copie enregistrée avec le test ─────────────────────────────────── */
const fresh = {
  rmsd: series(500), rmsf: [{ residue: 1, value: 0.1 }], rg: series(500), sasa: series(500),
  nFrames: 500, source: 'run.xtc'
};
const prev = { energy: [{ time: 0, potential: -1 }], energyFileName: 'energy.xvg' };
const payload = CACHE.buildAnalysisCachePayload(fresh, {
  prev, fingerprint: 'run.xtc|1000|42', stride: 10, maxFrames: 500, savedAt: '2026-09-20T14:03:00', downsample: keep(100)
});
eq(payload.rmsd.length, 100, 'les courbes sont BORNÉES avant d’être enregistrées');
eq(payload.rg.length, 100, 'la courbe Rg est bornée aussi');
eq(payload.sasa.length, 100, 'la courbe SASA est bornée aussi');
eq(payload.rmsf.length, 1, 'le RMSF par résidu est gardé tel quel');
eq(payload.nFrames, 500, 'le nombre de frames calculées est enregistré');
eq(payload.source, 'run.xtc', 'la source (fichier) est enregistrée');
eq(payload.energy, prev.energy, 'l’énergie (fichier .xvg) est CONSERVÉE lors d’un recalcul des courbes');
eq(payload.energyFileName, 'energy.xvg', 'le nom du fichier d’énergie aussi');
eq(payload.fingerprint, 'run.xtc|1000|42', 'l’empreinte de la trajectoire accompagne le résultat');
eq(payload.stride, 10, 'le stride utilisé est noté (info)');
eq(payload.maxFrames, 500, 'le max frames utilisé est noté (info)');
eq(payload.savedAt, '2026-09-20T14:03:00', 'la date de calcul est enregistrée');
eq(payload.version, CACHE.MD_ANALYSIS_CACHE_VERSION, 'la version du cache est enregistrée');

const empty = CACHE.buildAnalysisCachePayload(null);
eq(empty.rmsd, [], 'un calcul vide ne produit pas de série fantôme');
eq(empty.nFrames, 0, 'un calcul vide affiche 0 frame');
eq(empty.energyFileName, '', 'un calcul vide n’invente pas de fichier d’énergie');

/* ── 5. L'énergie se greffe sans toucher au reste ─────────────────────────── */
const withEnergy = CACHE.mergeEnergyIntoAnalysis(payload, [{ time: 1, potential: -2 }], {
  fileName: 'run-energy.xvg', savedAt: '2026-09-21T09:00:00', downsample: keep(50)
});
eq(withEnergy.rmsd, payload.rmsd, 'ajouter une énergie ne touche PAS les courbes calculées');
eq(withEnergy.nFrames, payload.nFrames, 'ni le nombre de frames');
eq(withEnergy.energy.length, 1, 'la nouvelle énergie est enregistrée');
eq(withEnergy.energyFileName, 'run-energy.xvg', 'le nom du fichier d’énergie est mis à jour');
eq(withEnergy.savedAt, '2026-09-21T09:00:00', 'la date est mise à jour');
const noPrev = CACHE.mergeEnergyIntoAnalysis(null, [{ time: 0 }], { fileName: 'e.xvg' });
eq(noPrev.energy.length, 1, 'une énergie seule (sans courbes) s’enregistre quand même');
eq(noPrev.rmsd, undefined, 'et n’invente pas de courbe RMSD');

/* ── 6. L'état du cache (et la péremption) ────────────────────────────────── */
eq(CACHE.analysisCacheState(null, 'run.xtc|1000|42').present, false, 'sans résultat : pas de cache');
eq(CACHE.analysisCacheState({ rmsd: [] }, 'x').present, false, 'un résultat vide n’est pas un cache');
const state = CACHE.analysisCacheState(payload, 'run.xtc|1000|42');
eq(state.present, true, 'le résultat enregistré est reconnu');
eq(state.stale, false, 'même trajectoire : le cache est valide');
eq(state.frames, 500, 'l’état expose le nombre de frames');
eq(state.source, 'run.xtc', 'l’état expose la source');
eq(CACHE.analysisCacheState(payload, 'autre.xtc|999|1').stale, true,
  'trajectoire différente : le cache est PÉRIMÉ (il faut recalculer)');
eq(CACHE.analysisCacheState(payload, '').stale, false,
  'trajectoire inconnue (non rechargée localement) : on ne déclare rien périmé');
eq(CACHE.analysisCacheState({ rmsd: [{ v: 1 }], nFrames: 3 }, 'autre.xtc|1|1').stale, false,
  'un ancien résultat sans empreinte n’est pas déclaré périmé');

/* ── 7. La ligne affichée ─────────────────────────────────────────────────── */
const txt = CACHE.describeAnalysisCache(state);
ok(txt.includes('500 frames'), 'la bannière dit combien de frames');
ok(txt.includes('run.xtc'), 'la bannière dit de quelle trajectoire');
ok(txt.includes('20/09/2026'), 'la bannière dit quand le calcul a été fait');
eq(/Recalculate/.test(txt), false, 'pas d’alerte quand le cache est valide');
ok(/Recalculate/.test(CACHE.describeAnalysisCache(CACHE.analysisCacheState(payload, 'autre.xtc|9|9'))),
  'la bannière propose de recalculer quand le cache est périmé');
eq(CACHE.describeAnalysisCache(null), '', 'sans cache, aucune bannière');


/* ── 8. La copie locale (affichage instantané) ───────────────────────────── */
const st = fakeStorage();
eq(CACHE.readLocalAnalysis('t1', st), null, 'aucune copie locale au départ');
CACHE.writeLocalAnalysis('t1', payload, st);
eq(st._map.has(CACHE.localAnalysisKey('t1')), true, 'la copie locale est écrite sous lab_md_analysis_<test>');
eq(CACHE.readLocalAnalysis('t1', st).nFrames, 500, 'la copie locale se relit telle quelle');
eq(CACHE.readLocalAnalysis('t1', st).fingerprint, 'run.xtc|1000|42', 'empreinte comprise (péremption détectable hors ligne)');
eq(CACHE.readLocalAnalysis('t2', st), null, 'la copie locale est bien PAR TEST');
CACHE.writeLocalAnalysis('t1', null, st);
eq(st._map.has(CACHE.localAnalysisKey('t1')), false, 'un résultat vide EFFACE la copie locale');
CACHE.writeLocalAnalysis('t1', payload, st);
eq(CACHE.clearLocalAnalysis('t1', st), true, 'le cache local se vide explicitement');
eq(CACHE.readLocalAnalysis('t1', st), null, 'après 🗑, plus rien en local');
eq(CACHE.clearLocalAnalysis('t1', st), true, 'vider deux fois ne casse rien');

const broken = fakeStorage();
broken.setItem(CACHE.localAnalysisKey('t3'), '{pas du JSON');
eq(CACHE.readLocalAnalysis('t3', broken), null, 'une copie locale corrompue est ignorée');
eq(CACHE.readLocalAnalysis('t4', null), null, 'sans storage : pas d’exception (Node / SSR)');
CACHE.writeLocalAnalysis('t4', payload, null);
eq(CACHE.clearLocalAnalysis('t4', null), false, 'sans storage, effacer renvoie false');

/* ── 9. La page MD utilise bien ce cache ─────────────────────────────────── */
const MD = readFileSync(new URL('./src/components/MDSections.jsx', import.meta.url), 'utf8');
ok(/from '\.\.\/utils\/mdAnalysisCache'/.test(MD), 'MDSections importe src/utils/mdAnalysisCache');
ok(/readLocalAnalysis\(activeTest && activeTest\.id\)/.test(MD), 'les graphes sont restaurés depuis la copie locale');
ok(/buildAnalysisCachePayload\(/.test(MD), 'le résultat est enregistré via buildAnalysisCachePayload');
ok(/writeLocalAnalysis\(/.test(MD), 'la copie locale est écrite après chaque calcul');
ok(/clearLocalAnalysis\(/.test(MD), 'la copie locale est effacée par le bouton 🗑');
ok(/analysisCacheState\(/.test(MD), 'la page connaît l’état du cache (périmé ou non)');
ok(/mdTrajectoryFingerprint\(/.test(MD), 'l’empreinte de la trajectoire chargée est calculée');
ok(/🔁 Recalculate/.test(MD), 'un bouton 🔁 Recalculate est disponible');
ok(/🗑 Clear saved analysis/.test(MD), 'un bouton 🗑 Clear saved analysis est disponible');
ok(/mergeEnergyIntoAnalysis\(/.test(MD), 'l’énergie recharge un fichier sans effacer les courbes calculées');
/* ── 10. La copie locale ne prend pas le pas sur la fiche du test ──────────
   Défaut signalé : deux fenêtres montraient des graphes DIFFÉRENTS pour la même
   condition — celle qui avait la copie locale (localStorage) affichait la sienne,
   une fenêtre neuve (navigation privée, autre poste) lisait la fiche du test. */
const older = { rmsd: [{ time: 0, value: 1 }], savedAt: '2026-09-20T10:00:00.000Z' };
const newer = { rmsd: [{ time: 0, value: 2 }], savedAt: '2026-09-20T11:00:00.000Z' };
eq(CACHE.preferAnalysisCopy(older, newer), newer,
  'une fiche du test PLUS RÉCENTE fait foi (un recalcul d’un autre poste se voit ici aussi)');
eq(CACHE.preferAnalysisCopy(newer, older), newer,
  'une copie locale plus récente est gardée (avance d’affichage de cet onglet)');
eq(CACHE.preferAnalysisCopy(older, null), older, 'sans fiche, la copie locale s’affiche');
eq(CACHE.preferAnalysisCopy(null, newer), newer, 'sans copie locale, la fiche s’affiche');
eq(CACHE.preferAnalysisCopy(null, null), null, 'aucune des deux : rien à afficher');
eq(CACHE.preferAnalysisCopy({ rmsd: [] }, newer), newer, 'une copie locale vide ne masque pas la fiche');
eq(CACHE.preferAnalysisCopy(older, { rmsd: [] }), older, 'une fiche vide ne masque pas la copie locale');
ok(/preferAnalysisCopy\(\s*readLocalAnalysis\(activeTest && activeTest\.id\),/.test(MD),
  'la page MD compare les deux copies avant d’afficher les graphes');



/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_md_analysis_cache_test.mjs — ${passed} assertions OK`);

eq(CACHE.hasAnalysisData({ rmsd: [{ v: 1 }] }), true, 'une seule série suffit à afficher un graphe');
