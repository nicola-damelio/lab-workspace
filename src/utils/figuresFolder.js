/* =========================================================================
   src/utils/figuresFolder.js
   LE DOSSIER D'IMAGES D'UN PROJET : le TROUVER — jamais en fabriquer un second.

   L'emplacement canonique d'une figure est

       <dataset>/projects/<slug(projet)>/images

   donc DÉRIVÉ DU NOM du projet (voir driveNaming.projectImagesFolderPath). Un
   projet renommé, un dossier renommé à la main sur le Drive, ou un miroir perdu
   (navigateur vidé, magasin plein — `labDriveMirror` n'est pas synchronisé)
   laissent les fichiers dans l'ANCIEN dossier pendant que le programme cherche le
   nouveau. Et comme la résolution CRÉAIT le dossier manquant
   (driveUpload.resolveDrivePathFromNames), elle fabriquait un jumeau VIDE :

       « j'ai deux dossiers images sur le Drive et l'un est vide, et le
         programme ne voit plus mes figures »  —  le dossier lu n'était pas
         celui où les fichiers sont.

   Ce module corrige la cause : il CHERCHE et ne crée RIEN.

     1. le MIROIR PARTAGÉ (`labDriveMirror` → dossier du projet par identifiant
        Drive) : il survit à un renommage, le dossier étant renommé sur place ;
     2. le nom CANONIQUE (projects/<slug>/images) — un simple test d'existence ;
     3. un dossier de projet VOISIN dont le nom ressemble encore (renommage
        léger : « Canvas 18/09 » → « Canvas 18-09-2026 »).

   Quand aucun dossier ne peut être identifié AVEC CERTITUDE (renommage complet :
   « Canvas 1 » → « Fig 1 »), il ne devine pas — il LISTE les dossiers de projet
   du dataset avec ce que chacun contient, et l'écran laisse choisir
   (voir pullLibraryFromDrive({ fromFolderName })).

   Les gestes qui ÉCRIVENT (publication d'une figure, dépôt du sidecar éditable)
   passent par le même résolveur : une nouvelle figure rejoint le dossier qui
   existe déjà au lieu d'ouvrir un dossier parallèle — c'est ce qui remet un
   projet sur UN seul dossier d'images.
   ========================================================================= */

import {
  getDriveToken, getDriveRootId, getDriveRootName, ensureDriveFolder,
  findFolderByName, listDriveChildren, getDriveFileMeta
} from './driveUpload';
import {
  readDriveMirror, writeDriveMirror, findProjectFolderId, findDatasetFolderId,
  rememberProjectFolder
} from './driveMirrorStore';
import { sanitizeSlug, projectImagesFolderPath } from './driveNaming';

/* ── Comparaison de noms (PUR, testable) ───────────────────────────────────── */

/** Clé de comparaison d'un nom de dossier : minuscules, sans séparateurs — donc
 *  « Canvas 18/09 » et « Canvas_18-09 » se comparent. PUR. */
export const folderNameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Les mots d'un nom (pour un renommage qui garde la moitié du titre). PUR. */
const folderNameWords = (name) => sanitizeSlug(name).toLowerCase().split(/[_-]+/).filter(Boolean);

/** Deux noms désignent-ils le MÊME dossier de projet ?
 *  3 = même nom au séparateur/casse près (« Canvas_18_09 » = « canvas 18 09 »),
 *  2 = l'un contient l'autre (« Figure_p53H » ⊃ « Figure_p53H_old »),
 *  1 = ils partagent des mots (« Canvas 18/09 » ↔ « Canvas 19/09 »),
 *  0 = rien en commun (un vrai renommage : à l'utilisateur de trancher). PUR. */
export const projectFolderNameScore = (folderName, projectName) => {
  const a = folderNameKey(folderName);
  const b = folderNameKey(projectName);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 2;
  const wordsA = folderNameWords(folderName);
  const wordsB = folderNameWords(projectName);
  return wordsA.some((w) => wordsB.indexOf(w) !== -1) ? 1 : 0;
};

/** Le dossier qui est SÛREMENT celui de ce projet, sinon `null`.
 *  Un score ≥ 2 (nom identique ou contenu) suffit ; un score de 1 (mots communs)
 *  ne suffit PAS — deux projets peuvent partager des mots — et deux candidats à
 *  égalité ne suffisent pas non plus : dans ces cas l'appelant montre la liste
 *  au lieu de choisir à l'aveugle. PUR. */
export const pickFiguresFolder = (candidates, projectName) => {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.name && c.imagesId);
  if (!list.length) return null;
  const scored = list
    .map((c) => ({ c, score: projectFolderNameScore(c.name, projectName), files: Number(c.files || 0) }))
    .sort((x, y) => (y.score - x.score) || (y.files - x.files));
  const best = scored[0];
  if (!best || best.score < 2) return null;
  if (scored[1] && scored[1].score === best.score) return null;
  return best.c;
};

/* ── Lecture du Drive (aucun dossier créé) ─────────────────────────────────── */

/** La racine du dataset : l'identifiant retenu dans le miroir s'il existe
 *  encore, sinon le dossier du dataset (seul endroit où l'on accepte une
 *  création : sans lui, il n'y a rien à lire). */
const datasetRootId = async () => {
  try {
    const remembered = findDatasetFolderId(readDriveMirror(), {
      id: getDriveRootId(), name: getDriveRootName()
    });
    if (remembered) {
      const meta = await getDriveFileMeta(remembered);
      if (meta && meta.id && !meta.trashed) return remembered;
    }
  } catch { /* miroir illisible → dossier du dataset */ }
  return await ensureDriveFolder();
};

/** TOUS les dossiers de projet du dataset, avec ce que leur dossier `images`
 *  contient (`files` = fichiers, `sidecars` = compositions éditables).
 *  LECTURE SEULE : rien n'est créé, même quand le dossier n'existe pas. */
export const listProjectFiguresFolders = async () => {
  const out = [];
  if (!getDriveToken()) return out;
  try {
    const root = await datasetRootId();
    if (!root) return out;
    const projectsId = await findFolderByName('projects', root);
    if (!projectsId) return out;
    const children = await listDriveChildren(projectsId);
    for (const child of children) {
      if (!child || !child.id) continue;
      if (String(child.mimeType || '') !== 'application/vnd.google-apps.folder') continue;
      const imagesId = await findFolderByName('images', String(child.id));
      if (!imagesId) continue;
      const files = await listDriveChildren(imagesId);
      out.push({
        name: String(child.name || ''),
        folderId: String(child.id),
        imagesId: String(imagesId),
        files: files.length,
        sidecars: files.filter((f) => /\.meta\.json$/i.test(String((f && f.name) || ''))).length
      });
    }
  } catch { /* pas de Drive / pas de jeton : liste vide, jamais une erreur */ }
  return out;
};

/**
 * Le dossier d'images de CE projet, cherché sans rien créer.
 *
 * @returns {Promise<{ name:string, leafId:string, exact:boolean, via:string,
 *                     folder:string, candidates:Array }>}
 *   `name`       nom RÉEL du dossier du projet sur le Drive (peut différer du
 *                nom du projet : c'est tout l'intérêt) ;
 *   `leafId`     identifiant du dossier `images` — '' quand on n'a rien trouvé ;
 *   `via`        'mirror' | 'name' | 'similar' | '' (comment il a été trouvé) ;
 *   `candidates` ce qui a été vu (renseigné quand rien n'est certain, pour que
 *                l'écran puisse proposer le bon dossier au lieu de deviner).
 */
export const findProjectFiguresFolder = async (projectName) => {
  const wanted = sanitizeSlug(projectName) || '_unassigned';
  const none = {
    name: '', leafId: '', exact: false, via: '',
    folder: projectImagesFolderPath(projectName).join('/'), candidates: []
  };
  if (!getDriveToken()) return none;
  try {
    // 1. LE MIROIR : l'identifiant Drive du dossier du projet. Il est renommé SUR
    //    PLACE quand le projet est renommé, donc il reste juste — c'est la seule
    //    source qui survit à un renommage complet.
    const folderId = findProjectFolderId(readDriveMirror(), {
      datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName
    });
    if (folderId) {
      const meta = await getDriveFileMeta(folderId);
      if (meta && meta.id && !meta.trashed) {
        const imagesId = await findFolderByName('images', folderId);
        if (imagesId) {
          const name = String(meta.name || wanted);
          return { name, leafId: imagesId, exact: name === wanted, via: 'mirror', folder: `projects/${name}/images`, candidates: [] };
        }
      }
    }
    // 2. LE NOM CANONIQUE — existence seulement : c'est ici que l'ancien code
    //    créait un jumeau vide quand le dossier portait un autre nom.
    const root = await datasetRootId();
    const projectsId = root ? await findFolderByName('projects', root) : '';
    if (projectsId) {
      const exactId = await findFolderByName(wanted, projectsId);
      if (exactId) {
        const imagesId = await findFolderByName('images', exactId);
        if (imagesId) {
          return { name: wanted, leafId: imagesId, exact: true, via: 'name', folder: `projects/${wanted}/images`, candidates: [] };
        }
      }
    }
    // 3. UN DOSSIER VOISIN qui ressemble encore au nom du projet.
    const all = await listProjectFiguresFolders();
    const picked = pickFiguresFolder(all, projectName);
    if (picked) {
      return { name: picked.name, leafId: picked.imagesId, exact: false, via: 'similar', folder: `projects/${picked.name}/images`, candidates: all };
    }
    return { ...none, candidates: all };
  } catch { return none; }
};

/**
 * Faire de ce dossier LE dossier du projet : l'identité est retenue dans le
 * miroir partagé (clé `labDriveMirror`), donc les lectures ET les envois suivants
 * visent ce dossier-là — c'est le geste qui remet un projet sur un seul dossier
 * d'images quand le renommage a été total.
 * @returns {Promise<string>} l'identifiant du dossier `images` ('' si introuvable).
 */
export const adoptProjectFiguresFolder = async ({ projectName = '', folderName = '' } = {}) => {
  const wanted = sanitizeSlug(folderName);
  if (!wanted) return '';
  const all = await listProjectFiguresFolders();
  const found = all.find((c) => sanitizeSlug(c.name) === wanted);
  if (!found) return '';
  try {
    writeDriveMirror(rememberProjectFolder(readDriveMirror(), {
      datasetId: getDriveRootId(), datasetName: getDriveRootName(), projectName, folderId: found.folderId
    }));
  } catch { /* registre local indisponible : la lecture de ce dossier reste possible */ }
  return found.imagesId;
};
