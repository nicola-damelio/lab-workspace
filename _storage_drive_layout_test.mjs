/* =========================================================================
   _storage_drive_layout_test.mjs — le rangement Drive d'un storage et de ses
   boîtes.

   Ce qui est vérifié ici est ce qui était faux :

     • une boîte de stockage n'est PAS une expérience : son dossier est
       storage/<storage>/boxes/<boîte>, sans niveau « instance », et il porte le
       NOM de la boîte (jamais le « Test 74 » de sa création) ;
     • les fichiers gardent leur nom (file1.jpg, file2.jpg) et vont dans un
       dossier « images » (l'ancien nom « image » est rapatrié) ;
     • l'étiquette de la boîte est déposée TOUTE SEULE dans son dossier, sous le
       nom <date>_<propriétaire>_boxlabel.pdf (les deux champs OBLIGATOIRES de la
       boîte), à partir de la même table que le bouton « Print Label » — et
       l'ancienne étiquette « label.pdf » part à la corbeille ;
     • ses NOTES sont reprises EN CALCE dans le PDF, rappelées par la POSITION du
       puits auquel elles se rapportent (la colonne « Notes » ne tient qu'une
       ligne de 11 mm) ;
     • renommer un storage / une boîte renomme son dossier sur le Drive.

   Les VRAIS modules sont importés : src/utils/driveNaming.js et
   src/utils/boxLabel.js directement, src/utils/storageDrive.js contre un FAUX
   Drive (le crochet _esm_test_hook.mjs remplace src/utils/driveUpload.js).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const NAMING = await import('./src/utils/driveNaming.js');
const LABEL = await import('./src/utils/boxLabel.js');

/* ── 1. Les chemins canoniques ────────────────────────────────────────────── */
eq(NAMING.storageFolderPath('storage1'), ['storage', 'storage1'], 'le dossier d’un storage');
eq(NAMING.storageImagesFolderPath('storage1'), ['storage', 'storage1', 'images'], 'storage/<storage>/images');
eq(NAMING.storageBoxFolderPath('storage1', 'Antibodies box'), ['storage', 'storage1', 'boxes', 'Antibodies_box'], 'une boîte est sous son storage, dans « boxes »');
eq(NAMING.storageBoxImagesFolderPath('storage1', 'Box 1'), ['storage', 'storage1', 'boxes', 'Box_1', 'images'], 'les photos d’une boîte');
eq(NAMING.storageImagesFolderPath(''), ['storage', '_unassigned', 'images'], 'un storage sans nom tombe dans « unassigned »');
eq(NAMING.boxLabelFileName('2026-01-15', 'Anna'), '2026-01-15_Anna_boxlabel.pdf',
  'le PDF d’étiquette porte la date ET le propriétaire de la BOÎTE dans son nom');
eq(NAMING.boxLabelFileName('2026-01-15', ''), '2026-01-15_boxlabel.pdf', 'une partie vide est omise (aucun « _ » orphelin)');
eq(NAMING.boxLabelFileName('', ''), 'boxlabel.pdf', '…et sans date ni propriétaire le nom reste lisible');
eq(NAMING.boxLabelFileName('2026-01-15', "O'Neil / lab"), '2026-01-15_ONeil_lab_boxlabel.pdf', 'le nom est slugué comme le reste de l’arborescence');
eq(NAMING.LEGACY_BOX_LABEL_FILE_NAME, 'label.pdf', 'l’ANCIEN nom reste connu, pour ranger l’étiquette d’avant');

eq(NAMING.driveFolderPath({ storage: 'storage1', box: 'Box 1', section: 'images' }), ['storage', 'storage1', 'boxes', 'Box_1', 'images'], 'un contexte { storage, box } résout le chemin de la boîte');
eq(NAMING.driveFolderPath({ storage: 'storage1', section: 'image' }), ['storage', 'storage1', 'images'], 'l’ancien dossier « image » (singulier) devient « images »');
eq(NAMING.driveFolderPath({ storage: 'storage1', box: 'Box 1' }), ['storage', 'storage1', 'boxes', 'Box_1'], 'sans section : le dossier de la boîte');
ok(!NAMING.driveFolderPath({ storage: 'storage1', box: 'Box 1', section: 'images' }).includes('instance'), 'AUCUN niveau « instance » dans le chemin d’une boîte');
eq(NAMING.canonicalExperimentPath({ storage: 'storage1', box: 'Box 1' }), [], 'un storage n’est pas routé comme une expérience');
eq(NAMING.storageFileCtx({ storage: 'storage1', box: 'Box 1', title: 'file2' }), { storage: 'storage1', box: 'Box 1', title: 'file2', section: 'images' }, 'le contexte de nommage d’un fichier de boîte');

/* non-régression : expériences et documents de projet gardent leur chemin */
eq(NAMING.driveFolderPath({ project: 'CD project', test: 'Exp 1', instance: 'i1', section: 'data' }), ['CD_project', 'Exp_1', 'i1', 'data'], 'une expérience garde son niveau « instance »');
eq(NAMING.driveFolderPath({ project: 'CD project', section: 'Results and Discussion' }), ['CD_project', 'Discussion'], 'un document de projet garde son alias de dossier');

/* ── 2. L’étiquette : une seule table pour l’écran, le PDF et le Drive ────── */
const box = {
  name: 'Antibodies', boxRows: 3, boxCols: 3,
  grid: [
    [JSON.stringify({ compound: 'p53H', operator: 'Nico', solvent: 'DMSO', concentration: '10', volume: '50', date: '2026-09-19', weight: '1.5', description: 'aliquot 1' }), 'PBS', ''],
    ['', JSON.stringify({ compound: 'p53R', sampleOwner: 'Anna' }), ''],
    ['', '', JSON.stringify({ compound: 'freezer stock' })]
  ]
};
eq(LABEL.parseWellValue('DMSO').compound, 'DMSO', 'l’ancien format (chaîne simple) reste lu');
eq(LABEL.parseWellValue('{"compound":"p53H","operator":"Nico"}').sampleOwner, 'Nico', 'l’ancien champ « operator » devient « sampleOwner »');
eq(LABEL.parseWellValue('{"compound":"p53H"}').concUnit, 'µM', 'les unités par défaut sont celles de l’écran');
eq(LABEL.parseWellValue('{pas du json}').compound, '', 'un JSON abîmé ne casse pas l’étiquette');

eq(LABEL.filledWells(box).map((w) => LABEL.wellPositionLabel(w.r, w.c)), ['A1', 'A2', 'B2', 'C3'], 'seuls les puits remplis sont listés (dans l’ordre de lecture)');
eq(LABEL.labelWellsFor(box, []).length, 4, 'sans sélection, l’étiquette prend tous les puits remplis');
eq(LABEL.labelWellsFor(box, [{ r: 2, c: 0 }]).map((w) => `${w.r}${w.c}`), ['20'], 'avec une sélection, c’est elle qui est imprimée');

const rows = LABEL.boxLabelRows(box, LABEL.filledWells(box));
eq(rows.map((r) => r.pos), ['A1', 'A2', 'B2', 'C3'], 'les lignes sont triées ligne puis colonne');
eq(rows[0].compound, 'p53H', 'le composé de A1');
eq(rows[0].owner, 'Nico', 'le propriétaire de A1');
eq(rows[0].conc, '10 µM', 'concentration + unité');
eq(rows[0].vol, '50 µL', 'volume + unité');
eq(rows[1].compound, 'PBS', 'l’ancien format apparaît aussi sur l’étiquette');
eq(LABEL.boxLabelRows(box, [{ r: 1, c: 1 }])[0].owner, 'Anna', 'le contenu vient bien du puits demandé');

const sig = LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows });
eq(sig, LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows }), 'la même étiquette a la même signature (rien à renvoyer)');
ok(sig !== LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows: rows.slice(0, 1) }), 'un puits de plus ⇒ signature différente ⇒ nouvel envoi');
ok(sig !== LABEL.boxLabelSignature({ storage: 'storage1', position: 4, box: 'Antibodies', rows }), 'un déplacement de la boîte change l’étiquette');

/* La date, le propriétaire et les commentaires de la boîte apparaissent sur le
   PDF — la date et le propriétaire jusque dans son NOM : les changer doit donc
   réécrire l’étiquette (sinon le fichier garderait un nom qui ne correspond
   plus à la boîte). */
ok(sig !== LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows, date: '2026-01-15' }),
  'la date de la boîte entre dans la signature');
ok(sig !== LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows, owner: 'Anna' }),
  '…comme son propriétaire (« Box Owner »)');
ok(sig !== LABEL.boxLabelSignature({ storage: 'storage1', position: 3, box: 'Antibodies', rows, notes: '<p>aliquots</p>' }),
  '…et ses commentaires, puisqu’ils sont imprimés');

/* ── Les notes des puits : reprises EN CALCE, rappelées par leur POSITION ──── */
eq(LABEL.boxLabelNotes(rows), [{ pos: 'A1', text: 'aliquot 1' }],
  'seules les lignes qui PORTENT une note sont reprises, avec la position du puits');
eq(LABEL.boxLabelNotes([{ pos: 'B2', notes: '   ' }, { pos: 'C3' }, null]), [],
  'une note vide (ou une ligne absente) n’imprime rien — pas de « B2: » vide');
eq(LABEL.boxLabelNotes(null), [], 'une table absente ne casse pas l’étiquette');

/* Le commentaire général de la boîte (« General Box Notes ») est du HTML : il
   part en texte plat, les fins de bloc devenant des retours à la ligne. */
eq(LABEL.plainBoxNotes('<p>aliquots in DMSO&nbsp;: 3</p><p>keep at −20&nbsp;°C</p>'),
  'aliquots in DMSO : 3\nkeep at −20 °C', 'les balises tombent, les paragraphes restent des lignes');
eq(LABEL.plainBoxNotes('<b>x</b><br>y'), 'x\ny', 'une mise en forme simple ne laisse aucune balise');
eq(LABEL.plainBoxNotes(''), '', 'sans commentaire, rien à imprimer');

/* Le propriétaire et la date sont ceux de la BOÎTE (mêmes règles que l’écran) */
eq(LABEL.boxLabelOwner({ boxOwner: 'Anna', operator: 'Nico' }), 'Anna', 'le propriétaire est « Box Owner »');
eq(LABEL.boxLabelOwner({ operator: 'Nico' }), 'Nico', '…à défaut l’opérateur de la boîte');
eq(LABEL.boxLabelOwner({}), '', 'sans propriétaire : chaîne vide (jamais « undefined »)');
eq(LABEL.boxLabelDate({ date: ' 2026-01-15 ' }), '2026-01-15', 'la date de la boîte est nettoyée');

const html = LABEL.buildBoxLabelHtml({ storageName: 'storage1', position: 3, boxName: 'Antibodies', rows });
ok(html.includes('Storage: storage1 (Pos: 3)'), 'l’étiquette nomme le storage et la position');
ok(html.includes('<strong>Box:</strong> Antibodies'), '…et la boîte');
ok(html.includes('<td>A1</td>') && html.includes('<td>10 µM</td>'), '…et la table des puits');
ok(!html.includes('instance1'), 'l’étiquette d’une boîte ne parle pas d’« instance »');
ok(LABEL.buildBoxLabelHtml({ storageName: '<b>x</b>', position: 1, boxName: 'a', rows: [] }).includes('&lt;b&gt;x&lt;/b&gt;'), 'le HTML est échappé');

/* ── 2b. Le PDF lui-même est FABRIQUÉ (jsPDF tourne aussi sous Node) ────────
   Les vérifications ci-dessus lisent la source ; celles-ci EXÉCUTENT le
   générateur : une erreur dans le bloc de notes (une fonction mal importée, un
   `doc.text` sur une valeur indéfinie) ne pouvait pas être vue en lisant. Le PDF
   produit n'est pas compressé, donc son texte se relit. */
const PDF = await import('./src/utils/boxLabelPdf.js');
const labelPdf = PDF.buildBoxLabelPdf({
  storageName: 'storage1', position: 3, boxName: 'Antibodies',
  owner: 'Anna', date: '2026-01-15', rows, boxNotes: '<p>aliquots in DMSO</p>'
});
ok(labelPdf && labelPdf.size > 1000, 'le PDF de l’étiquette est fabriqué et n’est pas vide');
const labelText = await labelPdf.text();
ok(labelText.includes('Box Owner: Anna'), 'l’en-tête du PDF porte le PROPRIÉTAIRE de la boîte');
ok(labelText.includes('Date: 2026-01-15'), '…et sa DATE');
ok(labelText.includes('A1: aliquot 1'), 'la note du puits descend EN CALCE, rappelée par sa POSITION');
ok(labelText.includes('aliquots in DMSO'), '…et le commentaire général de la boîte est imprimé lui aussi');
ok(labelText.includes('Notes'), 'le bloc de notes s’annonce « Notes »');

/* Beaucoup de notes très longues : le bloc ajoute des pages au lieu de rogner. */
const longRows = Array.from({ length: 30 }, (_, i) => ({
  pos: `A${i + 1}`, compound: 'x', owner: '', solvent: '', conc: '', vol: '', date: '', weight: '',
  notes: 'a very long aliquot note that has to wrap over several lines to stay readable on paper'
}));
const longPdf = PDF.buildBoxLabelPdf({
  storageName: 'storage1', position: 1, boxName: 'Antibodies', owner: 'Anna', date: '2026-01-15',
  rows: longRows, boxNotes: ''
});
ok(longPdf.size > labelPdf.size, 'une boîte très annotée donne un PDF plus long');
ok(((await longPdf.text()).match(/\/Type \/Page\b/g) || []).length > 1,
  '…et une nouvelle page quand le bas de l’étiquette est atteint');

/* Sans AUCUNE note à imprimer, le bloc en calce n’existe pas. */
const noNotesPdf = PDF.buildBoxLabelPdf({
  storageName: 'storage1', position: 3, boxName: 'Antibodies', owner: 'Anna', date: '2026-01-15',
  rows: rows.map((r) => ({ ...r, notes: '' }))
});
const noNotesText = await noNotesPdf.text();
ok(!noNotesText.includes('A1: '), 'sans note de puits, aucune ligne en calce');
ok(!noNotesText.includes('Box notes'), '…et aucun bloc « Box notes »');
ok(noNotesText.length < labelText.length, '…le PDF est donc plus court que celui qui porte les notes');

/* La colonne « Notes » de la table n’était JAMAIS dessinée (largeur négative :
   109 mm de colonnes fixes sur 108 mm utiles) : son titre doit être là, et les
   autres colonnes ne doivent pas être rognées pour autant. */
ok(labelText.includes('Notes'), 'la colonne « Notes » de la table est dessinée, elle aussi');
ok(labelText.includes('2026-09-19') && labelText.includes('1.5 mg') && labelText.includes('p53H'),
  '…sans rogner les autres colonnes (date, poids et composé passent en entier)');
const folders = new Map();  // id → { id, name, parent }
const files = new Map();    // id → { id, name, parents }
let seq = 0;
const upstream = { uploads: [], moves: [], renames: [], trashed: [] };
/* Des identifiants de 20 caractères, comme en vrai : les liens Drive en
   contiennent toujours au moins dix. */
const mkId = (prefix) => `${prefix}${String(++seq).padStart(9, '0')}abcdefghij`;
const addFolder = (name, parent) => { const id = mkId('f'); folders.set(id, { id, name, parent }); return id; };
const addFile = (name, parents) => { const id = mkId('d'); files.set(id, { id, name, parents: [...parents] }); return id; };
const childFolder = (name, parent) => [...folders.values()].find((f) => f.name === name && f.parent === parent) || null;
const folderId = (name, parent) => { const f = childFolder(name, parent); return f ? f.id : ''; };
const parentFolderOf = (fileId) => folders.get((files.get(fileId).parents || [])[0]) || null;
const grandparentOf = (fileId) => { const p = parentFolderOf(fileId); return p ? folders.get(p.parent) : null; };
const driveUrlOf = (id) => `https://drive.google.com/file/d/${id}/view`;

globalThis.__driveTestMocks = {
  cloud: true,
  ensureDriveFolder: async () => 'root',
  canonicalDatasetDirId: async (dir) => folderId(dir, 'root'),
  findFolderByName: async (name, parent) => folderId(String(name), String(parent)),
  resolveDrivePathFromNames: async (names, opts = {}) => {
    const create = opts.create !== false;
    let parent = 'root';
    const path = [];
    for (const raw of names) {
      const name = String(raw);
      const existing = folderId(name, parent);
      /* En RECHERCHE SEULE, le premier dossier absent arrête la chaîne (rien
         n'est fabriqué) — comme le vrai resolveDrivePathFromNames. */
      if (!existing && !create) return { leafId: '', path };
      const id = existing || addFolder(name, parent);
      parent = id;
      path.push({ name, id });
    }
    return { leafId: parent, path };
  },
  getDriveFileMeta: async (id) => {
    const f = files.get(String(id));
    return f
      ? { id: f.id, name: f.name, trashed: false, parents: [...f.parents] }
      : { id: String(id || ''), name: '', trashed: false, parents: [] };
  },
  moveDriveFile: async (id, parent) => {
    const f = files.get(String(id));
    if (!f) return false;
    upstream.moves.push(`${f.name}→${parent}`);
    f.parents = [String(parent)];
    return true;
  },
  renameDriveFile: async (id, name) => {
    const f = folders.get(String(id)) || files.get(String(id));
    if (!f) return false;
    upstream.renames.push(`${f.name}→${name}`);
    f.name = String(name);
    return true;
  },
  /* Les enfants d'un dossier (dossiers ET fichiers) : c'est ce que lit
     clearLegacyBoxLabels pour retrouver l'étiquette d'avant. */
  listDriveChildren: async (parent) => [
    ...[...folders.values()]
      .filter((f) => f.parent === String(parent))
      .map((f) => ({ id: f.id, name: f.name, mimeType: 'application/vnd.google-apps.folder' })),
    ...[...files.values()]
      .filter((f) => (f.parents || []).includes(String(parent)))
      .map((f) => ({ id: f.id, name: f.name, mimeType: 'application/pdf' }))
  ],
  trashDriveFile: async (id) => {
    const key = String(id);
    const file = files.get(key) || folders.get(key);
    if (!file) return false;
    upstream.trashed.push(file.name);
    if (files.has(key)) files.delete(key);
    return true;
  },
  uploadLocalFile: async (arg) => {
    upstream.uploads.push(arg);
    return { id: mkId('u'), name: arg.name, driveUrl: 'https://drive.google.com/file/d/up1/view' };
  }
};

const DRIVE = await import('./src/utils/storageDrive.js');

/* le conteneur « storage » du dataset : il existe déjà (créé par l'app) */
const containerId = addFolder('storage', 'root');

eq(DRIVE.driveFileIdsIn('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view'), ['1AbCdEfGhIjKlMnOp'], 'un lien Drive donne l’identifiant du fichier');
eq(DRIVE.driveFileIdsIn('voir https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp puis https://drive.google.com/file/d/1ZzYyXxWwVvUuTtSs/view').length, 2, 'deux liens ⇒ deux identifiants');
eq(DRIVE.driveFileIdsIn(''), [], 'rien à extraire d’une valeur vide');

/* l’étiquette part dans storage/<storage>/boxes/<boîte>/ SOUS LE NOM DE LA BOÎTE */
const blob = { size: 1234, type: 'application/pdf' };
const labelName = NAMING.boxLabelFileName('2026-01-15', 'Anna');
const saved = await DRIVE.saveBoxLabelFile({ storage: 'storage1', box: 'Antibodies', blob, name: labelName });
eq(upstream.uploads.length, 1, 'l’étiquette est envoyée');
eq(upstream.uploads[0].name, '2026-01-15_Anna_boxlabel.pdf', '…sous le nom <date>_<propriétaire>_boxlabel.pdf (jamais « label.pdf »)');
eq(upstream.uploads[0].mimeType, 'application/pdf', '…en PDF');
eq(upstream.uploads[0].path, ['storage', 'storage1', 'boxes', 'Antibodies'], '…dans le dossier de la boîte');
eq(upstream.uploads[0].ctx.storage, 'storage1', 'le contexte enregistré porte le storage');
eq(upstream.uploads[0].ctx.box, 'Antibodies', '…et la boîte');
eq(upstream.uploads[0].ctx.title, '2026-01-15_Anna_boxlabel', '…et le nom du fichier, sans son extension (renommage/recalcul)');
ok(!!saved && saved.driveUrl.includes('/up1/'), 'l’appelant reçoit le lien Drive');

/* ── L’ancienne étiquette ne reste pas à côté de la nouvelle ──────────────── */
const ensureFolder = (name, parent) => folderId(name, parent) || addFolder(name, parent);
const boxFolder = ensureFolder('Antibodies', ensureFolder('boxes', ensureFolder('storage1', containerId)));
const keptLabel = addFile(labelName, [boxFolder]);
addFile(NAMING.LEGACY_BOX_LABEL_FILE_NAME, [boxFolder]);
eq(await DRIVE.clearLegacyBoxLabels({ storage: 'storage1', box: 'Antibodies', keepName: labelName }), 1,
  'l’ancienne étiquette « label.pdf » part à la corbeille');
eq(upstream.trashed, ['label.pdf'], '…c’est bien elle, et l’étiquette actuelle n’est jamais touchée');
ok(files.has(keptLabel), '…elle est toujours dans le dossier');
eq(await DRIVE.clearLegacyBoxLabels({ storage: 'storage1', box: 'Antibodies', keepName: labelName }), 0,
  'une deuxième passe ne trouve plus rien à ranger');

/* C’est saveBoxLabelFile lui-même qui range, dès que l’étiquette est arrivée :
   aucun geste de nettoyage n’est demandé à l’utilisateur. */
addFile(NAMING.LEGACY_BOX_LABEL_FILE_NAME, [boxFolder]);
upstream.trashed.length = 0;
await DRIVE.saveBoxLabelFile({ storage: 'storage1', box: 'Antibodies', blob, name: labelName });
eq(upstream.trashed, ['label.pdf'], 'déposer l’étiquette range celle d’avant (un seul geste)');

/* Drive injoignable : rien n’est envoyé (et rien n’est perdu de travers) */
globalThis.__driveTestMocks.cloud = false;
eq(await DRIVE.saveBoxLabelFile({ storage: 'storage1', box: 'Antibodies', blob, name: labelName }), null, 'sans Drive, l’étiquette n’est pas envoyée');
eq(upstream.uploads.length, 2, '…aucune tentative d’envoi de plus');
globalThis.__driveTestMocks.cloud = true;

/* ── 4. Rangement : l’ancienne arborescence est rapatriée ─────────────────── */
/* Ce que laissait l’ancien code : storage/Test_74/instance1/image/file2.jpg */
const legacyInstance = addFolder('instance1', addFolder('Test_74', containerId));
const legacyImages = addFolder('image', legacyInstance);
const legacyFile = addFile('file2.jpg', [legacyImages]);
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', box: 'Antibodies', urls: [driveUrlOf(legacyFile)] }), 1, 'le fichier de l’ancienne arborescence est déplacé');
eq(parentFolderOf(legacyFile).name, 'images', '…dans un dossier « images »');
eq(grandparentOf(legacyFile).name, 'Antibodies', '…lui-même dans le dossier de la boîte (son nom)');
eq(folders.get(grandparentOf(legacyFile).parent).name, 'boxes', '…dans « boxes »');
eq(folders.get(folders.get(grandparentOf(legacyFile).parent).parent).name, 'storage1', '…sous son storage');
eq(folders.get(legacyInstance).name, 'instance1', 'l’ancien dossier n’est ni renommé ni supprimé : seul le fichier a été déplacé');

const movesBefore = upstream.moves.length;
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', box: 'Antibodies', urls: [driveUrlOf(legacyFile)] }), 0, 'un fichier déjà bien rangé n’est jamais redéplacé');
eq(upstream.moves.length, movesBefore, '…aucun déplacement de plus');

/* l’image de référence du storage : storage/<storage>/image/… → …/images/ */
const legacyStorageImages = addFolder('image', folderId('storage1', containerId));
const storageFile = addFile('storage1_image.jpg', [legacyStorageImages]);
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', urls: [driveUrlOf(storageFile)] }), 1, 'l’image de référence rejoint storage/<storage>/images');
eq(parentFolderOf(storageFile).name, 'images', '…dans « images »');
eq(grandparentOf(storageFile).name, 'storage1', '…sous le storage');

/* ── 4 bis. Chercher ne fabrique RIEN (le bug des dossiers « j », « ja », …) ─
   Ce qui était faux : le chemin du dossier était recalculé pendant la frappe du
   nom de la boîte, et chaque recalcul CRÉAIT le dossier du nom en cours — taper
   « jac » laissait storage/<storage>/boxes/j, …/ja, …/jac sur le Drive. Un geste
   de RANGEMENT ne doit donc jamais créer d'arborescence : il la CHERCHE, et ne
   crée le dossier que si un fichier a vraiment besoin d'y entrer. */
const UP = await import('./src/utils/driveUpload.js');
const virginPath = ['storage', 'storage1', 'boxes', 'Boite_vierge', 'images'];
const idsBeforeProbe = new Set(folders.keys());
eq((await UP.resolveDrivePathFromNames(virginPath, { create: false })).leafId, '', 'en recherche seule, un dossier absent est signalé absent');
eq(folders.size, idsBeforeProbe.size, '…et rien n’est créé pour autant (ni « Boite_vierge » ni son « images »)');
eq((await UP.resolveDrivePathFromNames(virginPath)).leafId.length > 0, true, 'l’envoi d’un fichier, lui, fabrique bien le dossier');
const createdByProbe = [...folders.keys()].filter((id) => !idsBeforeProbe.has(id));
eq(createdByProbe.length, 2, '…exactement les deux dossiers du chemin (celui de la boîte et son « images »)');
/* le faux Drive repart exactement comme avant ces deux vérifications */
for (const id of createdByProbe) folders.delete(id);
eq(folders.size, idsBeforeProbe.size, 'le faux Drive est revenu à son état d’avant la recherche');

/* ranger : le dossier de la boîte n'est créé QUE parce qu'un fichier y entre */
const emptyBoxFolder = addFolder('Boite_a_ranger', folderId('boxes', folderId('storage1', containerId)));
const strayFile = addFile('file3.jpg', [emptyBoxFolder]);
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', box: 'Boite_a_ranger', urls: [driveUrlOf(strayFile)] }), 1, 'un fichier posé dans le dossier de la boîte rejoint son « images »');
eq(parentFolderOf(strayFile).name, 'images', '…dans un dossier « images » créé pour l’occasion');
eq(folders.get(parentFolderOf(strayFile).parent).name, 'Boite_a_ranger', '…sous le dossier de la boîte');
const movesNow = upstream.moves.length;
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', box: 'Boite_a_ranger', urls: [driveUrlOf(strayFile)] }), 0, 'une fois rangé, il n’y a plus rien à faire');
eq(upstream.moves.length, movesNow, '…aucun déplacement de plus');

/* ── 5. Renommages : le dossier suit le nom ──────────────────────────────── */
const foldersBeforeRenames = folders.size;
eq(await DRIVE.renameStorageBoxDriveFolder({ storage: 'storage1', oldName: 'Test 74', newName: 'Antibodies' }), false, 'renommer une boîte sans dossier ne fabrique rien');
eq(await DRIVE.renameStorageBoxDriveFolder({ storage: 'storage1', oldName: 'Antibodies', newName: 'Antibody stocks' }), true, 'renommer une boîte renomme SON dossier');
eq(childFolder('Antibody_stocks', folderId('boxes', folderId('storage1', containerId))).name, 'Antibody_stocks', '…au nom slugé de la boîte');
eq(await DRIVE.renameStorageBoxDriveFolder({ storage: 'storage1', oldName: 'Antibody stocks', newName: 'Antibody stocks' }), false, 'un renommage identique ne touche à rien');

/* Le bug des dossiers « j », « ja », « jac » : un renommage ne FABRIQUE rien,
   il renomme UN dossier — et les fichiers suivent leur dossier, donc le
   rangement n'a plus rien à faire une fois le nom définitif. */
eq(folders.size, foldersBeforeRenames, 'renommer une boîte ne crée aucun dossier (ni « j », ni « ja », ni « jac »)');
eq(await DRIVE.tidyStorageFiles({ storage: 'storage1', box: 'Antibody stocks', urls: [driveUrlOf(legacyFile)] }), 0, 'après renommage, la photo est déjà dans le dossier de la boîte');
eq(folders.size, foldersBeforeRenames, '…et le rangement non plus n’a rien créé');

eq(await DRIVE.renameStorageDriveFolder({ oldName: 'storage1', newName: 'Freezer -80' }), true, 'renommer un storage renomme son dossier');
eq(childFolder('Freezer_-80', containerId).name, 'Freezer_-80', '…au nouveau nom slugé');
eq(await DRIVE.renameStorageDriveFolder({ oldName: 'inconnu', newName: 'x' }), false, 'un storage jamais utilisé ne crée pas de dossier');

/* ── 6. Le câblage de l’écran ────────────────────────────────────────────── */
const read = (p) => readFileSync(p, 'utf8');
const STORAGE_SRC = read('./src/components/Storage.jsx');
const ATM_SRC = read('./src/components/AppModules/activeTestModule.jsx');
const LABEL_COMP = read('./src/components/BoxLabelFile.jsx');
const PDF_SRC = read('./src/utils/boxLabelPdf.js');

ok(STORAGE_SRC.includes('path={storageImagesFolderPath(st.name)}'), 'l’image du storage vise storage/<storage>/images');
ok(STORAGE_SRC.includes("path={storageBoxImagesFolderPath(storageName, boxName || 'box')}"), 'les photos de boîte visent storage/<storage>/boxes/<boîte>/images');
ok(STORAGE_SRC.includes('nameFor={(file) => originalBaseName(file, fallback)}'), 'un fichier de boîte garde son propre nom (file2.jpg)');
ok(!STORAGE_SRC.includes("path={['storage', st.name, 'image']}"), 'l’ancien chemin storage/<storage>/image a disparu');
ok(!/path=\{\['storage', activeTest\.name/.test(STORAGE_SRC), 'l’ancien chemin storage/<boîte>/<instance>/image a disparu');
ok(STORAGE_SRC.includes('<BoxLabelFile'), 'la boîte affiche l’étiquette du Drive');
ok(STORAGE_SRC.includes('tidyStorageFiles({ storage: storageName, urls: [storageImageUrl] })'), 'l’image déjà envoyée est rapatriée à l’ouverture du storage');
ok(STORAGE_SRC.includes('renameStorageDriveFolder({ oldName: previousName, newName: newStorage.name })'), 'renommer un storage renomme son dossier');
ok(ATM_SRC.includes('renameStorageBoxDriveFolder({'), 'renommer une boîte passe par renameStorageBoxDriveFolder');
ok(ATM_SRC.includes('if (isBox) {'), '…et seulement pour une boîte (une expérience garde renameDriveFilesFor)');
ok(LABEL_COMP.includes('const fileName = boxLabelFileName(date, owner);'),
  'le nom du fichier vient de la DATE et du PROPRIÉTAIRE de la boîte');
ok(LABEL_COMP.includes('saveBoxLabelFile({ storage: storageName, box: boxName, blob, name: fileName })'),
  'l’étiquette est déposée par storageDrive SOUS CE NOM (jamais « label.pdf »)');
ok(LABEL_COMP.includes('buildBoxLabelPdf({ storageName, position, boxName, owner, date, rows, boxNotes })'),
  '…et fabriquée à partir de la même table, avec la date, le propriétaire et les commentaires');
ok(LABEL_COMP.includes('{filePath}'), 'l’écran MONTRE le nom exact du fichier déposé');
ok(PDF_SRC.includes('writeNotesBlock(doc, ['), 'les notes sont reprises EN CALCE dans le PDF');
ok(PDF_SRC.includes('boxLabelNotes(rows).map((note) => ({ prefix: `${note.pos}: `, text: note.text }))'),
  '…chacune rappelée par la POSITION du puits auquel elle se rapporte');
ok(PDF_SRC.includes('plainBoxNotes(boxNotes)'), '…et le commentaire général de la boîte ferme le bloc');
ok(PDF_SRC.includes("doc.output('blob')"), 'le PDF est un blob (donc envoyable)');
ok(PDF_SRC.includes('format: [LABEL_PAGE_MM, LABEL_PAGE_MM]'), 'le format du papier est celui de l’étiquette imprimée');

/* La boîte passe à l’étiquette SA date, SON propriétaire et SES commentaires —
   les mêmes règles que l’écran (storageModules.getBoxOwner : Box Owner, à défaut
   l’opérateur) — et ils entrent dans la signature, sinon les changer laisserait
   un fichier dont le nom ne correspond plus à la boîte. */
ok(STORAGE_SRC.includes('const labelOwner = boxLabelOwner(activeTest);')
  && STORAGE_SRC.includes('const labelDate = boxLabelDate(activeTest);'),
  'la boîte résout son propriétaire et sa date avec les helpers de boxLabel');
ok(STORAGE_SRC.includes('owner={labelOwner}') && STORAGE_SRC.includes('date={labelDate}')
  && STORAGE_SRC.includes('boxNotes={activeTest.comments || \'\'}'),
  '…et les passe à l’étiquette (en-tête, nom du fichier et notes en calce)');
ok(STORAGE_SRC.includes('date: labelDate, owner: labelOwner, notes: activeTest.comments || \'\''),
  '…les trois entrent dans la signature de l’étiquette');

/* Le bug corrigé : le dossier d'une boîte était recalculé à CHAQUE FRAPPE (le
   nom était une dépendance de l'effet de rangement), donc taper « jac » laissait
   storage/<storage>/boxes/j, …/ja, …/jac. Le nom est maintenant lu dans une ref,
   l'effet suit la BOÎTE ouverte, et le renommage (un seul geste, au blur) range
   les photos une fois avec le nom définitif. */
const DRIVE_SRC = read('./src/utils/storageDrive.js');
const UP_SRC = read('./src/utils/driveUpload.js');
ok(!/\}, \[boxPhotoKeys, boxStorageName, activeTest\.name\]\)/.test(STORAGE_SRC), 'le rangement de la boîte ne dépend PLUS du nom en cours de frappe');
ok(STORAGE_SRC.includes('const boxNameRef = useRef(activeTest.name'), '…le nom de la boîte est lu dans une ref');
ok(STORAGE_SRC.includes('}, [boxPhotoKeys, boxStorageName, activeTest.id]);'), '…et l’effet suit la BOÎTE ouverte et ses photos');
ok(ATM_SRC.includes('tidyStorageFiles({'), 'renommer une boîte range ses photos, une seule fois, à la fin de la saisie');
ok(ATM_SRC.includes("box: activeTest.name || 'box',"), '…avec le nom DÉFINITIF de la boîte');
ok(DRIVE_SRC.includes('resolveDrivePathFromNames(names, { create: false })'), 'le rangement CHERCHE le dossier visé avant de le créer');
ok(DRIVE_SRC.includes('const resolved = await resolveDrivePathFromNames(names);'), '…et ne le crée que parce qu’un fichier a vraiment besoin d’y entrer');
ok(UP_SRC.includes("if (!next && !create) return { leafId: '', path };"), 'en recherche seule, driveUpload ne fabrique aucun dossier');
ok(DRIVE_SRC.includes('export const clearLegacyBoxLabels = async ({ storage, box, keepName = \'\' }) =>'),
  'storageDrive sait ranger l’étiquette qui portait l’ANCIEN nom');
ok(DRIVE_SRC.includes('if (saved && saved.driveUrl) await clearLegacyBoxLabels({ storage, box, keepName: name });'),
  '…et le fait dès que la nouvelle étiquette est arrivée (jamais sans Drive)');
ok(DRIVE_SRC.includes('LEGACY_BOX_LABEL_FILE_NAME'), '…l’ancien nom est connu du rangement, jamais réécrit');

const pkg = JSON.parse(read('./package.json'));
ok(!!pkg.dependencies.jspdf, 'jspdf est installé (aucun service externe)');

console.log(`_storage_drive_layout_test: ${passed} passed`);



