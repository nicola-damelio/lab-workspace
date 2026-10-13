/* =========================================================================
   src/utils/dockingStructureSrc.js
   LA STRUCTURE QUE LA PAGE DOCKING CONFIE À SON VIEWER 3D VIENT DU DATASET —
   ELLE N'EST JAMAIS FABRIQUÉE PAR LA PAGE.

   LE DÉFAUT RÉPARÉ ICI, dit par le rapport : « some docking tests do not load
   automatically the structure they are supposed to load. By default the
   structure of a protein appears that has nothing to do with the dataset (its
   sequence starts with MQIFVKTL), sometimes after a while the correct
   structure appears but not always. »

   Ce que `MQIFVKTL…` était : l'UBIQUITINE du dépôt RCSB — `1UBQ`, la protéine
   de DÉMONSTRATION que cette page fabriquait elle-même dès qu'un récepteur
   était « défini » (une séquence tapée, un SMILES, un composé de la Librairie)
   alors qu'AUCUNE structure n'avait encore été chargée. Ce texte n'appartenait
   à aucun dataset ; et comme il arrivait par le RÉSEAU (le `.mmtf` du RCSB),
   il pouvait s'afficher AVANT — ou À LA PLACE de — la vraie structure. C'est
   exactement ce que décrit le rapport : une protéine étrangère d'abord, la
   bonne « parfois, après un moment ».

   LA RÈGLE MAINTENANT : la page ne fabrique RIEN. La source du viewer est
   celle que le DATASET déclare — `structureSrc` (un code PDB, une URL, un
   fichier local fourni par la page) ou son ancien nom `pdbId` (dizaines de
   datasets réels écrivent `structureSrc: "5IF1"`, `"4QVE"`, …) — et RIEN
   d'autre :

     * une expérience NEUVE est donc VIERGE (aucune structure par défaut) ;
     * un poste qui n'a pas (encore) le PDB d'un cluster le DIT par l'état
       vide du viewer, la restauration Drive et l'import du dossier de calcul
       (voir utils/dockingDeclaredFiles.js : les fichiers que le dataset
       déclare SONT re-téléchargés) — il ne montre plus une protéine étrangère
       à la place.

   La page NMR, elle, garde son GABARIT (`/structures/template_amino_acid.pdb`,
   documenté dans docs/DRIVE-MIRROR.md) : c'est une décision d'écran assumée,
   et ce module ne la concerne pas.

   PUR (aucun accès au DOM, au réseau ni à l'état) : vérifié par
   _docking_virgin_page_test.mjs.
   ========================================================================= */

/** Un code PDB du RCSB (1UBQ, 5if1…) : quatre caractères, le premier chiffre —
 *  la MÊME reconnaissance que la page NMR (`[0-9][A-Za-z0-9]{3}`). */
export const PDB_CODE_RE = /^[0-9][A-Za-z0-9]{3}$/;

/** Le service de modèles du RCSB (le `.mmtf` que NGL lit directement). */
export const RCSB_MODELS_URL = 'https://models.rcsb.org/';

/** Une source qui se charge TELLE QUELLE : URL du réseau, blob / data URL
 *  (fichier déposé sur la page) ou chemin absolu du site (`/structures/…`). */
export const isDirectStructureSrc = (value = '') => {
  const raw = String(value || '').trim();
  return /^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/');
};

/** L'URL du modèle RCSB d'un code PDB — le code est mis en majuscules, comme
 *  le dépôt. Un code invalide rend '' (rien à charger plutôt qu'une devinette). */
export const rcsbModelUrl = (code = '') => {
  const raw = String(code || '').trim();
  return PDB_CODE_RE.test(raw) ? `${RCSB_MODELS_URL}${raw.toUpperCase()}.mmtf` : '';
};

/**
 * La source de structure d'une expérience de docking — la SEULE autorité.
 *
 * @param {object} test  l'expérience (`activeTest`)
 * @returns {string}  '' quand le dataset ne déclare AUCUNE structure : la page
 *                    est vierge et le viewer ne charge rien de son côté.
 */
export const dockingStructureSrcOf = (test = {}) => {
  const raw = String(((test && test.structureSrc) || (test && test.pdbId) || '')).trim();
  if (!raw) return '';                    // ← PLUS de structure de démonstration
  if (isDirectStructureSrc(raw)) return raw;
  if (PDB_CODE_RE.test(raw)) return rcsbModelUrl(raw);
  return raw;                             // chemin relatif, nom de fichier…
};
