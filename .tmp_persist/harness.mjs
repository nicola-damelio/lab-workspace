import { setQuota, used } from './fake-ls.mjs';
import {
  loadProjects, saveProjects, saveProjectsChecked, lightenProjectForStorage,
  saveProjectsRescued, linkProjectFiguresToDrive, dropOneFigurePixels,
  projectFootprint, setProjectDatasetScope, PROJECTS_KEY
} from '../src/components/AppModules/projectsModule.jsx';

let checks = 0;
const ok = (cond, what) => { if (!cond) throw new Error('FAIL — ' + what); checks += 1; };
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error('FAIL ' + what + ' / attendu : ' + JSON.stringify(b) + ' / obtenu : ' + JSON.stringify(a));
  }
  checks += 1;
};

setProjectDatasetScope('ds1');
const LINKED = '<p>Aphids transmit potyviruses'
  + ' <a class="cite-ref" href="#ref-1" data-ref="1" title="Rossi 2018">[1]</a>.</p>';
const REFS = [{ id: 'r1', number: 1, title: 'Rossi 2018', authors: 'Rossi M' }];
const project = {
  id: 'p1', name: 'Potyvirus', datasetId: 'ds1',
  background: LINKED, references: REFS, bibliography: [{ id: 'b1', title: 'Rossi 2018' }]
};

/* 1. Quota large : l import s écrit POUR DE VRAI et se relit. */
setQuota(Infinity);
const first = saveProjectsChecked([project], {
  projectId: 'p1', fields: { background: LINKED, references: REFS }
});
ok(first.ok, 'écriture normale : saveProjectsChecked confirme (relecture du magasin)');
eq(loadProjects().length, 1, 'le projet est dans le magasin');
eq(loadProjects()[0].background, LINKED, 'le TEXTE importé est relu tel quel');
ok(String(loadProjects()[0].background).includes('data-ref="1"'),
  '…et la citation reste LIÉE à sa référence après relecture');
eq(loadProjects()[0].references.map((r) => r.number), [1], 'les références numérotées sont relues');

/* 2. Quota PLEIN : l écriture échoue — et le dit. */
setQuota(400);
const heavyText = LINKED + 'x'.repeat(4000);
const refused = saveProjects([{ ...project, background: heavyText }]);
ok(refused && refused.ok === false,
  'saveProjects dit que le navigateur a REFUSÉ (avant : aucun retour, donc « tout va bien »)');
ok(!!refused.error, '…avec la raison');
const checked = saveProjectsChecked([{ ...project, background: heavyText }], {
  projectId: 'p1', fields: { background: heavyText }
});
ok(!checked.ok, 'saveProjectsChecked PROUVE que le texte n’est PAS dans le magasin');
ok(checked.missing.indexOf('background') !== -1, '…et nomme le champ manquant');
eq(loadProjects()[0].background, LINKED,
  'le magasin garde l’ANCIENNE version : c’est l’import qui aurait « disparu » à la réouverture');

/* 3. Le MÊME import avec ses figures : l'allègement rend l'écriture possible. */
setQuota(Infinity);
const DATA_URL = 'data:image/png;base64,' + 'A'.repeat(2000000);
const withFigures = {
  ...project,
  figures: {
    background: [{ id: 'f1', url: DATA_URL, full: DATA_URL, name: 'image1.png',
                  caption: 'Figure 1', anchor: 'Aphids transmit' }]
  }
};
const fullSize = projectFootprint(withFigures);
ok(fullSize > 900000, 'un import avec ses figures dépasse le budget d’allègement (octets : ' + fullSize + ')');
setQuota(1000000);
ok(!saveProjects([withFigures]).ok, 'la version complète ne rentre pas dans ce quota');
const light = lightenProjectForStorage(withFigures);
ok(light.dropped.length > 0, 'lightenProjectForStorage annonce ce qu’il a allégé');
eq(light.project.background, LINKED, 'l’allègement ne touche JAMAIS le texte');
eq(light.project.references, REFS, '…ni les références numérotées');
eq(light.project.figures.background[0].name, 'image1.png', '…la figure garde sa place et son nom');
eq(light.project.figures.background[0].pixelsMissing, true,
  '…et dit que ses pixels ne sont pas gardés dans ce navigateur');
ok(projectFootprint(light.project) < fullSize, 'la copie allégée est plus légère');
const savedLight = saveProjectsChecked([light.project], {
  projectId: 'p1', fields: { background: LINKED, references: REFS }
});
ok(savedLight.ok, 'la version allégée s’écrit ET se vérifie');
const reread = loadProjects()[0];
eq(reread.background, LINKED, 'après réouverture du projet, le TEXTE est toujours là');
eq(reread.references.length, 1, '…et la référence numérotée aussi');
ok(String(reread.background).includes('href="#ref-1"'),
  '…et le lien de citation n’a pas été perdu');

/* 4. Quota minuscule : l'échec reste rapporté (la page affiche « NOT SAVED »). */
setQuota(20);
const hopeless = saveProjectsChecked([{ ...project, background: 'y'.repeat(5000) }], {
  projectId: 'p1', fields: { background: 'y'.repeat(5000) }
});
ok(!hopeless.ok, 'quota impossible : l’échec est rapporté, jamais transformé en succès');
ok(!!hopeless.error, '…avec la raison à montrer à l’utilisateur');
ok(!!PROJECTS_KEY, 'la clé du magasin est bien celle des projets');

/* 5. UN IMPORT ÉCRIT DEUX FOIS : le texte (et ses figures), PUIS la référence
      du document que l'archivage vient de déposer sur le Drive. Ces deux
      écritures sont séparées par l'envoi (un `await`) : la seconde repartait de
      la liste des projets capturée AVANT l'import, donc elle réécrivait l'ancien
      projet — le texte DISPARAISSAIT de l'écran comme du magasin (« après
      l'import, tout disparaît… je dois cliquer Load the Drive copy »), et les
      figures devaient être reprises par un second import « Figures only ».
      Le correctif : toute écriture repart de la liste VIVANTE. Les deux bases
      sont rejouées ici, sur le magasin RÉEL. */
setQuota(Infinity);
const DRIVE = { id: 'doc-1', name: 'Potyvirus_document.json', folder: 'Lab/Pepper/projects/Potyvirus' };
const imported = {
  ...project, background: LINKED, references: REFS,
  figures: { background: [{ id: 'f1', name: 'image1.png' }] }
};
ok(saveProjectsChecked([imported], {
  projectId: 'p1', fields: { background: LINKED, references: REFS }
}).ok, 'l’import écrit le texte, ses références et ses figures — et le VÉRIFIE');
eq(loadProjects()[0].background, LINKED, '…le magasin a bien l’import');

/* ✗ LA BASE PÉRIMÉE (le défaut d'origine) : le second commit reconduit l'ancien
   projet, et il ne reste RIEN de l'import. */
const stale = { ...project, background: '', references: [], figures: {} };
saveProjectsChecked([{ ...stale, driveDocument: DRIVE }], {
  projectId: 'p1', fields: { driveDocument: DRIVE }
});
eq(loadProjects()[0].background, '',
  '…avec la base périmée, la seconde écriture EFFACE l’import (c’était exactement le défaut)');

/* ✓ LA BASE VIVANTE (le correctif) : on repart de ce que la première écriture a
   laissé — texte, références et figures survivent au second commit. */
saveProjectsChecked([imported], { projectId: 'p1', fields: { background: LINKED } });
const live = loadProjects()[0];
const second = saveProjectsChecked([{ ...live, driveDocument: DRIVE }], {
  projectId: 'p1', fields: { driveDocument: DRIVE }
});
ok(second.ok, 'la référence du document Drive s’écrit à son tour (et se vérifie)');
const finalProject = loadProjects()[0];
eq(finalProject.background, LINKED, 'le TEXTE importé est TOUJOURS là après la seconde écriture');
eq(finalProject.references.map((r) => r.number), [1], '…ses références numérotées aussi');
eq((finalProject.figures.background || []).map((f) => f.name), ['image1.png'],
  '…et ses FIGURES : le second import « Figures only » n’a plus lieu d’être');
eq(finalProject.driveDocument, DRIVE, '…et la référence du fichier Drive est bien gardée');

/* ======================================================================
   5. LE NAVIGATEUR EST PLEIN : L'ÉCRITURE EST SAUVÉE (plus de cul-de-sac).
   Le magasin du navigateur (~5 Mo par site, partagé par tous les datasets)
   était plein : CHAQUE modification était refusée et la page se contentait
   d'avertir. saveProjectsRescued refait de la place DANS le magasin et
   réessaie — texte et références d'abord, images ensuite, du moins coûteux au
   plus coûteux, et le strict minimum.
   ====================================================================== */
localStorage.clear();
setQuota(Infinity);
const DRIVE_FIG = {
  id: 'f1', name: 'image1.png', caption: 'Figure 1', anchor: 'Aphids transmit',
  url: 'data:image/png;base64,' + 'B'.repeat(300000),
  full: 'data:image/png;base64,' + 'C'.repeat(300000),
  driveUrl: 'https://drive.google.com/file/d/AAA/view'
};
const LOCAL_FIG = {
  id: 'f2', name: 'image2.png', caption: 'Figure 2',
  url: 'data:image/png;base64,' + 'D'.repeat(300000),
  full: 'data:image/png;base64,' + 'E'.repeat(300000)
};
const withFigs = { ...project, figures: { background: [DRIVE_FIG, LOCAL_FIG] } };
ok(saveProjects([withFigs]).ok, 'la version complète est écrite tant que le magasin a de la place');
const heavy = LINKED + 'x'.repeat(200000);
setQuota(1000000);
ok(!saveProjects([{ ...withFigs, background: heavy }]).ok,
  'le magasin plein REFUSE la version complète (c’est le cas signalé)');
const rescued = saveProjectsRescued([{ ...withFigs, background: heavy }],
  { projectId: 'p1', fields: { background: heavy } });
ok(rescued.ok, 'saveProjectsRescued ÉCRIT quand même : l’échec n’est plus un cul-de-sac');
eq(rescued.linked, 1, 'la figure dont le Drive a le fichier est LIÉE (aucune perte)');
eq(rescued.droppedImages, 0, '…et AUCUNE image n’est jetée quand le lien suffit');
eq(rescued.list[0].figures.background[0].url, 'https://drive.google.com/file/d/AAA/view',
  '…le lien remplace l’image encodée dans le magasin');
eq(rescued.list[0].figures.background[0].pixelsMissing, undefined,
  '…sans être marquée « pixels perdus » : l’image est sur le Drive');
eq(rescued.list[0].figures.background[1].pixelsMissing, undefined,
  '…et l’image qui n’a pas de copie Drive est gardée telle quelle');
eq(loadProjects()[0].background, heavy, 'le TEXTE est bien dans le magasin après l’allègement');
eq(rescued.list[0].references, REFS, '…et les références numérotées sont intactes');

/* 5b. Sans aucune copie Drive : le STRICT MINIMUM est jeté, pas tout. */
localStorage.clear();
setQuota(Infinity);
const F1 = { id: 'g1', name: 'gel1.png', caption: 'Gel 1', url: 'data:image/png;base64,' + 'G'.repeat(300000), full: 'data:image/png;base64,' + 'H'.repeat(300000) };
const F2 = { id: 'g2', name: 'gel2.png', caption: 'Gel 2', url: 'data:image/png;base64,' + 'I'.repeat(300000), full: 'data:image/png;base64,' + 'J'.repeat(300000) };
const twoFigs = { ...project, figures: { results: [F1, F2] } };
ok(saveProjects([twoFigs]).ok, 'les deux figures sont écrites tant qu’il y a de la place');
setQuota(1000000);
const minimal = saveProjectsRescued([{ ...twoFigs, background: LINKED + 'q'.repeat(1000) }]);
ok(minimal.ok, 'deux figures sans copie Drive : l’écriture passe quand même');
eq(minimal.droppedImages, 1, '…en jetant UNE seule image (la plus lourde), pas les deux');
eq(minimal.list[0].figures.results[0].pixelsMissing, true, 'la première image dit que ses pixels ne sont plus gardés');
eq(minimal.list[0].figures.results[0].name, 'gel1.png', '…elle garde sa place et son nom');
eq(minimal.list[0].figures.results[0].caption, 'Gel 1', '…et sa légende');
eq(minimal.list[0].figures.results[1].pixelsMissing, undefined, 'et la SECONDE garde ses pixels (c’est le strict minimum)');
eq(minimal.list[0].figures.results[1].url.startsWith('data:image/png'), true, '…ses pixels sont toujours là');

/* 5c. Les listes de figures dont les fichiers sont DÉJÀ sur le cloud : le
   dernier poste qu'on peut rendre sans rien perdre (« ⬇ Add missing from
   Drive » les relit). Une image qui n'existe QUE dans ce navigateur, elle,
   n'est JAMAIS oubliée : elle serait perdue pour de bon. */
localStorage.clear();
setQuota(Infinity);
const libItem = (id, drive) => ({
  id, label: id, addedAt: '2026-01-01T00:00:00.000Z',
  url: 'data:image/png;base64,' + 'K'.repeat(300000),
  full: 'data:image/png;base64,' + 'L'.repeat(300000),
  drive, driveUrl: drive ? 'https://drive.google.com/file/d/BBB/view' : null
});
localStorage.setItem('labFiguresLibrary', JSON.stringify([libItem('cloud1', true), libItem('local1', false)]));
saveProjects([{ ...project, background: LINKED }]);
const libBytes = String(localStorage.getItem('labFiguresLibrary')).length;
setQuota(used() + 400000);
const prunedLib = saveProjectsRescued([{ ...project, background: LINKED + 'p'.repeat(700000) }]);
ok(prunedLib.ok, 'magasin plein : l’écriture passe après avoir oublié les listes dont les fichiers sont sur le cloud');
ok(prunedLib.forgotten >= 1, '…et l’allègement DIT ce qu’il a oublié');
eq(JSON.parse(localStorage.getItem('labFiguresLibrary')).map((i) => i.id), ['local1'],
  '…l’image qui n’existe QUE dans ce navigateur est gardée');
ok(String(localStorage.getItem('labFiguresLibrary')).length < libBytes, '…et le magasin a réellement perdu du poids');

/* 5d. Plus rien à libérer : l'échec reste rapporté — AVEC LA MESURE. */
localStorage.clear();
setQuota(Infinity);
saveProjects([project]);
setQuota(50);
const stuck = saveProjectsRescued([{ ...project, background: LINKED + 'z'.repeat(500000) }]);
ok(!stuck.ok, 'quand rien ne peut être libéré, l’écriture échoue — et le dit');
ok(!!stuck.error, '…avec la raison donnée par le navigateur');
eq(stuck.scopedChanged, false,
  '…et un échec n’annonce AUCUN changement de liste (sinon la page ré-adopterait la liste et boucherait)');
ok(stuck.usage.total > 0 && stuck.usage.keys.length > 0,
  '…et la MESURE du magasin, clé par clé (le message nomme ce qui occupe la place)');
eq(stuck.usage.keys[0].key, PROJECTS_KEY, '…en commençant par le plus lourd');
eq(stuck.list[0].background, LINKED + 'z'.repeat(500000),
  'la liste rendue est celle DONNÉE : rien n’a été écrit, la page garde ce qu’elle a');
eq(loadProjects()[0].background, LINKED, '…et le magasin garde l’ancienne version (jamais d’écriture à moitié)');

/* 5e. LE POIDS EST DANS UN AUTRE DATASET — c'est la SOMME qui doit rentrer,
   pas seulement la part du projet ouvert : sinon l'écriture échouerait pour
   toujours en conseillant de supprimer un dataset (le cul-de-sac signalé). */
localStorage.clear();
setQuota(Infinity);
setProjectDatasetScope('ds2');
saveProjects([{ id: 'p2', name: 'Autre', datasetId: 'ds2', background: LINKED,
  figures: { background: [LOCAL_FIG] } }]);
setProjectDatasetScope('ds1');
saveProjects([{ ...project, background: LINKED }]);
setQuota(used() + 300000);
const otherDs = saveProjectsRescued([{ ...project, background: LINKED + 'o'.repeat(400000) }]);
ok(otherDs.ok, 'l’écriture passe en allégeant AUSSI les projets des autres datasets');
eq(otherDs.droppedImages, 1, '…et elle dit ce qui a été jeté, où que ce soit');
eq(otherDs.scopedChanged, false, '…sans toucher la liste du dataset ouvert (aucun de ses projets n’a changé)');
eq(loadProjects()[0].background, LINKED + 'o'.repeat(400000), '…et le texte écrit est celui du dataset ouvert');
eq(loadProjects('ds2')[0].figures.background[0].pixelsMissing, true,
  '…le projet de l’autre dataset, lui, est allégé (ses pixels se réimportent, son texte reste)');
eq(loadProjects('ds2')[0].background, LINKED, '…son texte est intact');


/* 6. LE BOUTON « + NEW PROJECT » SUR UN MAGASIN PLEIN. La création passait
   par un saveProjects dont le refus était ignoré : le projet neuf restait à
   l'écran puis s'évanouissait à la réouverture, sans un mot. Depuis, elle
   passe par saveProjectsRescued ET se VÉRIFIE : le projet créé est relu du
   magasin, et la place se fait dans le navigateur si besoin. */
localStorage.clear();
setQuota(Infinity);
setProjectDatasetScope('ds1');
const bigCopy = { ...project, background: LINKED, figures: { background: [DRIVE_FIG] } };
saveProjects([bigCopy]);
setQuota(used());   // plein au caractère près : un projet neuf ne rentre plus
const created = saveProjectsRescued([bigCopy, { id: 'p9', name: 'Fresh project', datasetId: 'ds1',
  background: '', references: [], figures: { background: [] } }], { projectId: 'p9', fields: {} });
ok(created.ok, 'créer un projet passe même quand le magasin du navigateur est PLEIN');
ok(created.linked >= 1, '…la place a été faite SANS RIEN PERDRE (la copie du Drive devient un lien)');
eq(created.scopedChanged, true, '…et la liste rendue est celle à adopter (l’écran garde l’allègement)');
ok(!!loadProjects().find((p) => p.id === 'p9'), '…et le projet créé est VRAIMENT dans le magasin (relu)');
eq(loadProjects().find((p) => p.id === 'p1').background, LINKED,
  '…le texte des projets existants n’a pas bougé');

/* 7. LE PIÈGE QUI FAISAIT « LE BOUTON NE CRÉE PLUS DE PROJET ». Un projet
   porte son NOM dans son dataset : deux projets du même nom y sont UN SEUL
   projet (dedupeProjects — c’est ainsi que deux copies du même projet se
   rejoignent, et c’est le nom qui nomme son dossier sur le Drive). L’écriture
   d’un jumeau le jette donc : la liste relue n’a que l’ancien id, la page
   projet dit « Project not found » et la carte n’apparaît jamais. On PROUVE
   ici ce comportement (pour que la page l’anticipe en ouvrant le projet
   existant) et on prouve qu’il ne se fait JAMAIS en silence. */
localStorage.clear();
setQuota(Infinity);
setProjectDatasetScope('ds1');
saveProjects([{ ...project, background: LINKED, references: REFS }]);
const sameName = { ...project, id: 'p10', background: '', references: [] };
const dup = saveProjectsRescued([{ ...project, background: LINKED, references: REFS }, sameName], { projectId: 'p10', fields: {} });
ok(!dup.ok, 'un projet du même nom n’est PAS écrit en double — et cela se sait (ok:false)');
eq(loadProjects().map((p) => p.id), ['p1'], '…le magasin garde le projet EXISTANT : c’est son nom qui l’identifie');
ok(String(dup.error).indexOf('not in the store') !== -1, '…avec la raison nommée : l’id du jumeau n’est pas dans le magasin');
eq(dup.scopedChanged, false, '…et rien n’est annoncé comme changé (aucune liste ré-adoptée)');
console.log('HARNESS OK ' + checks);