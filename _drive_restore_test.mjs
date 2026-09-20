/* =========================================================================
   _drive_restore_test.mjs — RESTAURER SANS RIEN DEMANDER (mécanisme général).

   Le défaut visé : une donnée lourde (spectre, trajectoire, événements FCS…)
   n'existe QUE dans la cache du navigateur qui l'a importée. Changer de poste
   (ou vider la cache) équivaut alors à perdre les données.

   Le mécanisme général (src/utils/driveRestore.js + useDriveAutoRestore.js)
   fait du CLOUD la copie de référence :
     1. à la création, la donnée est archivée en JSON gzip dans le dossier
        canonique de l'expérience, et le test ne garde qu'un pointeur ;
     2. à l'ouverture de la page, une donnée manquante (absente, vidée par
        compressDatasetForSave, ou sans sa copie plein format) est re-téléchargée
        TOUTE SEULE — même sur un poste où ni la cache ni le registre local
        n'existent (recherche par NOM).

   Vérifié ici : la logique pure, le cycle archivage → restauration sur un FAUX
   Drive (y compris un fichier mis à la corbeille et un pointeur périmé), et le
   câblage des modules branchés : NMR 1D (le cas réel signalé), ssNMR (colonnes
   de spectres solides), CD (Jasco), docking (textes PDB) et microscopie — ce
   dernier avec une différence de nature : la copie de référence d'un média est
   le FICHIER déposé, pas une archive JSON.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

register('./_esm_test_hook.mjs', import.meta.url);

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

/* ── un FAUX Drive : tout ce que la restauration peut atteindre ──────────── */
const uploads = [];
const untrashed = [];
const MOCKS = {
  driveToken: 'fake-token',
  cloud: true,
  uploadLocalFile: async (arg) => {
    uploads.push(arg);
    return { id: 'RID1', name: arg.name, driveUrl: 'https://drive.google.com/file/d/RID1/view' };
  },
  getDriveFileRegistry: () => globalThis.__fakeRegistry || {},
  untrashDriveFile: async (id) => { untrashed.push(id); return true; },
  driveFetch: async (path) => {
    // Recherche par nom : un fichier de l'AUTRE condition, mis à la corbeille.
    if (String(path).startsWith('/drive/v3/files?')) {
      const q = decodeURIComponent(String(path)).toLowerCase();
      // Un MÉDIA (vidéo de microscopie) : retrouvé par son nom, sans registre.
      if (q.includes('microscopy_p53_annexin')) {
        return {
          ok: true,
          json: async () => ({ files: [
            { id: 'VID1', name: 'microscopy_p53_Annexin_1c0j8o0.mp4', trashed: false },
            { id: 'VID_AUTRE', name: 'microscopy_autre_chose.mp4', trashed: false }
          ] })
        };
      }
      return {
        ok: true,
        json: async () => ({ files: [
          { id: 'SEARCH1', name: 'Sample_1_nmr1d_restore.json.gz', trashed: true },
          { id: 'AUTRE', name: 'Autre_chose_nmr1d_restore.json.gz', trashed: false },
          { id: 'RAW', name: 'Sample_1.fid', trashed: false }
        ] })
      };
    }
    const media = await MOCKS.mediaBlob(path);
    return media ? { ok: true, blob: async () => media } : { ok: false, status: 404, blob: async () => new Blob([]) };
  },
  // Par défaut : seule la copie de « Sample_1 » est téléchargeable (le pointeur
  // mort RID_DEAD et le fichier d'une autre condition répondent 404).
  mediaBlob: async (path) => {
    // Le fichier d'une vidéo de microscopie : des OCTETS, pas un JSON.
    if (path.includes('/files/VID1?alt=media')) {
      return new Blob([strToU8('fake-mp4-bytes')], { type: 'video/mp4' });
    }
    if (!path.includes('/files/SEARCH1?alt=media')) return null;
    const body = JSON.stringify({ kind: 'nmr1d', version: 1, spectrum: { xs: [1, 2], ys: [3, 4], title: 'Imported 1r' } });
    return new Blob([gzipSync(strToU8(body))], { type: 'application/gzip' });
  }
};
globalThis.__driveTestMocks = MOCKS;
globalThis.__fakeRegistry = {};

const RESTORE = await import('./src/utils/driveRestore.js');
const NMRSRC = readFileSync('src/components/NMRSections.jsx', 'utf8');
const HOOKSRC = readFileSync('src/components/useDriveAutoRestore.js', 'utf8');
const FLOWSRC = readFileSync('src/components/FlowCytometrySections.jsx', 'utf8');

/* ══ 1. LA LOGIQUE PURE ════════════════════════════════════════════════════ */

/* Le marqueur de compressDatasetForSave veut dire « la donnée n'est plus là » :
   le laisser en place casserait le rendu (atob() sur du texte, .xs sur une
   chaîne). C'est le signal de départ de toute restauration. */
ok(RESTORE.isOmittedValue('[nmr1dSpectrum omitted — kept in browser cache / Drive or re-uploadable]'),
  'le marqueur « […] omitted » est reconnu');
ok(RESTORE.isOmittedValue('[structureFileData omitted]'), '…quelle que soit la clé concernée');
ok(!RESTORE.isOmittedValue('Imported 1r'), 'un vrai titre de spectre n’est PAS un marqueur');
ok(!RESTORE.isOmittedValue(null), 'null n’est pas un marqueur (c’est « absent »)');

const MISSING = [undefined, null, '', [], {}, '[x omitted]'];
MISSING.forEach((v) => ok(RESTORE.isMissingValue(v), `est « manquant » : ${JSON.stringify(v)}`));
ok(!RESTORE.isMissingValue({ xs: [1] }), 'un objet de données n’est pas « manquant »');

ok(RESTORE.isMissingColumns(undefined), 'aucune colonne de spectre ⇒ manquant');
ok(RESTORE.isMissingColumns([]), 'un tableau vide de colonnes ⇒ manquant');
ok(RESTORE.isMissingColumns([{ data: '' }]), 'une seule colonne vidée ⇒ manquant');
ok(!RESTORE.isMissingColumns([{ data: '1\n2' }]), 'des colonnes pleines ⇒ présent');
ok(RESTORE.isMissingColumns('[spectraColumns omitted — kept in browser cache]'),
  'la section de spectres remplacée par un marqueur ⇒ manquant');

/* Le nom du fichier de restauration est DÉTERMINISTE : c'est lui qui permet de
   retrouver la copie de référence sur un poste vierge (ni cache, ni registre). */
eq(RESTORE.fileStem('Sample_1_nmr1d_restore.json.gz'), 'Sample_1_nmr1d_restore',
  'le « stem » d’un nom de fichier ignore .json.gz');
eq(RESTORE.restoreFileName({ stem: 'Sample 1', kind: 'nmr1d' }), 'Sample_1_nmr1d_restore.json.gz',
  'le nom archive le nom DÉCLARÉ de l’instance (espaces → _)');
eq(RESTORE.restoreNameStem({ stem: 'Sample 1', kind: 'nmr1d' }), 'Sample_1_nmr1d_restore',
  'le préfixe attendu');
ok(RESTORE.isRestoreFileName('Sample_1_nmr1d_restore.json.gz', { stem: 'Sample 1', kind: 'nmr1d' }),
  'le fichier de CE spectre est reconnu');
ok(RESTORE.isRestoreFileName('Sample_1_nmr1d_restore.json', { stem: 'Sample 1', kind: 'nmr1d' }),
  '…et sa variante non compressée aussi');
ok(!RESTORE.isRestoreFileName('Sample_10_nmr1d_restore.json.gz', { stem: 'Sample 1', kind: 'nmr1d' }),
  'le fichier d’une AUTRE instance (Sample_10) n’est pas confondu avec Sample_1');
ok(!RESTORE.isRestoreFileName('Sample_1.fid', { stem: 'Sample 1', kind: 'nmr1d' }),
  'un fichier brut n’est jamais pris pour une copie de restauration');
ok(!RESTORE.isRestoreFileName('Sample_1_ssnmr1d_restore.json.gz', { stem: 'Sample 1', kind: 'nmr1d' }),
  'un autre TYPE de donnée (ssNMR) n’est pas pris pour un spectre 1D');
eq(RESTORE.restoreStems('Sample 1.1r', 'Sample 1', ''), ['Sample_1'],
  'les « stems » à chercher sont normalisés et dédoublonnés');

/* Le portillon : une tentative PAR EXPÉRIENCE et par session. */
eq(RESTORE.claimRestore('nmr1d', 't1'), true, 'la première tentative est autorisée');
eq(RESTORE.claimRestore('nmr1d', 't1'), false, '…la suivante non (pas de requêtes en boucle)');
eq(RESTORE.claimRestore('nmr1d', 't2'), true, 'une AUTRE expérience a droit à la sienne');
RESTORE.releaseRestore('nmr1d', 't1');
eq(RESTORE.claimRestore('nmr1d', 't1'), true, 'après libération, elle peut réessayer');
RESTORE.forgetRestores();
eq(RESTORE.claimRestore('nmr1d', 't1'), true, 'l’oubli général rouvre toutes les tentatives');

/* Le pointeur d'une archive arrivée APRÈS un changement de page ATTEND sa page :
   l'écrire tout de suite le poserait sur la donnée devenue active (voir
   placeRestorePointer / takePendingRestorePointer dans driveRestore.js). */
const pointerPatches = [];
const patchPointer = (updates) => { pointerPatches.push(updates); };
eq(RESTORE.placeRestorePointer({ field: 'ssnmrDrive', pointer: { id: 'P1' }, key: 't1', activeKey: 't1', patch: patchPointer }), true,
  'page encore affichée ⇒ le pointeur est posé tout de suite');
eq(pointerPatches, [{ ssnmrDrive: { id: 'P1' } }], '…sur la bonne donnée');
eq(RESTORE.takePendingRestorePointer({ field: 'ssnmrDrive', key: 't1' }), null, '…et rien ne reste en attente');
eq(RESTORE.placeRestorePointer({ field: 'ssnmrDrive', pointer: { id: 'P2' }, key: 't2', activeKey: 't1', patch: patchPointer }), false,
  'page changée ⇒ le pointeur ATTEND');
eq(pointerPatches.length, 1, '…rien n’est écrit sur la page devenue active');
eq(RESTORE.takePendingRestorePointer({ field: 'ssnmrDrive', key: 't1' }), null,
  '…et il n’est jamais posé sur la page qui l’a remplacée');
eq(RESTORE.takePendingRestorePointer({ field: 'ssnmrDrive', key: 't2' }), { ssnmrDrive: { id: 'P2' } },
  'sa page revenue récupère SON pointeur');
eq(RESTORE.takePendingRestorePointer({ field: 'ssnmrDrive', key: 't2' }), null, '…une seule fois');
eq(RESTORE.placeRestorePointer({ field: 'cdDrive', pointer: null, key: 't1', activeKey: 't1', patch: patchPointer }), false,
  'sans pointeur (Drive injoignable) il n’y a rien à poser');
eq(pointerPatches.length, 1, '…et rien n’est écrit pour rien');
RESTORE.forgetRestorePointers();
eq(RESTORE.takePendingRestorePointer({ field: 'ssnmrDrive', key: 't2' }), null,
  'l’oubli général des pointeurs ne laisse rien derrière');

/* ══ 2. ARCHIVER, PUIS RESTAURER (faux Drive) ══════════════════════════════ */

const FULL_SPECTRUM = { xs: [1, 2, 3], ys: [10, 20, 30], ysImag: null, meta: { swPpm: 12 }, title: 'Imported 1r' };
const pointer = await RESTORE.archiveRestoreJson({
  kind: 'nmr1d', suffix: 'nmr1d', stem: 'Sample 1',
  data: { spectrum: FULL_SPECTRUM, instanceName: 'Sample 1' },
  ctx: { project: 'CD project', test: 'Exp 1', scientist: 'Nicolas', section: 'Data', subsection: 'Bruker 1r', instance: 'Sample 1' }
});
eq(uploads.length, 1, 'l’import archive UNE copie de référence');
eq(uploads[0].name, 'Sample_1_nmr1d_restore.json.gz', '…sous le nom déterministe de l’instance');
eq(uploads[0].mimeType, 'application/gzip', '…compressée (un spectre plein format est gros)');
eq(uploads[0].ctx.subsection, 'Bruker 1r', '…dans le dossier canonique de l’expérience');
ok(!uploads[0].path, '…sans chemin forcé : c’est ctx qui décide (donc sous projects/)');
eq(pointer.id, 'RID1', 'l’appelant reçoit le pointeur du fichier');
const uploadedJson = JSON.parse(strFromU8(gunzipSync(new Uint8Array(await uploads[0].file.arrayBuffer()))));
eq(uploadedJson.kind, 'nmr1d', 'le fichier dit son TYPE (un module ne lit jamais celui d’un autre)');
eq(uploadedJson.spectrum.xs, [1, 2, 3], '…et porte le contenu MÉTIER, pas un état d’écran');

const realToken = MOCKS.driveToken;
MOCKS.driveToken = null;
eq(await RESTORE.archiveRestoreJson({ kind: 'nmr1d', suffix: 'nmr1d', stem: 'X', data: { a: 1 } }), null,
  'Drive non connecté ⇒ aucun archivage, et surtout AUCUNE exception (l’import continue)');
MOCKS.driveToken = realToken;

/* Le registre local est un raccourci : il n’existe PAS sur un autre poste, donc
   il ne peut pas être la seule source. */
globalThis.__fakeRegistry = {
  REG1: { name: 'Sample_1_nmr1d_restore.json.gz', ctx: { test: 'Exp 1', subsection: 'Bruker 1r' } },
  AUTRE_TEST: { name: 'Sample_1_nmr1d_restore.json.gz', ctx: { test: 'Autre expérience', subsection: 'Bruker 1r' } },
  AUTRE_TYPE: { name: 'Sample_1_nmr1d_restore.json.gz', ctx: { test: 'Exp 1', subsection: 'Jasco' } }
};
const cands = await RESTORE.findRestoreCandidates({
  kind: 'nmr1d', suffix: 'nmr1d', stems: ['Sample_1'],
  ctx: { test: 'Exp 1', subsection: 'Bruker 1r' },
  pointer: { id: 'SEARCH1', name: 'Sample_1_nmr1d_restore.json.gz' }
});
eq(cands.map((c) => c.id), ['SEARCH1', 'REG1'],
  'le pointeur passe en premier, le registre ensuite, et la recherche dédoublonne');
ok(!cands.some((c) => c.id === 'AUTRE_TEST'), 'le registre d’une AUTRE expérience est ignoré');
ok(!cands.some((c) => c.id === 'AUTRE_TYPE'), '…et celui d’une autre sous-section aussi');

/* Le cas d’un AUTRE POSTE : pointeur périmé et registre local vide — seul le
   NOM du fichier sur le Drive peut sauver les données. */
globalThis.__fakeRegistry = {};
const restored = await RESTORE.restoreJsonFor({
  kind: 'nmr1d', suffix: 'nmr1d', stems: ['Sample_1'],
  ctx: { test: 'Exp 1', subsection: 'Bruker 1r' },
  pointer: { id: 'RID_DEAD', name: 'Sample_1_nmr1d_restore.json.gz' }
});
ok(!!restored, 'un poste vierge retrouve quand même la copie de référence');
eq(restored.source, 'search', '…par la recherche par NOM sur le Drive');
eq(restored.data.spectrum.xs, [1, 2], '…et récupère les données métier');
eq(restored.data.kind, 'nmr1d', '…avec leur type');
ok(untrashed.includes('SEARCH1'), 'un fichier mis à la CORBEILLE est d’abord remis en place');
eq(await RESTORE.restoreJsonFor({ kind: 'nmr1d', suffix: 'nmr1d', stems: ['Inconnu'], ctx: {}, pointer: null }), null,
  'aucune copie trouvée ⇒ null (l’appelant le DIT à l’utilisateur)');

/* Un fichier d’un AUTRE type est refusé : mieux vaut rien qu’un spectre faux. */
const realMedia = MOCKS.mediaBlob;
MOCKS.mediaBlob = async () => new Blob([gzipSync(strToU8(JSON.stringify({ kind: 'ssnmr1d', version: 1, spectrum: { xs: [9] } })))]);
eq(await RESTORE.restoreJsonFor({ kind: 'nmr1d', suffix: 'nmr1d', stems: ['Sample_1'], ctx: {}, pointer: { id: 'X1' } }), null,
  'un fichier d’un autre type est refusé (pas de restauration croisée)');
MOCKS.mediaBlob = async (path) => (path.includes('/files/SEARCH1?alt=media')
  ? new Blob([gzipSync(strToU8(JSON.stringify({ kind: 'nmr1d', version: 1, spectrum: { xs: [1], ys: [2] } })))])
  : null);
eq((await RESTORE.restoreJsonFor({ kind: 'nmr1d', suffix: 'nmr1d', stems: ['Sample_1'], ctx: {}, pointer: { id: 'SEARCH1' } })).source,
  'pointer', 'le pointeur évite toute recherche quand il est encore valable');
MOCKS.mediaBlob = realMedia;

/* ══ 3. LE CÂBLAGE DU PREMIER MODULE (NMR 1D — le cas réel signalé) ════════ */

ok(NMRSRC.includes("import { archiveRestoreJson, isMissingValue, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';"),
  'NMRSections passe par le mécanisme GÉNÉRAL (aucune restauration maison)');
ok(NMRSRC.includes("import { useDriveAutoRestore } from './useDriveAutoRestore';"),
  '…et par le déclencheur automatique partagé');
ok(NMRSRC.includes("const NMR1D_RESTORE_KIND = 'nmr1d';"), 'le type de donnée est déclaré une fois');
ok(NMRSRC.includes('const nmr1dDriveCtx = (test = {}, instance = \'\') => ({'),
  'le dossier d’archive est le dossier canonique de l’instance');
ok(/subsection: 'Bruker 1r'/.test(NMRSRC), '…la même sous-section que les fichiers bruts de l’import');
ok(NMRSRC.includes('stem: instance,'), 'le nom archive est le nom DÉCLARÉ de l’instance');
eq((NMRSRC.match(/archiveNmr1dSpectrum\(\{/g) || []).length, 2,
  'les DEUX chemins d’import archivent : fichier/URL (applyNmrBruker) et dossier (clones)');
ok(NMRSRC.includes('if (isMissingValue(spec)) return true;'),
  'la donnée absente OU remplacée par un marqueur déclenche la restauration');
ok(NMRSRC.includes('const full = await loadJson(NMR_SPECTRUM_KEY(activeTest.id)).catch(() => null);'),
  'la copie plein format manquante (autre poste) la déclenche aussi');
ok(NMRSRC.includes('const nmr1dRestore = useDriveAutoRestore({'), 'la page attache le déclencheur automatique');
ok(NMRSRC.includes('restore: restoreNmr1dFromDrive'), '…avec sa restauration métier');
ok(NMRSRC.includes('nmr1dDrive: {'),
  'le pointeur de restauration voyage sur le test (dataset partagé)');
ok(NMRSRC.includes("await storeJson(NMR_SPECTRUM_KEY(activeTest.id), full);"),
  'la copie restaurée réapprovisionne la cache plein format du navigateur');
ok(NMRSRC.includes('setFullNmrSpec(full);'), '…et l’écran tout de suite (sans attendre un re-rendu)');
ok(NMRSRC.includes("'⬇️ Restore from Drive'"), 'la page garde un bouton manuel (repli explicite)');
ok(NMRSRC.includes("takePendingRestorePointer({ field: 'nmr1dDrive', key: activeTest.id })"),
  'un pointeur arrivé après un changement d’onglet est posé sur la bonne instance');
ok(!NMRSRC.includes('nmr1dPendingRefs'),
  '…par le mécanisme du NOYAU partagé (plus de carte de pointeurs locale au module)');
ok(!/nmr1dDrive[^\n]*localStorage/.test(NMRSRC), 'aucun pointeur rangé dans le navigateur (il doit voyager)');

/* ══ 3 bis. LE DEUXIÈME MODULE BRANCHÉ (ssNMR — mêmes gestes, même mécanisme) ══
   Un spectre ssNMR est une SECTION DE COLONNES (`spectraColumns`) : c'est ce qui
   ne tient pas dans le document du dataset, donc c'est ce qui doit être archivé
   et restauré — sans code de restauration propre au module. */

const SSNMRSRC = readFileSync('src/components/ssNMRSections.jsx', 'utf8');

ok(SSNMRSRC.includes("import { archiveRestoreJson, isMissingColumns, isMissingValue, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';"),
  'ssNMRSections passe par le mécanisme GÉNÉRAL (aucune restauration maison)');
ok(SSNMRSRC.includes("import { useDriveAutoRestore } from './useDriveAutoRestore';"),
  '…et par le déclencheur automatique partagé');
ok(SSNMRSRC.includes("const SSNMR_RESTORE_KIND = 'ssnmr1d';"), 'le type de donnée ssNMR est déclaré une fois');
ok(SSNMRSRC.includes("const ssnmrDriveCtx = (test = {}, instance = '') => ({"),
  'le dossier d’archive est le dossier canonique de l’instance');
ok(/subsection: 'Bruker 1r'/.test(SSNMRSRC), '…la même sous-section que les fichiers bruts de l’import');
ok(SSNMRSRC.includes('stem: instance,'), 'le nom archivé est le nom DÉCLARÉ de l’instance');
ok(SSNMRSRC.includes('columns: Array.isArray(columns) ? columns : [],'),
  'l’archive porte les COLONNES (la donnée qui ne tient pas dans le document)');
ok(SSNMRSRC.includes("wavelengthData: wavelengthData || '',"), '…et l’axe des déplacements');
eq((SSNMRSRC.match(/archiveSsnMRColumns\(\{/g) || []).length, 2,
  'les DEUX chemins d’import archivent : la condition affichée (applyBruker) et les conditions clonées');
ok(SSNMRSRC.includes('const clones = [];') && SSNMRSRC.includes('ctx.setTests(prevTests => [...prevTests, ...clones]);'),
  'les conditions clonées sont construites HORS de l’updater d’état (elles sont archivées juste après)');
ok(SSNMRSRC.includes('if (isMissingColumns(instTest.spectraColumns)) return true;'),
  'des colonnes vidées (ou remplacées par un marqueur) déclenchent la restauration');
ok(SSNMRSRC.includes('const ssnmrRestore = useDriveAutoRestore({'), 'la page attache le déclencheur automatique');
ok(SSNMRSRC.includes('restore: restoreSsnMRFromDrive'), '…avec sa restauration métier');
ok(SSNMRSRC.includes('ssnmrDrive: {'), 'le pointeur de restauration voyage sur la condition importée');
ok(SSNMRSRC.includes('spectraColumns: columns,'), 'les colonnes restaurées sont réinjectées dans la condition');
ok(SSNMRSRC.includes("'⬇️ Restore from Drive'"), 'la page garde un bouton manuel (repli explicite)');
ok(SSNMRSRC.includes("takePendingRestorePointer({ field: 'ssnmrDrive', key: ssnmrActiveKey })"),
  'un pointeur arrivé après un changement de condition est posé sur la bonne condition');
ok(SSNMRSRC.includes('const ssnmrActiveKey = (activeInstance && activeInstance.id) || activeTest.id;'),
  'la clé du portillon est la CONDITION affichée (les colonnes vivent sur elle)');
ok(!/ssnmrDrive[^\n]*localStorage/.test(SSNMRSRC), 'aucun pointeur rangé dans le navigateur (il doit voyager)');

/* ══ 3 ter. LE TROISIÈME MODULE BRANCHÉ (CD / Jasco — mêmes gestes) ══════════
   Les spectres CD sont eux aussi des COLONNES (`spectraColumns` + l'axe des
   longueurs d'onde). L'archive va dans le dossier des fichiers .jws importés
   (`Data/Spectra`) et le pointeur (`cdDrive`) vit sur la condition. */

const CDSRC = readFileSync('src/components/CDSections.jsx', 'utf8');

ok(CDSRC.includes("import { archiveRestoreJson, isMissingColumns, isMissingValue, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';"),
  'CDSections passe par le mécanisme GÉNÉRAL (aucune restauration maison)');
ok(CDSRC.includes("import { useDriveAutoRestore } from './useDriveAutoRestore';"),
  '…et par le déclencheur automatique partagé');
ok(CDSRC.includes("const CD_RESTORE_KIND = 'cdspectra';"), 'le type de donnée CD est déclaré une fois');
ok(CDSRC.includes("const cdDriveCtx = (test = {}, instance = '') => ({"),
  'le dossier d’archive est le dossier canonique de l’instance');
ok(/subsection: 'Spectra'/.test(CDSRC), '…la même sous-section que les fichiers .jws de l’import Jasco');
ok(CDSRC.includes('stem: instance,'), 'le nom archivé est le nom DÉCLARÉ de l’instance');
ok(CDSRC.includes('columns: Array.isArray(columns) ? columns : [],'),
  'l’archive porte les COLONNES (la donnée qui ne tient pas dans le document)');
eq((CDSRC.match(/archiveCdColumns\(\{/g) || []).length, 2,
  'les DEUX chemins d’import archivent : le premier fichier (applyJasco) et les conditions clonées');
ok(CDSRC.includes('const clones = [];') && CDSRC.includes('ctx.setTests(prevTests => [...prevTests, ...clones]);'),
  'les conditions clonées sont construites HORS de l’updater d’état (elles sont archivées juste après)');
ok(CDSRC.includes('if (isMissingColumns(activeTest.spectraColumns)) return true;'),
  'des colonnes vidées (ou remplacées par un marqueur) déclenchent la restauration');
ok(CDSRC.includes('const cdRestore = useDriveAutoRestore({'), 'la page attache le déclencheur automatique');
ok(CDSRC.includes('restore: restoreCdFromDrive'), '…avec sa restauration métier');
ok(CDSRC.includes('cdDrive: {'), 'le pointeur de restauration voyage sur la condition');
ok(CDSRC.includes('spectraColumns: columns,'), 'les colonnes restaurées sont réinjectées dans la condition');
ok(CDSRC.includes('rawSpectraColumns: data.rawColumns'),
  '…et la sauvegarde mdeg de la conversion [θ] quand l’archive en porte une');
ok(CDSRC.includes("'⬇️ Restore from Drive'"), 'la page garde un bouton manuel (repli explicite)');
ok(CDSRC.includes("takePendingRestorePointer({ field: 'cdDrive', key: activeTest.id })"),
  'un pointeur arrivé après un changement de condition attend son tour');
ok(!/cdDrive[^\n]*localStorage/.test(CDSRC), 'aucun pointeur rangé dans le navigateur (il doit voyager)');

/* ══ 3 quater. LE QUATRIÈME MODULE BRANCHÉ (docking — structures en IndexedDB) ══
   Les textes PDB d'un docking vivent dans la base du NAVIGATEUR (pdbStore →
   IndexedDB), pas dans le document : c'est donc eux qu'il faut archiver, et
   remettre dans la base en restaurant. */

const DOCKSRC = readFileSync('src/components/DockingSections.jsx', 'utf8');

ok(DOCKSRC.includes("import { archiveRestoreJson, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';"),
  'DockingSections passe par le mécanisme GÉNÉRAL (aucune restauration maison)');
ok(DOCKSRC.includes("import { useDriveAutoRestore } from './useDriveAutoRestore';"),
  '…et par le déclencheur automatique partagé');
ok(DOCKSRC.includes("const DOCKING_RESTORE_KIND = 'docking';"), 'le type de donnée docking est déclaré une fois');
ok(DOCKSRC.includes("const dockingDriveCtx = (test = {}, instance = '') => ({"),
  'le dossier d’archive est le dossier canonique de l’instance');
ok(/subsection: 'pdb files'/.test(DOCKSRC), '…la même sous-section que les .pdb importés');
ok(DOCKSRC.includes('stem: instance,'), 'le nom archivé est le nom DÉCLARÉ de l’instance');
ok(DOCKSRC.includes('structures: Array.isArray(structures) ? structures : [],'),
  'l’archive porte les STRUCTURES (les textes PDB, qui vivent hors du document)');
ok(DOCKSRC.includes('molecules: Array.isArray(molecules) ? molecules : [],'), '…et les molécules à docker');
ok(DOCKSRC.includes('const pointer = await archiveDockingData({'),
  'l’import d’un répertoire de calcul archive la copie de référence');
ok(DOCKSRC.includes("field: 'dockingDrive', pointer, key: test.id || 'global',"),
  '…et pose le pointeur sur l’expérience');
ok(DOCKSRC.includes('const structs = await loadJson(dockingStructKey).catch(() => null);'),
  'la restauration regarde la BASE DU NAVIGATEUR (IndexedDB) avant de télécharger');
ok(DOCKSRC.includes('if (structs.length) await storeJson(dockingStructKey, structs);'),
  '…et y remet ce qu’elle a restauré (le viewer relit la base)');
ok(DOCKSRC.includes('if (mols.length) await storeJson(dockingMolKey, mols);'),
  '…molécules comprises');
ok(DOCKSRC.includes('const dockingRestore = useDriveAutoRestore({'), 'la page attache le déclencheur automatique');
ok(DOCKSRC.includes('restore: restoreDockingFromDrive'), '…avec sa restauration métier');
ok(DOCKSRC.includes('dockingDrive: {'), 'le pointeur de restauration voyage sur l’expérience');
ok(DOCKSRC.includes("takePendingRestorePointer({ field: 'dockingDrive', key: activeTest.id || 'global' })"),
  'un pointeur arrivé après un changement d’expérience attend son tour');
ok(!/dockingDrive[^\n]*localStorage/.test(DOCKSRC), 'aucun pointeur rangé dans le navigateur (il doit voyager)');

/* La mécanique partagée : un déclencheur, un portillon, un événement. */
ok(HOOKSRC.includes('const forced = reason !== \'open\' && reason !== \'cloud-connected\';'),
  'un essai MANUEL libère la réservation (sinon « Try again » ne ferait rien)');
ok(HOOKSRC.includes('if (!claimRestore(kind, testId)) return null;'),
  'une seule tentative par expérience et par session');
ok(HOOKSRC.includes("window.addEventListener('lab:drive-connected', onConnected);"),
  'connecter le Drive après coup déclenche la restauration');
ok(HOOKSRC.includes('if (!hasCloudAccess()) return null;'),
  'sans cloud, rien n’est tenté (et rien n’est réservé)');

/* Le module de restauration ne CRÉE jamais de dossier en lisant : une page qui
   s’ouvre ne doit pas semer une arborescence fantôme sur le Drive. */
const DRIVESRC = readFileSync('src/utils/driveRestore.js', 'utf8');
ok(!DRIVESRC.includes('resolveDrivePathFromNames'),
  'la lecture ne résout (donc ne crée) aucun dossier : elle cherche par nom');
ok(!/localStorage\s*\.\s*(get|set|remove)Item/.test(DRIVESRC),
  'la restauration ne lit PAS la cache du navigateur comme source de vérité');

/* Le FCS avait déjà ce comportement : il ne doit pas régresser. */
ok(FLOWSRC.includes('const handleRestoreFromDrive = async () => {'),
  'le flow cytometry garde sa restauration automatique (modèle de départ)');
ok(FLOWSRC.includes('autoDriveRestoreDone') && FLOWSRC.includes("'lab:drive-connected'"),
  '…avec le même portillon par session et le même événement de connexion');

/* ══ 3 quinquies. LE CINQUIÈME MODULE BRANCHÉ (microscopie — médias binaires) ══
   Une vidéo de microscope n'est pas une série de nombres : c'est un FICHIER.
   Le document du dataset n'en porte que le NOM (`msVideos`, `msMovies`) ; les
   octets vivent dans la base du navigateur (blobStore → IndexedDB), donc sur le
   poste qui a importé. La copie de référence est le fichier ENVOYÉ au Drive —
   archiver un JSON de plusieurs centaines de Mo n'aurait aucun sens — et c'est
   son NOM (radical + extension) qui le retrouve depuis un poste vierge. */

const MSRC = readFileSync('src/components/MicroscopySections.jsx', 'utf8');

/* Le nom d'un média : même radical, et même extension quand les deux en ont
   une — un .mp4 converti ne doit pas être pris pour le .wmv d'origine. */
eq(RESTORE.rawStemOf('Immunostaining_p53_H10uM.jpg'), 'immunostaining_p53_h10um',
  'le radical d’un média ignore l’extension et la casse');
eq(RESTORE.rawStemOf('clip final.mp4'), 'clip_final', '…et slugue comme les fichiers déposés sur le Drive');
eq(RESTORE.rawExtOf('clip.MP4'), 'mp4', 'l’extension est comparable telle quelle');
eq(RESTORE.rawExtOf('clip'), '', 'sans extension, aucune contrainte d’extension');
ok(RESTORE.matchesRawName('Immunostaining_p53_NS.mp4', ['Immunostaining_p53_NS.mp4']),
  'le nom déposé identifie le média');
ok(RESTORE.matchesRawName('immunostaining_p53_ns.MP4', ['Immunostaining_p53_NS.mp4']),
  '…quelle que soit la casse');
ok(!RESTORE.matchesRawName('Immunostaining_p53_NS.mp4', ['Immunostaining_p53_NS.wmv']),
  'une conversion .mp4 n’est PAS le .wmv d’origine');
ok(!RESTORE.matchesRawName('Immunostaining_p53_NS.wmv', ['Immunostaining_p53.wmv']),
  'le nom déposé (avec le scientifique) et le nom d’origine sont bien deux noms distincts');
ok(RESTORE.matchesRawName('clip.mp4', ['clip']), 'un nom de référence sans extension reste tolérant');
ok(!RESTORE.matchesRawName('clip.mp4', []), 'sans nom de référence, rien ne correspond');

/* Le cycle réel : un poste VIERGE (ni pointeur, ni registre local, Drive
   connecté) retrouve la vidéo par son nom et récupère ses OCTETS. */
globalThis.__fakeRegistry = {};
const raw = await RESTORE.restoreRawFileFor({
  ctx: { test: 'T' },
  names: ['microscopy_p53_Annexin_1c0j8o0.mp4']
});
ok(!!raw, 'sur un poste vierge, le média est retrouvé par son nom');
eq(raw && raw.name, 'microscopy_p53_Annexin_1c0j8o0.mp4', '…le nom exact du fichier déposé');
eq(raw && raw.source, 'search', '…par la recherche par nom sur le Drive');
eq(raw && await raw.file.text(), 'fake-mp4-bytes', '…et ce sont les OCTETS du fichier, pas un JSON');
eq(raw && raw.file.type, 'video/mp4', '…avec son type de média');

const renamedRaw = await RESTORE.restoreRawFileFor({
  pointer: { id: 'VID1', name: 'ancien_nom.mp4' },
  ctx: { test: 'T' },
  names: ['microscopy_p53_Annexin_1c0j8o0.mp4']
});
eq(renamedRaw && renamedRaw.source, 'pointer',
  'le pointeur (id exact) passe avant la recherche par nom — un fichier renommé reste retrouvé');

const absentRaw = await RESTORE.restoreRawFileFor({ ctx: { test: 'T' }, names: ['clip_introuvable.mp4'] });
eq(absentRaw, null, 'aucun média ne répond : la restitution le DIT (null) au lieu d’inventer');

/* Le câblage du module : pointeur sur chaque média, restauration automatique
   dans les DEUX pages, remise dans la base du navigateur. */
ok(MSRC.includes("import { restoreRawFileFor } from '../utils/driveRestore';"),
  'la microscopie passe par le noyau partagé (aucune restauration maison)');
ok(MSRC.includes("import { useDriveAutoRestore } from './useDriveAutoRestore';"),
  '…et par le déclencheur automatique partagé');
ok(MSRC.includes("const MS_VIDEO_KIND = 'msvideo';"), 'le type de donnée « vidéo » est déclaré une fois');
ok(MSRC.includes("const MS_MOVIE_KIND = 'msmovie';"), '…et le type « clip » aussi');
ok(MSRC.includes("const msDriveCtx = (test = {}, section = 'Data') => ({"),
  'le dossier de la copie de référence est celui de l’expérience');
ok(/subsection: 'Microscopy'/.test(MSRC), '…la même sous-section que les fichiers envoyés à l’import');
ok(!MSRC.includes('archiveRestoreJson'),
  'aucune archive JSON d’un média : le FICHIER envoyé au Drive est la copie de référence');
ok(MSRC.includes('const found = await restoreRawFileFor({'), 'la restauration lit un média par le noyau');
ok(MSRC.includes('added.push({ ...entry, driveName, ...(drive ? { drive } : {}) });'),
  'chaque vidéo importée retient son pointeur Drive DANS le dataset (il voyage)');
ok(MSRC.includes('drive = msMediaPointer(res, driveName);'), '…pointeur posé d’après l’envoi réel');
ok(MSRC.includes('const driveName = withExtension(suggestDriveFileName({ ...driveCtx, title: base }), name);'),
  '…et le nom déclaré à l’envoi, retenu même si l’envoi échoue (recherche par nom)');
ok(MSRC.includes('filename: driveName'), 'un clip garde le nom sous lequel il a été archivé');
ok(MSRC.includes('if (drive) movieMeta.drive = drive;'), '…et son pointeur');
ok(MSRC.includes('const msVideoRestore = useDriveAutoRestore({'),
  'la page Data attache le déclencheur automatique (vidéos)');
ok(MSRC.includes('const msMovieRestore = useDriveAutoRestore({'),
  'la page Data Analysis l’attache aussi (clips)');
ok(MSRC.includes("entries: list, keyOf: (v) => msVideoKey(v.id), namesOf: msMediaNames, ctx: msDriveCtx(t, 'Data')"),
  'les vidéos sont cherchées dans le dossier de l’expérience');
ok(MSRC.includes('const msMediaNames = (entry = {}) => [entry.drive?.name, entry.driveName, entry.filename].filter(Boolean);'),
  'la recherche essaie le pointeur, le nom déposé, puis le nom d’origine');
ok(MSRC.includes('await blobStore.save(keyOf(entry), found.file);'),
  'le média restauré est REMIS dans la base du navigateur (c’est elle que la vignette relit)');
ok(MSRC.includes('if (restored) setCacheEpoch((n) => n + 1);'),
  '…et les vignettes relisent alors leur blob (cacheEpoch)');
ok(MSRC.includes('}, [video.id, reloadKey]);'), 'la vignette relit son blob après une restauration');
ok(MSRC.includes("await blobStore.load(msMovieKey(m.id))"), 'un clip restauré est relu par sa clé unique');

/* Le noyau : la lecture d'un média vit à côté de celle d'une archive JSON. */
const DRIVESRC2 = readFileSync('src/utils/driveRestore.js', 'utf8');
ok(DRIVESRC2.includes('export const restoreRawFileFor = async ({'),
  'le noyau sait aussi lire un FICHIER BRUT (média)');
ok(DRIVESRC2.includes("export const matchesRawName = (candidate = '', names = []) => {"),
  '…en comparant les noms par radical + extension');
ok(!DRIVESRC2.includes('resolveDrivePathFromNames'),
  'la lecture d’un média ne crée pas non plus de dossier (même règle)');

console.log(`${passed} passed`);

