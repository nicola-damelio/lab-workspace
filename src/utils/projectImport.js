/* =========================================================================
   src/utils/projectImport.js — LES PROJETS D'UN FICHIER DE SAUVEGARDE SONT
   ADOPTÉS PAR LE DATASET QUI LES REÇOIT (« Load HTML »).

   Le défaut réparé : « j'ouvre un NOUVEAU dataset, je charge la dernière
   sauvegarde : les expériences sont revenues, les projets NON. »

   Les expériences vivent dans l'ÉTAT du dataset : elles suivent le dataset où
   l'import écrit. Un PROJET, lui, est ÉTIQUETÉ par le dataset qui l'a vu naître
   (`datasetId`) — `loadProjects()` ne rend que les projets de CE dataset (voir
   projectsModule.jsx). Les projets d'une sauvegarde portent donc l'étiquette de
   leur dataset D'ORIGINE, et l'import les écrivait TELS QUELS : présents dans
   le magasin du navigateur, mais INVISIBLES dans le dataset où la restauration
   venait d'écrire (le state sauvegardé ne portait pas non plus d'id, donc
   « Import everything » recréait un dataset neuf à chaque fois). La page
   Projets restait vide, et `describeProjectRestore` allait jusqu'à le
   constater : « ils SONT sur ce poste — mais rattachés à un AUTRE dataset ».

   La règle posée ici est celle du geste : un import (« Load HTML ») est
   l'ADOPTION des projets du fichier par le dataset qui les reçoit — ils
   prennent SON id, donc ils sont VISIBLES. Le magasin du navigateur ne garde
   qu'UNE copie par projet (voir `dedupeProjects`) : la copie étiquetée à
   l'ancien dataset est REMPLACÉE, jamais doublée.

   Deux garde-fous, parce qu'un import ne doit rien reprendre ni rien effacer :

     • une TOMBE se lit sur l'étiquette D'ORIGINE — ré-étiqueter d'abord ferait
       revivre un projet supprimé (sa tombe l'attend sous l'ancien dataset) ;
       les projets concernés ne sont PAS adoptés et sont RENDUS à l'appelant,
       qui le dit ;
     • en AJOUT (« ➕ Add the selected elements »), ce que le dataset ouvert a
       DÉJÀ n'est jamais écrasé par la copie du fichier : on n'ajoute que ce qui
       manque (c'est aussi ce qui protège une copie allégée pour tenir dans le
       quota d'une sauvegarde plus lourde).

   Et un geste qui reste ce qu'il annonce : EN REMPLACEMENT (« 🔄 Import
   everything (replace the dataset) »), la liste du dataset devient celle du
   fichier — un projet du dataset que le fichier n'apporte pas s'en va, comme
   avant. Ce que le fichier n'apporte pas, il ne l'efface pas non plus : un
   fichier dont la liste est VIDE (ou dont tous les projets ont une tombe) ne
   vide jamais le magasin (voir `importProjectsFromFile`, écriture seulement
   quand quelque chose arrive).

   Module PUR (aucun accès au magasin, aucun React) : la décision se vérifie
   telle quelle, sans navigateur — voir _persist_store_test.mjs.
   ========================================================================= */
import { isProjectDeleted, normalizeTombstones } from './projectTombstones';

const idOf = (p) => (p && p.id !== undefined && p.id !== null ? String(p.id) : '');

const datasetOf = (p) => (
  p && p.datasetId !== undefined && p.datasetId !== null ? String(p.datasetId) : ''
);

/** LE DATASET DONT UN FICHIER DE SAUVEGARDE VIENT, quand le fichier ne le dit
 *  pas lui-même : les projets qu'il embarque portent l'étiquette du dataset où
 *  ils sont nés (ils viennent de `loadProjects()`). App.jsx s'en sert pour que
 *  « Import everything » remette le contenu DANS son dataset (au lieu d'en
 *  recréer un neuf à chaque restauration) — et sans rien deviner : '' quand le
 *  fichier n'a pas de projet étiqueté, ou que plusieurs origines s'y mélangent.
 *  @param {Array} fileProjects les projets du fichier
 *  @returns {string} l'id du dataset d'origine, ou '' */
export const fileDatasetIdOf = (fileProjects) => {
  const ids = new Set(
    (Array.isArray(fileProjects) ? fileProjects : []).map(datasetOf).filter(Boolean)
  );
  return ids.size === 1 ? Array.from(ids)[0] : '';
};

/** LA LISTE À ÉCRIRE, et le compte rendu de l'import (« ce qui n'est pas
 *  arrivé » se dit à l'utilisateur, il ne se tait pas).
 *  @param {{ store?:Array, tombstones?:Array, fileProjects?:Array,
 *            targetDatasetId?:string, replace?:boolean }} arg
 *  @returns {{ list:Array, adopted:Array, skippedDeleted:Array, target:string }} */
export const planProjectImport = ({
  store, tombstones, fileProjects, targetDatasetId, replace = false
} = {}) => {
  const existing = (Array.isArray(store) ? store : []).filter(Boolean);
  const tombes = normalizeTombstones(tombstones);
  const target = targetDatasetId === undefined || targetDatasetId === null
    ? '' : String(targetDatasetId);
  const items = (Array.isArray(fileProjects) ? fileProjects : []).filter(Boolean);

  /* ① LA TOMBE SE LIT SUR L'ÉTIQUETTE D'ORIGINE (avant toute ré-écriture) :
        un projet supprimé ne revient pas parce qu'on l'a ré-étiqueté. */
  const skippedDeleted = items.filter((p) => isProjectDeleted(p, tombes));
  const alive = items.filter((p) => !isProjectDeleted(p, tombes));

  /* ② LE FICHIER EST ADOPTÉ : ses projets prennent l'id du dataset qui les
        reçoit — c'est ce qui les rend visibles ici. Sans dataset ouvert
        (vue globale), ils gardent leur étiquette : ils restent visibles là où
        ils appartiennent. */
  const tag = (list) => (target ? list.map((p) => ({ ...p, datasetId: target })) : list.slice());
  const belongsHere = (p) => !!target && datasetOf(p) === target;

  /* ③ EN AJOUT (« ➕ Add the selected elements »), ce que ce dataset a DÉJÀ garde
        SA version : on n'ajoute que ce qui manque. EN REMPLACEMENT (« 🔄 Import
        everything (replace the dataset) »), c'est le geste DEMANDÉ : la liste du
        dataset devient celle du fichier. */
  const ownedHere = new Set(existing.filter(belongsHere).map(idOf).filter(Boolean));
  const arriving = replace
    ? tag(alive)
    : tag(alive).filter((p) => !(idOf(p) && ownedHere.has(idOf(p))));
  const arrivingIds = new Set(arriving.map(idOf).filter(Boolean));

  /* ④ LE MAGASIN NE GARDE QU'UNE COPIE PAR ID : la copie qui portait un AUTRE
        dataset (donc invisible ici) est REMPLACÉE, jamais doublée. Tout le reste
        des AUTRES datasets est conservé, dans son ordre — et, en REMPLACEMENT
        seulement, les projets de CE dataset que le fichier n'apporte pas s'en
        vont (le fichier EST la nouvelle liste). L'ordre du magasin est gardé :
        les projets arrivés se rangent à la fin, comme les projets neufs. */
  const rest = existing.filter((p) => {
    const id = idOf(p);
    if (id && arrivingIds.has(id)) return false;
    return !(replace && belongsHere(p));
  });

  return { list: [...rest, ...arriving], adopted: arriving, skippedDeleted, target };
};
