/* =========================================================================
   src/utils/datasetDirTwins.js
   LES JUMEAUX DES CONTENEURS DU DATASET (projects / backups / protocols /
   storage / publications).

   Un conteneur canonique ne doit exister qu'UNE fois à la racine d'un dossier
   de dataset. Le Drive en portait deux, constaté le 19/09/2026 sur le Drive
   réel (dataset « GEC-UPJV-projects » : deux `projects`, deux `protocols`, et
   les figures du projet p53H éparpillées entre les deux `projects/`).

   Pourquoi un jumeau naît : `findOrCreateFolder` crée quand la RECHERCHE ne
   rend rien, et la recherche rendait '' aussi bien pour « le dossier n'existe
   pas » que pour « le Drive n'a pas répondu » (quota 403, 5xx, délai) — un
   dossier parfaitement présent passait donc pour absent. La correction est dans
   driveUpload.js (la recherche STRICTE `listFoldersByName` remonte l'échec, et
   plus rien n'est créé après un échec) ; ici vit la partie PURE qui décide,
   entre plusieurs jumeaux, lequel est LE conteneur :

     • celui qui PORTE du contenu gagne (une recherche qui tombe à côté fabrique
       le jumeau VIDE) ;
     • à contenu égal, le PLUS ANCIEN (c'est l'arborescence d'origine) ;
     • un contenu INCONNU (Drive muet) ne fait jamais perdre un conteneur et
       n'autorise jamais sa mise à la corbeille.

   Aucun réseau ici : les candidats { id, createdTime, items } sont lus par
   driveUpload.canonicalDatasetDirId(). Vérifié par _dataset_dir_twins_test.mjs.
   ========================================================================= */
import { DATASET_FOLDER_DIRS } from './driveNaming';

/** Les seuls conteneurs autorisés directement dans un dossier de dataset. */
export const CANONICAL_DATASET_DIRS = DATASET_FOLDER_DIRS;

/** `name` est-il un conteneur canonique du dataset ? PUR. */
export const isCanonicalDatasetDir = (name) =>
  CANONICAL_DATASET_DIRS.indexOf(String(name || '').trim()) !== -1;

/** Nombre d'éléments connu d'un candidat : `null` quand le Drive n'a pas
 *  répondu (un contenu inconnu n'est ni « vide » ni « le plus rempli »). PUR. */
export const knownItemsOf = (candidate) => {
  const raw = candidate ? candidate.items : null;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Date de création en ms (Infinity quand inconnue : un candidat sans date ne
 *  gagne jamais l'ancienneté). PUR. */
const createdAtOf = (candidate) => {
  const t = Date.parse(String((candidate && candidate.createdTime) || ''));
  return Number.isFinite(t) ? t : Infinity;
};

/** LE conteneur canonique parmi des jumeaux (`null` si aucun candidat).
 *  Classement : contenu connu le plus rempli d'abord, puis le plus ancien.
 *  Un candidat dont le contenu est inconnu passe après ceux qui portent des
 *  éléments, mais avant les vides. PUR. */
export const pickCanonicalFolder = (candidates) => {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.id);
  if (!list.length) return null;
  const rank = (c) => {
    const items = knownItemsOf(c);
    if (items === null) return 0;   // inconnu : ni rempli, ni vide
    return items > 0 ? 1 : -1;      // 1 = porte du contenu, -1 = vide
  };
  return list.slice().sort((a, b) =>
    (rank(b) - rank(a))
    || ((knownItemsOf(b) || 0) - (knownItemsOf(a) || 0))
    || (createdAtOf(a) - createdAtOf(b))
    || String(a.id).localeCompare(String(b.id)))[0];
};

/** Les jumeaux à mettre à la corbeille : ceux dont le contenu est CONNU VIDE,
 *  le conteneur choisi excepté. Un jumeau qui porte quoi que ce soit (ou dont on
 *  ignore le contenu) n'est JAMAIS rendu ici. PUR. */
export const emptyTwinIds = (candidates, keepId) =>
  (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.id && String(c.id) !== String(keepId || '') && knownItemsOf(c) === 0)
    .map((c) => String(c.id));
