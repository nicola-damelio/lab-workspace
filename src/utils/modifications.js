/* =========================================================================
   src/utils/modifications.js — LA TABLE DES MODIFICATIONS D'UN COMPOSÉ, ET SON LECTEUR.

   POURQUOI CE MODULE EXISTE (la table et le lecteur viennent de utils/sequenceInfo.js) — ce
   sont des fonctions PURES, mais elles vivaient dans un module qui importe en TÊTE un fichier
   .JSX (`components/DefinitionsExtra`, pour peser une formule chimique) : aucun module pur ne
   pouvait donc lire un texte de modifications sans traîner du JSX avec lui, ni un test le
   vérifier sous node. Ici la SEULE dépendance est INJECTÉE — `formulaMassOf`, la fonction qui
   pèse une formule écrite à la place d'un nom (une modification « C2H3O ») : sans elle, une
   modification inconnue vaut delta 0 et `known: false` (rien n'est deviné, exactement comme
   avant quand la formule n'était pas lisible).
   ⚠ `utils/sequenceInfo.js` RÉEXPORTE `MODIFICATIONS`, `parseModifications` et
   `modificationMass` en liant sa fonction de pesée : le reste de l'application ne voit aucune
   différence, et cette table n'existe qu'UNE fois dans le dossier.
   ========================================================================= */

export const MODIFICATIONS = [
  { id: 'acetylation', label: 'Acetylation', delta: 42.0106, aliases: ['ac', 'acetyl'] },
  { id: 'acylation', label: 'Acylation', delta: 42.0106, aliases: ['acyl'] },
  { id: 'phosphorylation', label: 'Phosphorylation', delta: 79.9664, aliases: ['phos', 'p'] },
  { id: 'amidation', label: 'Amidation', delta: -0.984, aliases: ['amide', 'nh2'] },
  { id: 'methylation', label: 'Methylation', delta: 14.0157, aliases: ['me'] },
  { id: 'dimethylation', label: 'Dimethylation', delta: 28.0313, aliases: ['me2'] },
  { id: 'trimethylation', label: 'Trimethylation', delta: 42.047, aliases: ['me3'] },
  { id: 'formylation', label: 'Formylation', delta: 27.9949, aliases: ['formyl'] },
  { id: 'succinylation', label: 'Succinylation', delta: 100.016, aliases: ['succinyl'] },
  { id: 'palmitoylation', label: 'Palmitoylation', delta: 238.2297, aliases: ['palmitoyl'] },
  { id: 'biotinylation', label: 'Biotinylation', delta: 226.0779, aliases: ['biotin'] }
];

export const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

/** LE LECTEUR D'UN TEXTE DE MODIFICATIONS — « Amidation:2, Phos x 3 » devient UNE ENTRÉE PAR
    UNITÉ, `{ label, delta, known }`, le libellé étant celui de la table (donc canonique : un
    alias, une casse ou un séparateur ne changent que la reconnaissance, jamais le libellé
    rendu). Une entrée inconnue reste dans la liste avec son texte pour libellé et delta 0 —
    un « Acetylation » mal orthographié ne peut donc pas retirer une charge. */
export const parseModificationsOf = (input = '', { formulaMassOf = null } = {}) => {
  if (!input) return [];

  return String(input)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((token) => {
      // Improved regex to catch multipliers even with spaces, e.g. "Amidation: 2" or "Phos x 3"
      const match = token.match(/^(.*?)(?:[:*x]\s*(\d+))?$/i);
      const rawName = (match?.[1] || token).trim();
      const parsedCount = parseInt(match?.[2] || '1', 10);
      const count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 1;

      const norm = normalizeKey(rawName);

      const found = MODIFICATIONS.find((m) => {
        const idNorm = normalizeKey(m.id);
        const labelNorm = normalizeKey(m.label);
        const aliasNorms = (m.aliases || []).map(normalizeKey);
        return idNorm === norm || labelNorm === norm || aliasNorms.includes(norm);
      });

      let delta = 0;
      let known = false;
      let label = rawName;

      if (found) {
        delta = found.delta;
        known = true;
        label = found.label;
      } else if (typeof formulaMassOf === 'function') {
        // Fallback: a custom chemical formula (e.g. C2H3O) is weighed as the modification.
        const formulaMw = formulaMassOf(rawName);
        if (formulaMw && !isNaN(parseFloat(formulaMw))) {
          delta = parseFloat(formulaMw);
          known = true;
        }
      }

      return Array.from({ length: count }, () => ({
        label,
        delta,
        known
      }));
    });
};

/** LE POIDS TOTAL DES MODIFICATIONS — la somme des deltas, une unité à la fois. */
export const modificationMassOf = (mods = []) => mods.reduce((sum, m) => sum + (Number(m.delta) || 0), 0);
