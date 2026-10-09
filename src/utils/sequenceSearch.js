/* =========================================================================
   src/utils/sequenceSearch.js
   RECHERCHER UN MORCEAU DE SÉQUENCE DANS LA STRUCTURE CHARGÉE.

   La demande, mot pour mot : « nel viewer sarebbe utile dentro la barra
   analysis un modo per cercare pezzi di sequenza, ad esempio cerco la
   sequenza MHEF dentro la sequenza della proteina. se lanciato deve
   selezionare quella parte della proteina. »

   Ce module ne connaît QUE des résidus déjà lus (un code 1 lettre par
   résidu) : il ne parle ni de NGL, ni du DOM, ni d'un fichier. C'est ce qui
   permet de le vérifier sous node — la fenêtre 3D, elle, ne fait que
   PEINDRE le résultat (une représentation sur les résidus trouvés + la
   caméra cadrée dessus).

   Les trois règles tenues ici :

     • LA CASSE ET LES BLANCS NE COMPTENT PAS — on tape `mhef`, `MHEF` ou
       `M H E F`, c'est la même recherche (une séquence se copie souvent d'un
       article, coupée par des espaces ou des sauts de ligne) ;
     • `X` EST « N'IMPORTE QUEL RÉSIDU » — la lettre attrape un résidu dont
       le nom n'est pas résolu dans le fichier (une mutation, un résidu
       incomplet). Un `X` du fichier est, lui aussi, trouvé : la règle est
       « ce résidu convient », pas « ce résidu est la lettre X » ;
     • LES RÉSIDUS D'UNE CHAÎNE SONT LUS DANS L'ORDRE DU FICHIER, et une
       correspondance ne traverse JAMAIS deux chaînes (deux chaînes
       différentes ne sont pas une seule séquence).

   Les numéros rendus sont ceux DU FICHIER (`resno`), jamais une position
   1…N : c'est le numéro qu'un lecteur retrouve dans sa publication, et celui
   que la clause de sélection NGL utilise pour allumer les bons résidus.
   ========================================================================= */

/** Combien de correspondances sont rapportées au plus (une séquence courte
    répétée des centaines de fois ne doit pas figer la fenêtre). */
export const SEQUENCE_SEARCH_LIMIT = 200;

const text = (v) => (v === undefined || v === null ? '' : String(v));
const asList = (v) => (Array.isArray(v) ? v : []);

/** La requête telle qu'on la compare : majuscules, lettres seulement. PUR. */
export const normalizeSequenceQuery = (raw) =>
  text(raw).toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Les résidus d'une structure, tels que la bande de séquence du viewer les
 * connaît déjà (`collectResidueTicks`) : `[{ resno, code, polymer, chainname,
 * chainid, … }]`. On ne garde QUE les résidus de polymère (protéine, ADN,
 * ARN — ceux qui portent un code 1 lettre) : l'eau, les ions et les lipides
 * ne font pas partie d'une séquence. PUR.
 *
 * @param {Array<object>} ticks
 * @returns {Array<{code:string,chain:string,resno:number,ri:number,tickIndex:number}>}
 */
export const residuesOfTicks = (ticks) => {
  const out = [];
  asList(ticks).forEach((t, tickIndex) => {
    if (!t || !t.polymer) return;
    const code = normalizeSequenceQuery(t.code);
    if (code.length !== 1) return;
    const resno = Number(t.resno);
    if (!Number.isFinite(resno)) return;
    out.push({
      code,
      // Le NOM de chaîne (A · B · C) quand le fichier en porte un : `chainid`
      // est l'INDEX interne de NGL, que la clause de sélection NGL ne lit pas.
      chain: text(t.chainname) || text(t.chainid),
      resno,
      ri: resno - 1,
      tickIndex
    });
  });
  return out;
};

/** La requête correspond-elle au résidu `code`, à la position `i` du motif ?
    `X` du motif = n'importe quel résidu. PUR. */
const motifFits = (query, code, i) => query[i] === 'X' || query[i] === code;

/**
 * TOUTES les correspondances de `query` dans les résidus donnés. PUR.
 *
 * Chaque correspondance est rendue en INDICES de la liste reçue
 * (`indexStart`/`indexEnd`) — l'appelant retrouve ses résidus par ces
 * indices — avec ses numéros de fichier (`resnos`) et sa longueur. Les
 * correspondances ne se chevauchent pas (le curseur reprend après la
 * dernière trouvée : `AAAA` contient UNE fois `AAA`, pas deux).
 *
 * @param {Array<{code:string,chain:string,resno:number}>} residues
 * @param {string} rawQuery
 * @returns {{query:string,searched:number,chains:string[],matches:Array<object>,
 *           truncated:boolean,limit:number}}
 */
export const findSequenceMatches = (residues, rawQuery, { limit = SEQUENCE_SEARCH_LIMIT } = {}) => {
  const list = asList(residues).filter((r) => r && normalizeSequenceQuery(r.code).length === 1);
  const query = normalizeSequenceQuery(rawQuery);
  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : SEQUENCE_SEARCH_LIMIT;
  const out = {
    query,
    searched: list.length,
    chains: [...new Set(list.map((r) => text(r.chain)))],
    matches: [],
    truncated: false,
    limit: max
  };
  if (!query || query.length > list.length) return out;

  /* Les résidus d'une MÊME chaîne, dans l'ordre du fichier : un motif ne
     traverse jamais deux chaînes. */
  const byChain = new Map();
  list.forEach((r, i) => {
    const key = text(r.chain);
    if (!byChain.has(key)) byChain.set(key, []);
    byChain.get(key).push(i);
  });

  for (const [chain, indices] of byChain) {
    for (let s = 0; s + query.length <= indices.length; s += 1) {
      let fits = true;
      for (let k = 0; k < query.length; k += 1) {
        if (!motifFits(query, text(list[indices[s + k]].code), k)) { fits = false; break; }
      }
      if (!fits) continue;
      const hit = indices.slice(s, s + query.length);
      const first = list[hit[0]];
      const last = list[hit[hit.length - 1]];
      out.matches.push({
        chain,
        indexStart: hit[0],
        indexEnd: hit[hit.length - 1],
        riStart: Number(first.ri),
        riEnd: Number(last.ri),
        resnoStart: first.resno,
        resnoEnd: last.resno,
        resnos: hit.map((i) => list[i].resno),
        indexes: hit,
        size: hit.length
      });
      if (out.matches.length >= max) { out.truncated = true; return out; }
      s += query.length - 1;   // pas de recouvrement
    }
  }
  return out;
};

/** Des numéros de résidus en RANGÉES (`12-15 · 31`). PUR. */
export const resnoRangeText = (resnos) => {
  const nums = asList(resnos).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return '';
  const runs = [];
  let start = nums[0];
  let prev = nums[0];
  nums.slice(1).forEach((n) => {
    if (n === prev + 1) { prev = n; return; }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  });
  runs.push(start === prev ? `${start}` : `${start}-${prev}`);
  return runs.join(' · ');
};

/** L'étiquette d'UNE correspondance — `A 12-15`. PUR. */
export const matchLabel = (match) => {
  if (!match) return '';
  const range = resnoRangeText(match.resnos);
  return [text(match.chain), range].filter(Boolean).join(' ');
};

/** Ce qu'on dit à l'écran après une recherche (une phrase, jamais un silence :
    « rien trouvé » est une réponse). PUR. */
export const matchesSummaryText = (result, { shown = 6 } = {}) => {
  const r = result && typeof result === 'object' ? result : {};
  const query = text(r.query);
  if (!query) return 'Type a sequence (one-letter code) to search.';
  if (!r.searched) return 'Load a structure first: there is no residue to search in.';
  const matches = asList(r.matches);
  if (!matches.length) {
    const chains = asList(r.chains).filter(Boolean);
    return `${query}: no match in the ${r.searched} residue(s) of this structure`
      + (chains.length ? ` (chain${chains.length > 1 ? 's' : ''} ${chains.join(', ')})` : '') + '.';
  }
  const labels = matches.slice(0, shown).map(matchLabel).filter(Boolean);
  const more = matches.length - labels.length;
  return `${query}: ${matches.length} match${matches.length > 1 ? 'es' : ''} — ${labels.join(' · ')}`
    + (more > 0 ? ` (+${more} more)` : '')
    + (r.truncated ? ` · stopped at ${r.limit}` : '');
};
