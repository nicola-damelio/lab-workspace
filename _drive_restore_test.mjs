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
   câblage du premier module branché (NMR 1D, qui était le cas réel signalé).
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

ok(NMRSRC.includes("import { archiveRestoreJson, isMissingValue, restoreJsonFor, restoreStems } from '../utils/driveRestore';"),
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
ok(NMRSRC.includes('nmr1dPendingRefs.get(activeTest.id)'),
  'un pointeur arrivé après un changement d’onglet est posé sur la bonne instance');
ok(!/nmr1dDrive[^\n]*localStorage/.test(NMRSRC), 'aucun pointeur rangé dans le navigateur (il doit voyager)');

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

console.log(`${passed} passed`);

