// src/utils/authorNames.js
/* =========================================================================
   AUTHOR NAMES — « il programma non distingue tra nome e cognome degli autori
   ma li prende in blocco, con il risultato che se cito una pubblicazione a
   volte c'è nome e cognome e a volte solo cognome ed iniziali. Quindi la parte
   di autori rimane nel formato del giornale dove è stato pubblicato. »

   Le due cause, e i due rimedi:

   1. UN NOME D'AUTORE NON È UNA STRINGA QUALUNQUE. Gli editori lo scrivono in
      quattro modi — « Smith JA » (PubMed / Vancouver), « Smith, John A. »
      (Elsevier, RIS « AU - »), « John A. Smith » (Crossref, OpenAlex, ORCID —
      NOME COMPLETO), « J. A. Smith » — e una virgola separa ora DUE AUTORI ora
      il cognome dal nome. Questo modulo è l'unico posto che lo sa: `nameParts`
      rende `{ family, initials }`, `splitAuthorNames` taglia una lista senza
      spezzare un nome, `canonicalName` riscrive « John A. Smith » → « Smith JA »
      (la convenzione dell'applicazione: il cognome, poi le iniziali), e
      `formatAuthorName` lo rende nella forma che il GIORNALE chiede.

   2. LA FORMA È UNA SCELTA DEL FORMATO, NON DELLA RIVISTA D'ORIGINE. La forma
      dell'elenco (« Smith JA », « Smith J. A. », « J. A. Smith »,
      « Smith, J. A. ») viaggia con il « Publication format »
      (`format.nameStyle`, vedi components/pubCitation.js): ogni giornale porta
      la sua (vedi components/journalFormats.js) e il pannello la mostra —
      quindi cambiare giornale riscrive gli autori di TUTTE le citazioni, anche
      quelle importate con la forma di un'altra rivista. « as written » è il
      réglage di partenza: la citazione resta esattamente com'è sempre stata
      finché qualcuno non decide altrimenti.

   Module PUR (aucun import, aucun React) : les tests node l'importent, le
   navigateur le charge comme les autres utils, et utils/referenceImport.js
   s'en sert pour normaliser ce qu'il lit.
   ========================================================================= */

/* Une INITIALE : « M. », « M », « JA », « W.-J. », « A.-M. ». Elle ne doit
   jamais être prise pour un nom de famille. */
const INITIAL_TOKEN = /^(?:\p{Lu}\.?\s*-?\s*){1,4}$/u;
/* Les particules d'un nom de famille (« van der Berg », « de la Cruz ») : elles
   voyagent AVEC le nom, en minuscules, et ne sont donc jamais le nom tout seul. */
const PARTICLES = new Set([
  'af', 'al', 'bin', 'da', 'das', 'de', 'del', 'dell', 'della', 'delle', 'degli',
  'den', 'der', 'di', 'do', 'dos', 'du', 'el', 'ibn', 'la', 'le', 'mac', 'mc',
  'st', 'ten', 'ter', 'van', 'von', 'zu', 'zur'
]);
/* Les suffixes d'un nom (« Smith, John A., Jr. ») : ils ne sont pas des
   initiales et ne doivent pas en fabriquer une. */
const SUFFIX = /^(?:jr|sr|ii|iii|iv|v|phd|md|msc|bsc|prof|dr)\.?$/i;

const clean = (value) => String(value == null ? '' : value)
  .replace(/\s+/g, ' ')
  .replace(/^[\s,;.&]+/, '')
  .replace(/[\s,;.]+$/, '')
  .trim();

/* Comme `clean`, mais le POINT final est conservé : c'est lui qui distingue
   « Rossi M » (la convention du laboratoire, des initiales sans point) de
   « Rossi, M. » (l'écriture d'un éditeur) — voir `hasDottedInitial`. */
const trimEdges = (value) => String(value == null ? '' : value)
  .replace(/\s+/g, ' ')
  .replace(/^[\s,;&]+/, '')
  .replace(/[\s,;&]+$/, '')
  .trim();

const isInitialToken = (token) => !!token && INITIAL_TOKEN.test(token);
const isParticle = (token) => PARTICLES.has(String(token || '').toLowerCase().replace(/\.$/, ''));

/* Un morceau d'un prénom → ses initiales. « John » → « J » ; un morceau DÉJÀ
   réduit aux initiales (« JA », « MA ») est gardé tel quel — « Rossi MA » donne
   « Rossi MA », jamais « Rossi M ». */
const initialsOfToken = (token) => (/^\p{Lu}{2,}$/u.test(token) ? token : String(token || '')[0].toUpperCase());

/** « J. », « JA », « M.A. », « W.-J. » → « J », « JA », « MA », « W-J » (voir
 *  utils/referenceImport.js : la même règle y servait déjà aux bibliographies
 *  « texte », elle est ici la seule). Le TIRET relie deux initiales d'un même
 *  auteur (« Lu, W.-J. » → « Lu W-J ») : il ne sépare jamais deux auteurs. */
export const initialsOf = (given) => String(given || '')
  .trim()
  .split(/\s*-\s*/)
  .map((part) => part.split(/[\s.,;]+/).filter(Boolean).map(initialsOfToken).join(''))
  .filter(Boolean)
  .join('-');

/**
 * UN AUTEUR → `{ family, initials }`. La famille d'abord (elle est la seule
 * chose dont on soit sûr), puis les initiales.
 *
 *   « Smith, John A. »      → { family: 'Smith',        initials: 'JA' }
 *   « John A. Smith »       → { family: 'Smith',        initials: 'JA' }
 *   « J. A. Smith »         → { family: 'Smith',        initials: 'JA' }
 *   « Smith JA »            → { family: 'Smith',        initials: 'JA' }
 *   « Smith, John A., Jr. » → { family: 'Smith',        initials: 'JA' }  (suffixe écarté)
 *   « van der Berg, Jan »   → { family: 'van der Berg', initials: 'J'  }
 *   « Jan van der Berg »    → { family: 'van der Berg', initials: 'J'  }
 *   « EPPO »                → { family: 'EPPO',         initials: ''   }
 *
 * Rien n'est inventé : un auteur dont on ne sait rien sort tel qu'il est entré
 * (famille seule, sans initiales) — mieux vaut un nom nu qu'un faux nom.
 */
export const nameParts = (value) => {
  const raw = clean(value).replace(/^(?:and|et|&)\s+/i, '');
  if (!raw) return { family: '', initials: '' };
  /* Forme « Cognome, Nome » : la virgule tranche, et il n'y a rien à deviner. */
  const comma = raw.indexOf(',');
  if (comma > 0) {
    const family = raw.slice(0, comma).trim();
    const given = raw.slice(comma + 1).split(',')
      .map((part) => part.trim())
      .filter((part) => part && !SUFFIX.test(part))
      .join(' ');
    return { family, initials: initialsOf(given) };
  }
  const tokens = raw.split(' ').filter(Boolean);
  if (tokens.length === 1) return { family: raw, initials: '' };
  /* « Nom Initiales » (la convention de l'application, PubMed, Paperpile) : les
     initiales COLLÉES au nom, à la fin, sans autre mot derrière elles. */
  const tail = tokens[tokens.length - 1];
  if (isInitialToken(tail) && tokens.length >= 2) {
    const family = tokens.slice(0, -1).join(' ').replace(/[\s,;.]+$/, '');
    return { family, initials: initialsOf(tail) };
  }
  /* « Initiales Nom » (Elsevier, Harvard, Science). On écarte d'abord les
     initiales de tête, le reste EST le nom — particules comprises. */
  if (isInitialToken(tokens[0])) {
    let at = 0;
    while (at < tokens.length && isInitialToken(tokens[at])) at += 1;
    if (at < tokens.length) {
      return { family: tokens.slice(at).join(' '), initials: initialsOf(tokens.slice(0, at).join(' ')) };
    }
  }
  /* « Prénom Nom » (Crossref, OpenAlex, ORCID) : le nom est le DERNIER mot, avec
     les particules qui le précèdent (« Jan van der Berg » → « van der Berg »). */
  let cut = tokens.length - 1;
  while (cut > 0 && isParticle(tokens[cut - 1])) cut -= 1;
  return { family: tokens.slice(cut).join(' '), initials: initialsOf(tokens.slice(0, cut).join(' ')) };
};

/** « Smith, John A. » / « John A. Smith » / « J. A. Smith » → « Smith JA » : la
 *  convention d'auteur de l'APPLICATION (voir utils/referenceImport.js, qui
 *  l'appliquait déjà aux bibliographies « texte » et aux fichiers RIS/BibTeX ;
 *  l'import web et le rendu des citations passent maintenant par ici). */
export const canonicalName = (value) => {
  const { family, initials } = nameParts(value);
  if (!family) return '';
  return initials ? `${family} ${initials}` : family;
};

/** Un bloc « prénom » : « John », « John A. », « J. ». Un mot entier seul, ou
 *  des initiales POINTÉES, ou un mélange des deux — jamais deux mots entiers
 *  (« Maria Rossi » est un nom, pas un prénom). */
const isGivenBlock = (token) => {
  const words = String(token || '').split(' ').filter(Boolean);
  if (!words.length) return false;
  const full = words.filter((w) => !isInitialToken(w));
  if (full.length > 1) return false;
  if (full.length === 1) return words.length === 1 || words.some(isInitialToken);
  return words.every(isInitialToken);
};
/** Un bloc « cognome » : un mot, ou des mots dont AUCUN n'est une initiale. */
const isFamilyBlock = (token) => {
  const words = String(token || '').split(' ').filter(Boolean);
  return words.length > 0 && words.every((w) => !isInitialToken(w));
};
/** Une initiale POINTÉE (« J. », « A. ») : c'est ce qui distingue la liste
 *  « Smith, J. A., Rossi, M. » des auteurs de la convention du laboratoire
 *  (« Rossi M, Bianchi A » — initiales sans point, qu'on ne réunit JAMAIS). */
const hasDottedInitial = (token) => String(token || '').split(' ')
  .some((w) => /^\p{Lu}\.?-?$/u.test(w) && w.includes('.'));

const ET_AL = /^(?:et\s*al\.?|and\s+others|&\s*others)$/i;

/* LES SÉPARATEURS D'UNE LISTE D'AUTEURS : « ; », « and », « et », « & ».
   « & » ne sépare PAS quand il appartient à un nom collectif (« Rossi & Cie »,
   « Smith & Sons ») et « et » / « and » ne séparent pas le marqueur de
   troncature (« et al. », « and others ») : le mot qui suit décide — d'où
   l'espace OBLIGATOIRE autour du « & » (`\s&\s`, sans `\s*` : un `\s*` pourrait
   reculer et faire oublier le regard en avant). */
const CONNECTORS = /\s*;\s*|\s+and\s+(?!others\b)|\s+et\s+(?!al\b)|\s&\s(?!al\b|others\b|Cie\b|Co\b|Comp\b|Company\b|Sons?\b|Ltd\b|Inc\b|Assoc\b|Associates\b)/i;

/**
 * UNE LISTE D'AUTEURS → les noms, un par entrée. Deux décisions, dans cet ordre :
 *
 *  1. LES SÉPARATEURS FRANCS (« ; », « & », « and », « et ») tranchent — et le
 *     morceau qu'ils délimitent peut encore contenir une virgule de NOM
 *     (« Smith, J. & Rossi, M. » = DEUX auteurs, pas quatre) ;
 *  2. LA VIRGULE, elle, est ambiguë : elle sépare deux auteurs (« Rossi M,
 *     Bianchi A ») ou le nom du prénom (« Smith, Johnny A. »). On essaie donc
 *     d'APPAIRER les morceaux « Cognome, Prénom » — le premier couple doit
 *     porter une initiale POINTÉE (« Smith, J. A. »), sans quoi « Rossi M,
 *     Bianchi A » (la convention du laboratoire) serait lu comme un seul auteur,
 *     et « John A. Smith, Maria Rossi » comme deux moitiés de nom. Un morceau
 *     DÉTACHÉ par un séparateur franc, lui, est un nom : « Smith, J. ; Rossi,
 *     Maria » ne laisse aucune place au doute (voir `sûr`, ci-dessous).
 *
 * « et al. » / « and others » disparaissent : c'est le format qui décide de la
 * troncature (voir `etAlLimit`).
 */
export const splitAuthorNames = (raw) => {
  const text = trimEdges(raw);
  if (!text) return [];
  const out = [];
  const parts = text.split(CONNECTORS).map(trimEdges).filter(Boolean);
  /* Un « ; », un « & » ou un « and » a DÉJÀ dit où finit un auteur : la virgule
     interne ne peut plus être un séparateur, l'appariement n'a donc plus besoin
     de la preuve de l'initiale pointée. */
  const sure = parts.length > 1;
  parts.forEach((piece) => {
    const tokens = piece.split(',').map(trimEdges).filter(Boolean);
    if (tokens.length < 2) { out.push(piece); return; }
    const canPair = isFamilyBlock(tokens[0]) && isGivenBlock(tokens[1])
      && (sure || hasDottedInitial(tokens[1]));
    if (!canPair) { tokens.forEach((token) => out.push(token)); return; }
    for (let i = 0; i < tokens.length; i += 1) {
      const next = tokens[i + 1];
      if (next !== undefined && isFamilyBlock(tokens[i]) && isGivenBlock(next)) {
        out.push(`${tokens[i]}, ${next}`);
        i += 1;
      } else {
        out.push(tokens[i]);
      }
    }
  });
  return out.filter((name) => !ET_AL.test(name));
};

/** Une liste d'auteurs ENREGISTRÉE → la convention du laboratoire
 *  (« Smith JA, Rossi M, Bianchi A »). Idempotente : une liste déjà écrite
 *  ainsi ressort identique. */
export const normalizeAuthors = (raw) => splitAuthorNames(raw)
  .map(canonicalName)
  .filter(Boolean)
  .join(', ');

/** Une liste STRUCTURÉE d'un éditeur (`[{ given, family }]` : Crossref, ORCID,
 *  OpenAlex…) → la convention du laboratoire. Les deux morceaux que l'API donne
 *  séparément ne sont jamais recollés puis re-devinés : ils sont déjà là. */
export const authorsFromParts = (list) => (Array.isArray(list) ? list : [])
  .map((a) => {
    const family = clean(a && (a.family || a.familyName || a.lastName));
    const given = clean(a && (a.given || a.givenNames || a.firstName));
    if (family) return initialsOf(given) ? `${family} ${initialsOf(given)}` : family;
    return canonicalName(given);
  })
  .filter(Boolean)
  .join(', ');

/* ── LA FORME QUE LE FORMAT CHOISIT (voir pubCitation.js, `format.nameStyle`) ──
   Les quatre écritures que les revues demandent vraiment, et « as written »
   (aucune réécriture : le comportement d'avant ce choix). */
export const NAME_STYLES = [
  { id: 'asis', label: 'as written', title: 'Leave every author exactly as imported (« Smith JA », « John A. Smith »…)' },
  { id: 'family-initials', label: 'Smith JA', title: 'Surname then initials, no punctuation — Vancouver, PubMed' },
  { id: 'family-dot-initials', label: 'Smith J. A.', title: 'Surname then dotted initials — Harvard, Springer' },
  { id: 'initials-family', label: 'J. A. Smith', title: 'Dotted initials then surname — Science, PNAS' },
  { id: 'family-comma-initials', label: 'Smith, J. A.', title: 'Surname, comma, dotted initials — Nature, Cell, APA' }
];
export const NAME_STYLE_IDS = NAME_STYLES.map((s) => s.id);

export const normalizeNameStyle = (value) => (NAME_STYLE_IDS.includes(value) ? value : 'asis');

/** « JA » → « J. A. » (une initiale composée « W-J » reste collée : « W.-J. »). */
const dotted = (initials) => String(initials || '')
  .split('-')
  .map((group) => group.split('').filter(Boolean).map((ch) => `${ch}.`).join(' '))
  .filter(Boolean)
  .join('-');

/**
 * UN AUTEUR DANS LA FORME DU FORMAT. Le nom de famille est la seule chose que
 * toutes les formes partagent : un auteur sans initiales sort donc famille
 * seule, jamais « Smith . ». `style` inconnu (ou « asis ») → le nom tel quel.
 */
export const formatAuthorName = (value, style) => {
  /* « asis » : le nom TEL QUEL (aucune réécriture, pas même le point final). */
  const raw = trimEdges(value);
  const id = normalizeNameStyle(style);
  if (id === 'asis' || !raw) return raw;
  const { family, initials } = nameParts(raw);
  if (!family) return raw;
  if (!initials) return family;
  switch (id) {
    case 'family-initials': return `${family} ${initials}`;
    case 'family-dot-initials': return `${family} ${dotted(initials)}`;
    case 'initials-family': return `${dotted(initials)} ${family}`;
    case 'family-comma-initials': return `${family}, ${dotted(initials)}`;
    default: return raw;
  }
};

/** Le nom de FAMILLE seul (« Rossi M » → « Rossi », « John A. Smith » → « Smith ») :
 *  c'est lui qui s'écrit dans un renvoi auteur-année (voir utils/referenceLinks.js). */
export const familyNameOf = (value) => nameParts(value).family || clean(value);

