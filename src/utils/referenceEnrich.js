/* =========================================================================
   src/utils/referenceEnrich.js
   COMPLÉTER UNE RÉFÉRENCE INCOMPLÈTE.

   Ce que l'utilisateur demande : « l'information incomplète de la référence
   (auteurs, titre manquants…) n'est pas reconstruite quand j'importe les
   références ». Une bibliographie de fin d'article, un export RIS tronqué, un
   copier-coller de PDF donnent souvent une entrée à qui il manque les AUTEURS
   ou le TITRE — et une entrée sans auteurs ne s'imprime pas.

   Deux sources, dans cet ordre, JAMAIS destructives (elles ne remplissent que
   les champs VIDES, comme fillMissingFields) :

     1. LE POT COMMUN DU LABORATOIRE (publications du scientifique, « Relevant
        papers ») : hors ligne, instantané. Une entrée reconnue par sa
        publication d'origine (sourceId, DOI, identifiant PubMed, sinon titre
        exact) récupère la liste COMPLÈTE de ses auteurs et ses références
        bibliographiques — c'est pubCitationData qui tranche, la même règle que
        le rendu des citations ;
     2. CROSSREF (api.crossref.org, sans clé, CORS ouvert) quand il manque
        encore quelque chose : par DOI quand l'entrée en a un, sinon par
        recherche bibliographique sur le titre. Le titre trouvé doit
        correspondre (titre normalisé identique, ou l'un contient l'autre) —
        jamais une entrée inventée, jamais un autre papier.

   Une liste d'auteurs RÉDUITE N'EST PAS UNE LISTE REMPLIE. « Fumano, et al. »
   dit seulement que l'article a d'autres auteurs : la référence a donc un
   champ à chercher (voir authorsShortened / referenceGaps). C'est la deuxième
   plainte : « avec un seul auteur, tu me dis que l'information est complète —
   cherche les autres auteurs, le DOI, le volume ». Une liste trouvée ne
   remplace la liste réduite que si elle commence par le MÊME premier auteur et
   compte plus de noms (voir mergeFound).

   `all: true` (les imports et le bouton « ✨ Complete missing fields ») cherche
   TOUS les champs qui manquent — DOI, volume, pages, revue, année — et pas
   seulement les auteurs ou le titre : c'est ce qui fait qu'une référence
   entrée avec son seul titre en ressort complète.

   Rien n'est jamais écrasé : un champ déjà rempli (corrigé à la main, choisi
   dans une liste) reste tel quel. Une panne de réseau n'empêche rien : les
   recherches en ligne s'arrêtent après deux échecs et la référence rentre
   simplement telle qu'elle était.

   Tout est PUR et injectable (`fetchImpl`, `pool`) : _reference_complete_test.mjs
   vérifie le même code sans réseau.
   ========================================================================= */

import { fillMissingFields } from './referenceImport.js';
import { pubCitationData, pubOriginOf } from '../components/pubCitation.js';
/* La convention d'écriture des auteurs (voir utils/authorNames.js) : les
   sources web rendent « Smith JA », jamais « John A. Smith ». */
import { authorsFromParts } from './authorNames.js';

/** Les champs qui rendent une citation utilisable, dans l'ordre d'importance. */
export const REFERENCE_COMPLETION_FIELDS = [
  'authors', 'title', 'journal', 'year', 'volume', 'pages', 'doi', 'pmid'
];

const value = (entry, key) => String((entry && entry[key]) || '').trim();

/** Un marqueur de liste d'auteurs RÉDUITE : « Fumano, et al. », « and others »… */
export const SHORTENED_AUTHOR_RE = /(?:\bet\.?\s*al\.?|and\s+others|&\s*others)\b/i;

/** La liste d'auteurs d'une entrée est-elle RÉDUITE ? « Fumano, et al. » n'est
 *  PAS un champ rempli : c'est un champ à chercher. La bibliographie d'un
 *  article coupait la liste (le style de la revue le demandait), et la référence
 *  gardait un seul nom — l'utilisateur ne voyait donc ni ses co-auteurs, ni
 *  l'ordre réel des noms : « tu me dis que l'information est complète alors
 *  qu'il n'y a qu'un auteur ». */
export const authorsShortened = (authors) => SHORTENED_AUTHOR_RE.test(String(authors || ''));

/** La liste d'auteurs d'une entrée est-elle INCOMPLÈTE ? Vide (papier ajouté à
 *  la main, import ancien) ou RÉDUITE par un marqueur « et al. » — « Fumano,
 *  et al. » n'est PAS une liste remplie. C'est exactement ce que cherche un
 *  bouton « ⟳ Complete author lists » : signalé dans les « Relevant papers » et
 *  la bibliographie des projets, où la liste complète de la publication
 *  manquait (« do not find all authors of the publication »). */
export const authorsIncomplete = (entry) => !value(entry, 'authors') || authorsShortened(value(entry, 'authors'));

/** Les champs VIDES d'une référence (dans l'ordre ci-dessus). Une liste
 *  d'auteurs RÉDUITE compte comme un champ à remplir : c'est exactement le cas
 *  où l'utilisateur attend qu'on cherche les co-auteurs, le DOI et le volume
 *  manquants. */
export const referenceGaps = (entry) => REFERENCE_COMPLETION_FIELDS.filter((k) => (
  !value(entry, k) || (k === 'authors' && authorsShortened(value(entry, k)))
));

/** Une référence a-t-elle besoin d'être complétée ? Par défaut « il manque les
 *  AUTEURS (ou la liste est coupée par un « et al. ») ou le TITRE » — les deux
 *  champs sans lesquels la citation ne dit rien. Le bouton « ✨ Complete missing
 *  fields » et les imports demandent TOUS les champs vides (`all: true`). */
export const referenceNeedsCompletion = (entry, { all = false } = {}) => {
  if (!entry || typeof entry !== 'object') return false;
  if (all) return referenceGaps(entry).length > 0;
  return authorsIncomplete(entry) || !value(entry, 'title');
};

/** Deux titres parlent-ils du même papier ? (casse, ponctuation, HTML, accents
 *  HTML ignorés ; un titre plus long reconnu quand il contient l'autre). */
export const sameTitle = (a, b) => {
  const key = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length < 24 || kb.length < 24) return false;
  return ka.includes(kb) || kb.includes(ka);
};

/** Le nom de famille de la PREMIÈRE autrice d'une liste (« Rossi M, Bianchi A »
 *  → « rossi », « Marco Rossi » → « marco »). */
const firstSurname = (authors) => {
  const words = String(authors || '')
    .split(/\s*[,;]\s*/)[0]
    .split(/\s+/)
    .map((w) => w.replace(/[.]/g, ''))
    .filter(Boolean);
  const long = words.filter((w) => w.length >= 3);
  return (long[0] || words[0] || '').toLowerCase();
};

/* ── 0. Ce qu'une source complète remplace ───────────────────────────────── */

/** Le nombre de NOMS d'une liste d'auteurs, marqueurs « et al. » exclus
 *  (« Marco Rossi, Anna Bianchi » → 2 ; « Fumano, et al. » → 1). */
const authorCount = (authors) => String(authors || '')
  .split(/\s*[,;]\s*/)
  .map((n) => n.trim())
  .filter((n) => n && !SHORTENED_AUTHOR_RE.test(n)).length;

/** Les mots (3 lettres et plus) du PREMIER nom d'une liste, sans accents ni
 *  ponctuation : « Fumano, et al. » → ['fumano'], « Marco Fumano » → ['marco',
 *  'fumano'], « Rossi M » → ['rossi']. */
const firstAuthorWords = (authors) => String(authors || '')
  .split(/\s*[,;]\s*/)[0]
  .toLowerCase()
  .replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/)
  .filter((w) => w.length >= 3);

/** Deux listes parlent-elles du MÊME premier auteur ? Les deux écritures de
 *  l'application coexistent (« Rossi M » comme PubMed, « Marco Rossi » comme
 *  Crossref) : le premier nom doit donc PARTAGER un mot — « Fumano, et al. » et
 *  « Marco Fumano » se reconnaissent par « fumano ». */
const sameFirstAuthor = (a, b) => {
  const wa = firstAuthorWords(a);
  const wb = firstAuthorWords(b);
  return wa.some((w) => wb.indexOf(w) !== -1);
};

/** Les champs qui ont VRAIMENT changé (remplis, ou liste d'auteurs remplacée). */
export const filledFields = (before, after) => REFERENCE_COMPLETION_FIELDS
  .filter((k) => value(after, k) && value(before, k) !== value(after, k));

/**
 * Recopie dans `entry` ce que la source (`found`) connaît et qui MANQUE — en
 * remplaçant au passage une liste d'auteurs RÉDUITE par la liste COMPLÈTE.
 *
 * C'est la seule exception à « un champ déjà rempli n'est jamais écrasé » :
 * « Fumano, et al. » n'est pas une valeur choisie, c'est une liste coupée. La
 * liste trouvée doit être complète, compter PLUS de noms que celle de l'entrée
 * et commencer par le même premier auteur — sinon rien n'est touché : aucun nom
 * inventé, aucun papier remplacé par un autre.
 *
 * @returns {{ entry:object, filled:string[] }}
 */
export const mergeFound = (entry, found, keys = REFERENCE_COMPLETION_FIELDS) => {
  const e = entry && typeof entry === 'object' ? entry : {};
  const f = found && typeof found === 'object' ? found : {};
  let next = fillMissingFields(e, f, keys);
  const current = value(e, 'authors');
  const complete = value(f, 'authors');
  if (authorsShortened(current) && complete
      && !authorsShortened(complete)
      && authorCount(complete) > authorCount(current)
      && sameFirstAuthor(complete, current)) {
    next = next === e ? { ...e } : next;
    next.authors = complete;
  }
  const filled = filledFields(e, next);
  return { entry: filled.length ? next : e, filled };
};

/* ── 1. Le pot commun du laboratoire (hors ligne) ─────────────────────────── */

/**
 * Complète une entrée depuis les publications du laboratoire / « Relevant
 * papers » (voir pubCitationData : identifiant, DOI, identifiant PubMed, titre).
 * @returns {{ entry:object, filled:string[] }} `filled` = champs remplis (vide
 *          quand rien n'était trouvable — rien n'est inventé).
 */
export const completeFromPool = (entry, pool = []) => {
  const list = (Array.isArray(pool) ? pool : []).filter((p) => p && typeof p === 'object');
  if (!entry || typeof entry !== 'object' || list.length === 0) return { entry, filled: [] };
  const data = pubCitationData(entry, list);
  /* `pubCitationData` laisse GAGNER les champs de l'entrée — une correction à la
     main n'est jamais écrasée. Mais une liste d'auteurs RÉDUITE n'est pas une
     correction : la publication du laboratoire, elle, connaît la liste
     COMPLÈTE de ses auteurs, et c'est elle qui doit servir (voir mergeFound). */
  const origin = pubOriginOf(entry, list) || {};
  const source = authorsShortened(entry.authors)
    ? { ...data, authors: origin.authors || data.authors }
    : data;
  return mergeFound(entry, source);
};

/* ── 2. Crossref (en ligne) ───────────────────────────────────────────────── */

/** Un « work » Crossref → la forme des références du programme (la même que
 *  searchCrossref de Publications.jsx : « Prénom Nom », liste complète).
 *  LES DEUX MORCEAUX SÉPARÉS DE CROSSREF SONT GARDÉS TELS QUELS (« given »,
 *  « family ») : la liste sort dans la convention du laboratoire — « Smith JA »,
 *  pas « John A. Smith » —, donc une citation ne garde plus l'écriture de la
 *  revue d'origine (voir utils/authorNames.js). */
export const crossrefReference = (item) => {
  const it = item || {};
  const year = it.issued?.['date-parts']?.[0]?.[0];
  return {
    title: (it.title && it.title[0]) || '',
    authors: authorsFromParts(it.author),
    journal: (it['container-title'] && it['container-title'][0]) || '',
    year: year ? String(year) : '',
    volume: it.volume || '',
    pages: it.page || '',
    doi: it.DOI || ''
  };
};

const CROSSREF_SELECT = 'DOI,title,author,container-title,issued,volume,page,type';

/** La requête Crossref qui doit répondre à cette entrée : le DOI quand elle en
 *  a un (réponse exacte), sinon une recherche bibliographique sur le titre.
 *  PUR : rend `{ url, pick(json) }` — `pick` ne rend JAMAIS un autre papier. */
export const crossrefRequestFor = (entry) => {
  const e = entry || {};
  const doi = String(e.doi || '').trim() || (/10\.\d{4,9}\/\S+/.exec(String(e.link || '')) || [])[0] || '';
  if (doi) {
    return {
      url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      pick: (json) => {
        const item = json && json.message;
        return item && (item.DOI || item.title) ? crossrefReference(item) : null;
      }
    };
  }
  const title = String(e.title || '').trim();
  if (!title) return null;
  return {
    url: `https://api.crossref.org/works?rows=5&select=${CROSSREF_SELECT}`
      + `&query.bibliographic=${encodeURIComponent(title)}`,
    pick: (json) => {
      const items = (json && json.message && json.message.items) || [];
      const wanted = firstSurname(e.authors);
      const hits = items.map(crossrefReference).filter((r) => r.title && sameTitle(r.title, title));
      if (!hits.length) return null;
      /* À titre égal, celui dont le premier auteur est celui de l'entrée : le
         même titre existe en preprint, en erratum et en version publiée. */
      const preferred = wanted ? hits.find((r) => firstSurname(r.authors) === wanted) : null;
      return preferred || hits[0];
    }
  };
};

/** Les champs que Crossref est appelé à remplir pour cette entrée : tous ceux
 *  qui manquent, ET la liste d'auteurs quand elle est réduite (« et al. ») —
 *  c'est ce qui fait chercher les co-auteurs, le DOI et le volume d'une
 *  référence qui n'avait que son premier nom. */
const crossrefFields = (entry) => referenceGaps(entry);

/** Le service n'a pas répondu à temps : sans cela un import resterait bloqué
 *  sur un réseau lent. */
const withTimeout = (promise, ms) => {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('the bibliographic service did not answer in time')), ms);
    })
  ]).finally(() => clearTimeout(timer));
};

/**
 * Complète une entrée depuis Crossref (par DOI, sinon par titre).
 * @returns {{ entry:object, filled:string[], failed:boolean }} `failed` = le
 *          service n'a pas répondu (réseau coupé) : l'appelant peut arrêter.
 */
export const completeFromCrossref = async (entry, { fetchImpl = null, timeoutMs = 8000 } = {}) => {
  const request = crossrefRequestFor(entry);
  if (!request || !crossrefFields(entry).length) return { entry, filled: [], failed: false };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { entry, filled: [], failed: true };
  try {
    const res = await withTimeout(doFetch(request.url, {
      headers: { Accept: 'application/json' }
    }), timeoutMs);
    if (!res || res.ok === false) return { entry, filled: [], failed: false };
    const json = await res.json();
    const found = request.pick(json);
    if (!found) return { entry, filled: [], failed: false };
    const merged = mergeFound(entry, found);
    return { entry: merged.entry, filled: merged.filled, failed: false };
  } catch {
    return { entry, filled: [], failed: true };
  }
};

/* ── 3. Le travail complet, entrée par entrée ─────────────────────────────── */

/**
 * Complète UNE référence : pot commun du laboratoire d'abord (hors ligne),
 * Crossref ensuite s'il manque encore quelque chose.
 *
 * `all` — true = chercher TOUS les champs qui manquent (DOI, volume, pages,
 * revue, année) et pas seulement les auteurs ou le titre. C'est ce que
 * demandent les imports et le bouton « ✨ Complete missing fields » : une
 * référence entrée avec son seul titre restait sans DOI ni volume parce que le
 * premier champ vide ne déclenchait pas la recherche en ligne.
 *
 * @returns {{ entry:object, filled:string[], sources:string[], failed:boolean }}
 */
export const enrichReference = async (entry, {
  pool = [], online = true, all = false, fetchImpl = null, timeoutMs = 8000
} = {}) => {
  const fromPool = completeFromPool(entry, pool);
  const filled = [...fromPool.filled];
  const sources = fromPool.filled.length ? ['the lab publications'] : [];
  let next = fromPool.entry;
  let failed = false;
  if (online && referenceNeedsCompletion(next, { all })) {
    const web = await completeFromCrossref(next, { fetchImpl, timeoutMs });
    failed = web.failed;
    if (web.filled.length) {
      /* Les champs déjà remplis par le pot commun gardent leur valeur. */
      web.filled.forEach((k) => { if (filled.indexOf(k) === -1) filled.push(k); });
      sources.push('Crossref');
      next = web.entry;
    }
  }
  return { entry: next, filled, sources, failed };
};

/**
 * Complète une LISTE de références (séquentiellement : les services
 * bibliographiques n'aiment pas les rafales).
 *
 * @param {Array} entries
 * @param {object} opts
 *   • `pool`   — publications du laboratoire / « Relevant papers » ;
 *   • `online` — false = hors ligne seulement ;
 *   • `all`    — true = chercher TOUS les champs qui manquent (auteurs coupés
 *                par un « et al. », DOI, volume, pages, revue, année) ; false =
 *                seulement les entrées auxquelles il manque les auteurs ou le
 *                titre. Les imports et le bouton manuel demandent `true` ;
 *   • `max`    — nombre maximum d'entrées travaillées en une fois (12 par
 *                défaut : un import ne doit pas attendre indéfiniment).
 * @returns {{ list:Array, completed:number, filled:Object, sources:Array,
 *             skipped:number, offline:boolean, stillShortened:number }}
 *          `stillShortened` = références dont la liste d'auteurs porte encore un
 *          « et al. » après la recherche : l'appelant le dit à l'utilisateur,
 *          qui complète ces co-auteurs à la main.
 */
export const enrichReferences = async (entries, {
  pool = [], online = true, all = false, max = 12, fetchImpl = null, timeoutMs = 8000
} = {}) => {
  const list = Array.isArray(entries) ? entries.map((e) => e) : [];
  const filled = {};
  const sources = new Set();
  let completed = 0;
  let skipped = 0;
  let attempts = 0;
  let failures = 0;
  let offline = false;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!referenceNeedsCompletion(entry, { all })) { skipped += 1; continue; }
    if (attempts >= max) { skipped += 1; continue; }
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop
    const res = await enrichReference(entry, {
      pool, online: online && !offline, all, fetchImpl, timeoutMs
    });
    if (res.failed) {
      failures += 1;
      /* Deux échecs de réseau d'affilée : hors ligne — on n'attend pas 12 fois. */
      if (failures >= 2) offline = true;
    }
    if (!res.filled.length) continue;
    list[i] = res.entry;
    completed += 1;
    res.filled.forEach((k) => { filled[k] = (filled[k] || 0) + 1; });
    res.sources.forEach((s) => sources.add(s));
  }
  return {
    list, completed, filled, sources: [...sources], skipped, offline,
    stillShortened: shortenedAuthorCount(list)
  };
};

/** Combien de références d'une liste portent encore une liste d'auteurs RÉDUITE
 *  (« Fumano, et al. ») — ce qu'un import ou le bouton de réparation dit à
 *  l'utilisateur quand rien, en ligne, ne complétait ces auteurs. */
export const shortenedAuthorCount = (entries) => (Array.isArray(entries) ? entries : [])
  .filter((e) => authorsShortened(value(e, 'authors'))).length;

/** Le compte rendu en une phrase du travail d'enrichReferences (une seule
 *  formulation pour l'import, le bouton et les tests). '' quand rien n'a été
 *  complété — l'appelant dit alors ce qu'il veut à la place. */
export const enrichReport = (result) => {
  const r = result || {};
  if (!r.completed) return '';
  const fields = Object.keys(r.filled || {})
    .sort((a, b) => (r.filled[b] || 0) - (r.filled[a] || 0))
    .slice(0, 4)
    .map((k) => `${k} (${r.filled[k]})`);
  return `✨ ${r.completed} reference(s) completed${fields.length ? ` — ${fields.join(', ')}` : ''}`
    + (r.sources && r.sources.length ? ` from ${r.sources.join(' + ')}` : '');
};
