/* =========================================================================
   src/utils/sequenceNatures.js
   UNE NATURE, UN CHAMP — la répartition des séquences par nature chimique.

   Un fichier de structure peut contenir PLUSIEURS polymères de natures
   différentes : une protéine (chaîne A), un ADN (chaînes B · C), un ARN (D).
   Une lettre de séquence ne dit pas de quelle nature elle vient, et les pages
   NMR / MD / Docking ne rangeaient qu'UN seul texte — « proteinSequence » —
   où TOUT atterrissait : ouvrir un complexe protéine + ADN mettait donc la
   séquence de l'ADN dans la case « Proteins ».

   Ce module est LA table unique qui répartit les séquences par nature :
     • protein → `proteinSequence`   (le champ historique de l'application) ;
     • dna     → `nucleicSequences.dna` ;
     • rna     → `nucleicSequences.rna`.

   Il est PUR (aucun import, aucun React) : les trois pages ET les tests
   l'utilisent tel quel. La règle de lecture est rétro-compatible :
   1. le champ de la nature, s'il est rempli ;
   2. à défaut, un texte hérité de `proteinSequence` — mais SEULEMENT tant que
      la condition n'a jamais été classée (`nucleicSequences` absent) : une
      séquence d'ADN n'a rien à faire sous « Proteins », et un texte protéique
      n'a rien à faire sous « DNA ».
   ========================================================================= */

/** Les trois natures polymères de l'application, dans l'ordre d'affichage. */
export const SEQUENCE_NATURES = ['protein', 'dna', 'rna'];

/** Clé (sur la condition) du magasin des séquences nucléiques. */
export const NUCLEIC_SEQUENCES_KEY = 'nucleicSequences';

/** Clé (sur la condition) de ce que le DERNIER fichier chargé contenait —
 *  une petite description en lecture seule, pour l'explication à l'écran. */
export const STRUCTURE_NATURES_KEY = 'structureSeqNatures';

export const NATURE_LABELS = { protein: 'Proteins', dna: 'DNA', rna: 'RNA' };

/** Unité d'une longueur : des résidus pour une protéine, des nucléotides
 *  pour un ADN / un ARN. */
export const NATURE_UNITS = { protein: 'aa', dna: 'nt', rna: 'nt' };

const txt = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const normalizeMoleculeType = (moleculeType) => {
  const t = txt(moleculeType).trim().toLowerCase();
  return t || 'protein';
};

export const isNucleicType = (moleculeType) => {
  const t = normalizeMoleculeType(moleculeType);
  return t === 'dna' || t === 'rna';
};

export const isPolymerType = (moleculeType) => SEQUENCE_NATURES.includes(normalizeMoleculeType(moleculeType));

/** Le magasin des séquences nucléiques d'une condition (jamais null : les
 *  conditions créées avant la répartition n'en ont simplement pas). */
const storeOf = (test) => {
  const s = test && test[NUCLEIC_SEQUENCES_KEY];
  return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
};

/** La clé existe-t-elle AVEC un texte ? (une clé vide = « pas de séquence ») */
const stored = (store, key) => !!(store && typeof store[key] === 'string' && store[key]);

/** Ce texte est-il VRAIMENT une séquence de cette nature ? Sert à déplacer une
 *  séquence héritée vers son champ sans jamais toucher à une séquence
 *  protéique : « MKWV » n'est pas de l'ADN, « ACGT » / « ACGU » en sont. */
const looksNucleic = (value, moleculeType) => {
  const s = txt(value).toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return false;
  return normalizeMoleculeType(moleculeType) === 'dna'
    ? /^[ACGTN]+$/.test(s)
    : /^[ACGUN]+$/.test(s);
};

/** Le texte affiché / utilisé pour une nature : le champ de CETTE nature, sinon
 *  l'héritage historique (voir l'en-tête), sinon rien. */
export const sequenceForMoleculeType = (test, moleculeType) => {
  const t = normalizeMoleculeType(moleculeType);
  const legacy = txt(test && test.proteinSequence);
  if (!isNucleicType(t)) return legacy;
  const store = storeOf(test);
  if (stored(store, t)) return store[t];
  // Deux cas opposés, jamais confondus :
  //   • aucune nature n'a encore été classée (pas de magasin) : le texte de
  //     `proteinSequence` EST celui de cette condition (champ unique d'avant) ;
  //   • les natures ont été classées : une case vide dit la vérité — ce
  //     fichier-là ne contient pas cette nature.
  return store ? '' : legacy;
};

/** Le patch d'écriture quand l'utilisateur tape dans la case de la nature
 *  courante : chaque nature écrit dans SON champ. */
export const sequencePatchForMoleculeType = (test, moleculeType, value) => {
  const t = normalizeMoleculeType(moleculeType);
  const next = txt(value);
  if (!isNucleicType(t)) return { proteinSequence: next };
  const store = storeOf(test);
  const patch = { [NUCLEIC_SEQUENCES_KEY]: { ...(store || {}), [t]: next } };
  // Une condition ancienne gardait sa séquence d'ADN / d'ARN dans
  // `proteinSequence` : la modifier la DÉPLACE dans le champ de sa nature
  // (même texte, place honnête) — la case « Proteins » cesse de montrer des
  // lettres d'acide nucléique. Une VRAIE séquence protéique, elle, est
  // préservée : seuls des caractères d'acide nucléique sont déplacés.
  const legacyText = txt(test && test.proteinSequence);
  const wasLegacy = !stored(store, t) && looksNucleic(legacyText, t);
  if (wasLegacy) patch.proteinSequence = '';
  return patch;
};

/** La séquence d'UNE nature venue du viewer : `parts` =
 *  `{ protein: { seq, chains }, dna: {…}, rna: {…} }` (les natures absentes du
 *  fichier sont vides). Toujours en majuscules, sans espaces. */
const partSeqOf = (parts, nature) => {
  const p = parts && parts[nature];
  if (!p) return '';
  return txt(p.seq).toUpperCase().replace(/[^A-Z]/g, '');
};

const partChainsOf = (parts, nature) => {
  const p = parts && parts[nature];
  const list = p && Array.isArray(p.chains) ? p.chains : [];
  return list.map((c) => txt(c).trim()).filter(Boolean);
};

/** Le patch d'écriture déclenché par un fichier qui vient d'être ouvert.
 *
 *  C'est ICI que la demande est satisfaite : la séquence d'un acide nucléique
 *  va dans SA case (DNA / RNA) et celle de la protéine reste dans la sienne.
 *  Rien n'est écrasé — un champ déjà rempli par l'utilisateur reste maître —
 *  et un champ n'est servi QUE sur une condition polymère (un SMILES, un sucre
 *  ou un lipide n'a pas de séquence).
 *
 *  Renvoie `null` quand il n'y a rien à écrire. Le 4e argument est OPTIONNEL :
 *  sans lui (viewer ancien, fichier illisible) on retombe exactement sur le
 *  comportement historique — tout le texte dans `proteinSequence`. */
export const structureSequencePatch = (test, moleculeType, seq, parts) => {
  const t = normalizeMoleculeType(moleculeType);
  if (!isPolymerType(t)) return null;
  const cur = test || {};
  const partOf = {
    protein: partSeqOf(parts, 'protein'),
    dna: partSeqOf(parts, 'dna'),
    rna: partSeqOf(parts, 'rna'),
  };
  const classified = !!(partOf.protein || partOf.dna || partOf.rna);

  if (!classified) {
    const whole = txt(seq).toUpperCase().replace(/[^A-Z]/g, '');
    if (!whole || txt(cur.proteinSequence)) return null;
    return { proteinSequence: whole };
  }

  const patch = {};
  if (partOf.protein && !txt(cur.proteinSequence)) patch.proteinSequence = partOf.protein;

  const before = storeOf(cur);
  const store = { ...(before || {}) };
  ['dna', 'rna'].forEach((k) => {
    if (partOf[k] && !stored(store, k)) store[k] = partOf[k];
  });
  if (stored(store, 'dna') !== stored(before, 'dna') || stored(store, 'rna') !== stored(before, 'rna')) {
    patch[NUCLEIC_SEQUENCES_KEY] = store;
  }

  // Ce que le fichier contenait (lecture seule) : la page s'en sert pour dire
  // à l'écran OÙ chaque séquence est allée, et que le viewer, lui, montre
  // toujours le fichier entier dans UNE seule vue 3D.
  const natures = {};
  SEQUENCE_NATURES.forEach((k) => {
    if (!partOf[k]) return;
    natures[k] = { len: partOf[k].length, chains: partChainsOf(parts, k) };
  });
  const beforeNatures = cur[STRUCTURE_NATURES_KEY];
  if (JSON.stringify(beforeNatures || null) !== JSON.stringify(natures)) {
    patch[STRUCTURE_NATURES_KEY] = natures;
  }
  return Object.keys(patch).length ? patch : null;
};

/** La phrase qui explique où chaque nature est rangée (ou `null` quand il n'y
 *  a rien à expliquer : un fichier d'une seule nature, celle de la case). */
export const sequenceNaturesNote = (test, moleculeType) => {
  const t = normalizeMoleculeType(moleculeType);
  const n = test && test[STRUCTURE_NATURES_KEY];
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  const present = SEQUENCE_NATURES.filter((k) => n[k] && (Number(n[k].len) > 0 || partChainsOf(n, k).length));
  if (!present.length) return null;
  const describe = (k) => {
    const chains = partChainsOf(n, k);
    const head = `${NATURE_LABELS[k]} (${Number(n[k].len) || 0} ${NATURE_UNITS[k]})`;
    return chains.length ? `${head} · chain${chains.length > 1 ? 's' : ''} ${chains.join(', ')}` : head;
  };
  const list = present.map(describe).join(' · ');
  if (present.length > 1) {
    return `🧬 This file contains ${list}. Each nature's 1-letter sequence is kept in its own field — `
      + `proteins under Proteins, nucleic acids under DNA / RNA — while the 3D viewer keeps showing `
      + `the whole file in the same view.`;
  }
  if (present[0] === t) return null;   // une seule nature, déjà affichée ici
  return `🧬 This file contains ${list} — it is not a ${NATURE_LABELS[t] || t} sequence. `
    + `Click ${NATURE_LABELS[present[0]]} to see and edit it: the viewer shows the file as it is, `
    + `with all its molecules in the same view.`;
};
