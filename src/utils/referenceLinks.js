/* =========================================================================
   src/utils/referenceLinks.js
   LES CITATIONS D'UN TEXTE DEVIENNENT DES LIENS VERS LEURS RÉFÉRENCES.

   Un manuscrit écrit ailleurs (Google Docs, Word, Paperpile, EndNote…) cite ses
   papiers par des NUMÉROS : « … as shown previously [12] » — ou « [3,4] »,
   « [5-7] » quand le journal demande les crochets ; « (12) » quand le style est
   celui d'EndNote/Word ; et l'EXPOSANT — « previously¹² » ou
   « previously<sup>12</sup> », la forme la plus courante dans un article.
   Le programme, lui, numérote les références d'un projet (project.references,
   voir « 📚 + Reference ») et affiche la liste dans la section « 📚 Bibliography »
   et dans le document exporté. Sans lien, le lecteur (et l'auteur lui-même !) ne
   peut pas savoir À QUOI correspond le « [12] » resté dans le texte : c'est
   exactement ce que ce module répare.

   `linkCitationNumbers(html, …)` transforme ces trois écritures en liens, sans
   changer l'apparence du texte (un exposant reste un exposant) :
     • le numéro reste VISIBLE (le texte garde son sens, même imprimé) ;
     • le lien pointe sur l'ancre `#ref-12` de la liste bibliographique (le
       document exporté défile jusqu'à la référence) ;
     • la référence est rappelée en infobulle (`title`) ;
     • un numéro qui n'existe PAS dans le projet reste intact : rien n'est
       inventé, on n'ajoute jamais de lien mort ;
     • un exposant qui n'est PAS un renvoi reste du texte : l'ISOTOPE « ¹³C »
       (l'exposant y OUVRE le mot de l'atome, un renvoi ne précède jamais le mot
       qu'il cite), l'exposant d'une FORMULE (« (x + y)² ») ou d'une unité
       (« m² ») — voir citationPassesGuards dans utils/manuscriptImport.js ;
     • la fonction est IDEMPOTENTE et ne touche ni les balises, ni le contenu
       d'un lien existant (un texte déjà traité peut être retraité sans dégât).

   Tout est PUR (aucune dépendance React, aucun DOM) : la page projet s'en sert
   à l'import, sur le bouton « 🔗 Link citations… » et dans le document exporté.

   LE NUMÉROTAGE DES RÉFÉRENCES IMPORTÉES (bas de ce fichier) : une bibliographie
   Paperpile/Word importée dans un projet doit avoir les MÊMES numéros que les
   « [12] » déjà écrits dans le texte — sinon le lien ne mène à rien et le
   document exporté n'imprime aucune référence. `numberImportedReferences` fait
   ce travail : chaque entrée importée devient une référence numérotée du projet
   (project.references, la liste que la section « Bibliography » et le document
   exporté impriment) en gardant le numéro que le DOCUMENT lui donnait, sans
   jamais écraser un numéro déjà pris ni dupliquer un papier déjà référencé.
   ========================================================================= */

import {
  NUMERIC_CITATION_RE, PAREN_CITATION_RE, SUPERSCRIPT_CITATION_RE,
  citationPassesGuards, numbersOfCitation, numericCitationNumbers,
  digitsToSuperscript, isAuthorMarkLine
} from './manuscriptImport';
import { entryKeys } from './referenceImport';

/** Classe CSS des liens de citation (stylée dans le document exporté). */
export const CITE_LINK_CLASS = 'cite-ref';

/** Ancre de la référence n° `number` dans la liste bibliographique. */
export const citationAnchorId = (number) => `ref-${Number(number)}`;

/** Les numéros de référence d'une liste de références de projet (Set). */
export const referenceNumbers = (refs) => new Set(
  (Array.isArray(refs) ? refs : [])
    .map((r) => Number(r && r.number))
    .filter((n) => Number.isFinite(n) && n > 0)
);

/** Infobulle d'une référence : « Auteurs · Titre (année) ». */
export const citationLabel = (ref) => {
  if (!ref) return '';
  const year = String(ref.year || '').trim();
  const title = String(ref.title || '').trim() || 'Untitled';
  return [String(ref.authors || '').trim(), year ? `${title} (${year})` : title].filter(Boolean).join(' · ');
};

/** `titleFor(number)` prêt à l'emploi à partir des références du projet. */
export const citationTitleGetter = (refs) => (number) => {
  const ref = (Array.isArray(refs) ? refs : []).find((r) => Number(r && r.number) === Number(number));
  return citationLabel(ref);
};

const isTag = (token) => /^<\/?[a-zA-Z][^>]*>$/.test(token);
const escapeAttr = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Le contenu d'un `<sup>` : des nombres, et RIEN d'autre (« 12 », « 3,4 »,
 *  « 5-7 »). « m<sup>2</sup> » ou « 2<sup>nd</sup> » n'y ressemblent pas. */
const SUP_CONTENT_RE = /^(\s*)(\d{1,4}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,4})*)(\s*)$/;

/** Le texte qui SUIT la fermeture d'un exposant HTML (« </sup> ») — le contexte
 *  APRÈS la citation, et non le nom de la balise : « <sup>2</sup>C » est un
 *  isotope (voir citationPassesGuards). */
const afterSupClose = (source, from) => String(source || '').slice(from).replace(/^<\/sup\s*>/i, '');

/* La fin d'un bloc de texte : c'est là que s'arrête « la ligne » dont parle le
   garde-fou de la ligne d'auteurs. */
const BLOCK_BREAK_RE = /<\/p>|<br\s*\/?>|<\/li>|<\/h[1-6]>|<\/div>|\n/gi;

/** Le TEXTE de la ligne qui porte la position `at` (balises retirées) : le bloc
 *  (`<p>…</p>`, `<li>…</li>`, une ligne après `<br>`) dans lequel elle tombe. */
const lineTextAt = (source, at) => {
  BLOCK_BREAK_RE.lastIndex = 0;
  let start = 0;
  let m = BLOCK_BREAK_RE.exec(source);
  while (m && m.index < at) {
    start = m.index + m[0].length;
    m = BLOCK_BREAK_RE.exec(source);
  }
  const end = m ? m.index : source.length;
  return source.slice(start, end).replace(/<[^>]*>/g, '');
};

/** L'ANCRE d'un renvoi : le numéro visible, son lien vers la référence, son
 *  infobulle. UNE seule écriture, partagée par le rattachement des citations
 *  (citationLinks) et par les FORMES du « Publication format »
 *  (inTextCitationHtml) : les deux ne peuvent pas diverger. */
const citeAnchor = (n, inner, { href, titleOf }) => {
  const title = titleOf(n);
  return `<a class="${CITE_LINK_CLASS}" href="${escapeAttr(href(n))}" data-ref="${n}"`
    + `${title ? ` title="${escapeAttr(title)}"` : ''}>${inner}</a>`;
};

/** Les citations d'un groupe → leur HTML cliquable, SÉPARÉES par des virgules.
 *  `innerFor` décide de ce qui reste VISIBLE (le nombre, ou son exposant). */
const citationLinks = (nums, { href, titleOf, innerFor }) => nums
  .map((n) => citeAnchor(n, innerFor ? innerFor(n) : n, { href, titleOf }))
  .join(',');

/**
 * Le TEXTE HTML d'une section, ses citations numérotées transformées en liens.
 *
 * Les TROIS écritures d'un même renvoi sont reconnues (elles viennent du
 * journal, pas de nous) :
 *   • « [12] »    — crochets (Paperpile, Zotero, la plupart des revues) ;
 *   • « (12) »    — parenthèses, le style EndNote/Word ;
 *   • un EXPOSANT — « previously¹² » (chiffres Unicode) ou
 *                   « previously<sup>12</sup> » (exposant Word/EndNote).
 * Chacune garde son apparence : le numéro reste visible et à sa place, seule
 * une ancre `#ref-<n>` (plus une infobulle) lui est ajoutée.
 *
 * @param {string} html    le contenu riche de la section (déjà échappé)
 * @param {object} [opts]
 * @param {Set|Array} [opts.numbers]  numéros de référence VALIDES : un numéro
 *        absent de cette liste n'est PAS lié (aucun lien mort).
 * @param {Function} [opts.hrefFor]   number → href (défaut : `#ref-<n>`)
 * @param {Function} [opts.titleFor]  number → infobulle (voir citationTitleGetter)
 * @returns {string} le HTML avec ses liens (inchangé si rien à faire)
 */
export const linkCitationNumbers = (html, { numbers, hrefFor, titleFor } = {}) => {
  const source = String(html || '');
  const valid = numbers instanceof Set ? numbers : new Set((Array.isArray(numbers) ? numbers : []).map(Number));
  if (!valid.size) return source;
  const href = typeof hrefFor === 'function' ? hrefFor : (n) => `#${citationAnchorId(n)}`;
  const titleOf = typeof titleFor === 'function' ? titleFor : () => '';
  const plain = { href, titleOf };
  let anchor = 0;   // profondeur de <a> : on ne réécrit JAMAIS l'intérieur d'un lien
  const sups = [];  // <sup> ouverts : leur contenu est une citation s'il n'a QUE des nombres
  let offset = 0;   // position du token dans le source (garde-fou de contexte)
  /* LA LIGNE QUI PORTE LA CITATION : une ligne d'AUTEURS n'est jamais citée —
     ses exposants sont les numéros des AFFILIATIONS (« Mario Rossi¹, Anna
     Bianchi² »), jamais des renvois (voir isAuthorMarkLine dans
     utils/manuscriptImport.js). Les lier écrivait « Rossi[1] » dans la liste des
     auteurs du document. Une PHRASE, elle, reste du texte cité. */
  const authorLines = new Map();   // « la ligne est-elle une liste d'auteurs ? »
  const inAuthorLine = (at) => {
    const line = lineTextAt(source, at);
    if (!authorLines.has(line)) authorLines.set(line, isAuthorMarkLine(line));
    return authorLines.get(line);
  };
  return source.split(/(<[^>]*>)/).map((token) => {
    const start = offset;
    offset += token.length;
    if (!token) return token;
    if (isTag(token)) {
      if (/^<a[\s>]/i.test(token)) anchor += 1;
      else if (/^<\/a\s*>/i.test(token)) anchor = Math.max(0, anchor - 1);
      if (/^<sup[\s>]/i.test(token)) sups.push(source.slice(0, start)); // le texte D'AVANT l'exposant
      else if (/^<\/sup\s*>/i.test(token)) sups.pop();
      return token;
    }
    if (anchor > 0) return token;
    /* Dans un exposant HTML : le numéro seul est la citation (« …shown<sup>12</sup> »). */
    if (sups.length) {
      const m = token.match(SUP_CONTENT_RE);
      if (!m) return token;
      const nums = numericCitationNumbers(m[2]);
      if (!nums.length) return token;
      if (inAuthorLine(start)) return token;
      if (!citationPassesGuards(sups[sups.length - 1], afterSupClose(source, start + token.length),
        { form: 'sup-html', nums })) return token;
      if (!nums.every((n) => valid.has(n))) return token;
      return `${m[1]}${citationLinks(nums, plain)}${m[3]}`;
    }
    /* Crochets, parenthèses et exposants Unicode. */
    return [[NUMERIC_CITATION_RE, 'bracket'], [PAREN_CITATION_RE, 'paren'], [SUPERSCRIPT_CITATION_RE, 'sup']]
      .reduce((acc, [re, form]) => acc.replace(new RegExp(re.source, re.flags), (raw, group, at) => {
        const nums = numbersOfCitation(form, group);
        if (inAuthorLine(start + at)) return raw;
        if (!citationPassesGuards(source.slice(0, start + at),
          source.slice(start + at + raw.length), { form, nums })) return raw;
        if (!nums.length || !nums.every((n) => valid.has(n))) return raw;
        if (form === 'paren') return `(${citationLinks(nums, plain)})`;
        if (form === 'sup') {
          return citationLinks(nums, { ...plain, innerFor: (n) => digitsToSuperscript(n) });
        }
        return `[${citationLinks(nums, plain)}]`;
      }), token);
  }).join('');
};

/** Les numéros déjà liés dans un texte HTML (pour compter un travail fait). */
export const linkedCitationNumbers = (html) => {
  const out = new Set();
  String(html || '').replace(/data-ref="(\d{1,4})"/g, (_m, n) => { out.add(Number(n)); return _m; });
  return out;
};

/**
 * Le MÊME travail, d'un coup, sur les sections d'un projet :
 *   linkCitationsInSections([{ id: 'background', html }], project.references)
 *     → { patch, updated, added }   `patch` = { id: html } des sections changées.
 */
export const linkCitationsInSections = (sections, refs, opts = {}) => {
  const numbers = opts.numbers instanceof Set ? opts.numbers : referenceNumbers(refs);
  const titleFor = opts.titleFor || citationTitleGetter(refs);
  const patch = {};
  let updated = 0;
  let added = 0;
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    const id = String((s && s.id) || '');
    const html = String((s && s.html) || '');
    if (!id || !html) return;
    const next = linkCitationNumbers(html, { ...opts, numbers, titleFor });
    if (next === html) return;
    patch[id] = next;
    updated += 1;
    added += Math.max(0, linkedCitationNumbers(next).size - linkedCitationNumbers(html).size);
  });
  return { patch, updated, added };
};

/* ── LA FORME DES RENVOIS DANS LE TEXTE (« Publication format ») ─────────────

   Le numéro reste VU par le lecteur, mais sa FORME suit le journal :
   l'exposant (« previously¹² », Nature), les crochets (« [12] », Paperpile), les
   parenthèses (« (12) », style EndNote/Word) ou le nom d'auteur suivi de l'année
   (« (Rossi & Bianchi, 2018) », APA / Harvard). Le choix vit dans le
   « Publication format » (`format.inTextStyle`, voir components/pubCitation.js,
   panneau « Publication format » des Publications), et il vaut PARTOUT où un
   renvoi s'affiche.

   Le texte des sections garde, lui, l'écriture de l'auteur : c'est à
   l'AFFICHAGE que la forme est appliquée (applyInTextStyle), donc changer le
   format change tout de suite le document affiché, le document imprimé et son
   PDF — comme la liste des références (voir pubCitationHtml). */

/** Le nom de famille d'un auteur (« Rossi M » → « Rossi », « W.-J. Lu » → « Lu »). */
const authorSurnameOf = (name) => {
  const words = String(name || '').split(/\s+/).filter(Boolean)
    /* Une INITIALE (« M. », « W.-J. », « A ») n'est pas un nom de famille. */
    .filter((w) => !/^(?:\p{Lu}\.?-?){1,4}$/u.test(w));
  return words.length ? words[words.length - 1] : '';
};

/** Le libellé auteur-année d'une référence : « Rossi & Bianchi, 2018 »,
 *  « Rossi et al., 2018 » au-delà de deux auteurs. '' quand on ne peut pas le
 *  construire (le numéro reste alors affiché à sa place). */
export const citeAuthorYearLabel = (ref) => {
  const surnames = String((ref && ref.authors) || '')
    .split(/\s*[,;]+\s*|\s+and\s+/i)
    .map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^et\s*al\.?$/i.test(s))
    .map(authorSurnameOf).filter(Boolean);
  const who = surnames.length === 0 ? ''
    : surnames.length === 1 ? surnames[0]
      : surnames.length === 2 ? `${surnames[0]} & ${surnames[1]}`
        : `${surnames[0]} et al.`;
  if (!who) return '';
  const year = String((ref && ref.year) || '').trim();
  return year ? `${who}, ${year}` : who;
};

/**
 * UN RENVOI DU TEXTE DANS LA FORME CHOISIE : « ¹² » (sup), « [12] » (bracket),
 * « (12) » (paren) ou « (Rossi & Bianchi, 2018) » (author-date). Les numéros
 * restent des LIENS vers leur référence (`#ref-12`) : changer de forme ne casse
 * jamais le rattachement.
 *
 * @param {Array<number>} nums  les numéros du renvoi, dans l'ordre du texte
 * @param {object} [opts]  `style`, `refs` (références du projet, pour le libellé
 *                         auteur-année), `hrefFor`, `titleFor`
 */
export const inTextCitationHtml = (nums, opts = {}) => {
  const list = (Array.isArray(nums) ? nums : []).map(Number).filter((n) => n > 0);
  if (!list.length) return '';
  const style = String(opts.style || '');
  const href = typeof opts.hrefFor === 'function' ? opts.hrefFor : (n) => `#${citationAnchorId(n)}`;
  const titleOf = typeof opts.titleFor === 'function' ? opts.titleFor : () => '';
  const refs = Array.isArray(opts.refs) ? opts.refs : [];
  const plain = { href, titleOf };
  if (style === 'author-date') {
    /* Un renvoi = un auteur et une année : « (Rossi & Bianchi, 2018; Dupont,
       2020) ». La référence est cherchée par son NUMÉRO (celui du texte), et un
       renvoi sans auteurs lisibles garde son numéro. */
    return `(${list.map((n) => {
      const ref = refs.find((r) => Number(r && r.number) === n);
      return citeAnchor(n, escapeAttr(citeAuthorYearLabel(ref) || String(n)), plain);
    }).join('; ')})`;
  }
  const inner = list
    .map((n) => citeAnchor(n, style === 'sup' ? digitsToSuperscript(n) : n, plain))
    .join(',');
  if (style === 'sup') return `<sup>${inner}</sup>`;
  if (style === 'bracket') return `[${inner}]`;
  if (style === 'paren') return `(${inner})`;
  return inner;
};

/** L'ancre d'un renvoi DÉJÀ lié : c'est exactement ainsi que linkCitationNumbers
 *  l'écrit (même classe, même href, même `data-ref`). */
const CITE_ANCHOR_SRC = '<a class="' + CITE_LINK_CLASS + '" href="[^"]*" data-ref="(\\d{1,4})"'
  + '(?: title="[^"]*")?>[\\s\\S]*?<\\/a>';
const CITE_ANCHOR_ANY = CITE_ANCHOR_SRC.replace('(\\d{1,4})', '\\d{1,4}');
/* Un GROUPE de renvois liés : les numéros sont séparés par des virgules (ou des
   points-virgules, la forme auteur-année). */
const CITE_RUN_RE = new RegExp(`${CITE_ANCHOR_ANY}(?:\\s*[,;]\\s*${CITE_ANCHOR_ANY})*`, 'g');
const CITE_RUN_NUMS_RE = new RegExp(CITE_ANCHOR_SRC, 'g');

/** La forme qui ENCADRE un groupe de renvois : « <sup> » + « </sup> », les
 *  crochets, les parenthèses — celles que linkCitationNumbers a écrites. Rien
 *  n'est retiré quand les DEUX côtés ne sont pas là : une parenthèse de l'auteur
 *  (« (see ¹²) ») ne part pas avec le renvoi. */
const runWrapper = (before, after) => {
  const sup = /<sup>\s*$/i.exec(before);
  if (sup && /^\s*<\/sup>/i.test(after)) {
    return { left: sup[0].length, right: /^\s*<\/sup>/i.exec(after)[0].length };
  }
  if (/\[$/.test(before) && /^\]/.test(after)) return { left: 1, right: 1 };
  if (/\($/.test(before) && /^\)/.test(after)) return { left: 1, right: 1 };
  return { left: 0, right: 0 };
};

/**
 * LES RENVOIS D'UN TEXTE HTML DANS LA FORME DU « Publication format ».
 *
 * Le texte de l'auteur n'est pas réécrit : la forme est appliquée À L'AFFICHAGE
 * (page du projet, document imprimé, export). `style` absent ou « keep » rend le
 * texte inchangé — le renvoi garde alors l'écriture du document.
 *
 * Les renvois pas encore liés le sont d'abord (mêmes règles : un numéro inconnu
 * du projet reste intact), sauf avec `link: false`.
 *
 * IDEMPOTENTE : rejouer la transformation avec la même forme rend le même HTML.
 *
 * @param {string} html  le texte de la section (HTML)
 * @param {object} [opts]  `style`, `refs`, `numbers`, `hrefFor`, `titleFor`, `link`
 * @returns {string} le texte avec ses renvois dans la forme choisie
 */
export const applyInTextStyle = (html, opts = {}) => {
  const source = String(html || '');
  const style = String(opts.style || '');
  if (!style || style === 'keep') return source;
  const linked = opts.link === false ? source : linkCitationNumbers(source, opts);
  if (!linked.includes(CITE_LINK_CLASS)) return linked;
  const cuts = [];
  CITE_RUN_RE.lastIndex = 0;
  let m = CITE_RUN_RE.exec(linked);
  while (m) {
    const nums = [];
    m[0].replace(CITE_RUN_NUMS_RE, (all, n) => { nums.push(Number(n)); return all; });
    if (nums.length) {
      const rest = m.index + m[0].length;
      const { left, right } = runWrapper(linked.slice(0, m.index), linked.slice(rest));
      cuts.push({
        from: m.index - left,
        to: rest + right,
        html: inTextCitationHtml(nums, opts)
      });
    }
    m = CITE_RUN_RE.exec(linked);
  }
  if (!cuts.length) return linked;
  let out = '';
  let at = 0;
  cuts.forEach((c) => {
    out += linked.slice(at, c.from) + c.html;
    at = c.to;
  });
  return out + linked.slice(at);
};

/* ── Les références IMPORTÉES rejoignent la liste NUMÉROTÉE du projet ─────── */

/**
 * Une entrée de bibliographie importée (Paperpile, RIS, BibTeX, bloc de
 * références) → une référence de projet numérotée, de la MÊME forme que celles
 * créées par « 📚 + Reference » (voir projectDetailModule.jsx). C'est cette
 * liste (`project.references`) que la section « Bibliography » du projet et le
 * document exporté impriment, et sur laquelle pointent les liens `#ref-<n>`.
 */
export const referenceFromEntry = (entry, number, id = '') => {
  const e = entry || {};
  return {
    id: id || `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    number: Number(number) || 0,
    sourceId: '', source: '',
    title: String(e.title || '').trim() || 'Untitled',
    link: String(e.link || e.url || e.doi || '').trim(),
    doi: String(e.doi || '').trim(),
    authors: String(e.authors || '').trim(),
    journal: String(e.journal || '').trim(),
    year: String(e.year || '').trim(),
    volume: String(e.volume || '').trim(),
    pages: String(e.pages || '').trim()
  };
};

/**
 * Les entrées d'une bibliographie importée deviennent les références du projet,
 * NUMÉROTÉES COMME DANS LE DOCUMENT.
 *
 * C'est ce qui manquait : un manuscrit collé dans un projet gardait ses « [12] »
 * alors que le projet n'avait aucune référence 12 — le texte renvoyait dans le
 * vide et le document exporté sortait sans bibliographie.
 *
 * @param {Array} entries   entrées importées, DANS L'ORDRE DU DOCUMENT
 * @param {Array} refs      `project.references` (jamais modifiées : copie)
 * @param {object} [opts]
 * @param {Array<number>} [opts.hints]  le numéro que le DOCUMENT donnait à
 *        chaque entrée (« 12. Rossi, … » → 12). À défaut, premier numéro libre.
 * @param {Function} [opts.makeId]      fabrique d'id (injectable en test)
 * @returns {{ list: Array, added: number, reused: number, created: Array }}
 *          `list` = la liste COMPLÈTE à enregistrer, `created` = les seules
 *          références ajoutées, `reused` = combien d'entrées existaient déjà.
 *
 * Règles (jamais destructives) :
 *   • un papier DÉJÀ référencé (même DOI, PMID ou titre) garde sa référence et
 *     son numéro : rien n'est dupliqué, rien n'est renuméroté ;
 *   • un numéro déjà pris n'est JAMAIS volé : l'entrée reçoit le premier numéro
 *     libre (le « [12] » du document reste donc soit intact — lien mort évité —
 *     soit correctement lié, jamais faux) ;
 *   • deux entrées du même papier dans un même import ne créent qu'une
 *     référence.
 */
export const numberImportedReferences = (entries, refs, opts = {}) => {
  const list = (Array.isArray(refs) ? refs : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({ ...r }));
  const index = new Map();
  const register = (ref) => {
    entryKeys(ref).forEach((k) => { if (k && !index.has(k)) index.set(k, ref); });
  };
  list.forEach(register);
  const taken = new Set();
  list.forEach((r) => {
    const n = Number(r.number) || 0;
    if (n > 0) taken.add(n);
  });
  /* Numéro par défaut : le PREMIER APRÈS le plus grand déjà attribué — la règle
     du plan d'import de manuscrit (buildManuscriptPlan), pour que la même
     bibliographie reçoive les mêmes numéros par les deux chemins. Un numéro
     déjà pris est sauté (jamais deux références pour un même numéro). */
  let next = list.reduce((max, r) => Math.max(max, Number(r.number) || 0), 0) + 1;
  const nextFree = () => {
    while (taken.has(next)) next += 1;
    return next;
  };
  const makeId = typeof opts.makeId === 'function' ? opts.makeId : undefined;
  const hints = Array.isArray(opts.hints) ? opts.hints : [];
  const created = [];
  let reused = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const hit = entryKeys(entry).map((k) => index.get(k)).find(Boolean);
    if (hit) { reused += 1; return; }
    /* Le numéro que le DOCUMENT donnait à cette entrée (« 12. Rossi… » → 12) :
       celui du texte, donc le lien « [12] » tombe juste. À défaut (RIS, BibTeX,
       bibliographie non numérotée), le prochain numéro libre. */
    const hint = Number(hints[i]) || Number(entry.number) || 0;
    const number = hint > 0 && !taken.has(hint) ? hint : nextFree();
    const ref = referenceFromEntry(entry, number, makeId ? makeId() : '');
    list.push(ref);
    created.push(ref);
    taken.add(number);
    register(ref);
  });
  return { list, added: created.length, reused, created };
};

/* ── À L'EXPORT : une bibliographie d'instantané se complète ──────────────── */

/** Le titre « Bibliography (n) » d'un document, suivi de l'ouverture de sa liste. */
const BIB_LIST_RE = /<h[1-3][^>]*>\s*Bibliography\b[^<]*<\/h[1-3]>\s*<ol\b[^>]*>/i;

/**
 * LES RÉFÉRENCES MANQUANTES D'UN DOCUMENT DÉJÀ ENREGISTRÉ.
 *
 * « ✏️ Edit text » → « 💾 Save changes » FIGE le document (`project.exportDocHtml`) :
 * une bibliographie importée ENSUITE n'y figure pas et ses « [12] » n'y sont pas
 * liés — le PDF exporté sortait donc sans les références Paperpile, même une fois
 * la numérotation en place (c'est la deuxième moitié de la plainte : « ni liées,
 * ni exportées »).
 *
 * Cette fonction ne RÉÉCRIT RIEN du texte de l'auteur : elle ajoute à la
 * bibliographie du document les seules entrées dont l'ancre `#ref-<n>` manque
 * (`<li id="ref-12" value="12">…</li>`), à la fin de la liste « Bibliography »
 * existante — ou dans un bloc ajouté à la fin si le document n'en a plus.
 * Elle est IDEMPOTENTE : un document déjà complet ressort tel quel.
 *
 * @param {string} html    le document enregistré (HTML)
 * @param {Array} entries  `[{ number, html }]` — `html` = intérieur du `<li>`
 * @returns {{ html: string, added: number }} `added` = entrées ajoutées
 */
export const ensureReferenceEntries = (html, entries) => {
  const source = String(html || '');
  const wanted = (Array.isArray(entries) ? entries : [])
    .map((e) => ({ number: Number(e && e.number) || 0, html: String((e && e.html) || '').trim() }))
    .filter((e) => e.number > 0 && e.html)
    .sort((a, b) => a.number - b.number);
  const missing = wanted.filter((e) => !source.includes(`id="${citationAnchorId(e.number)}"`));
  if (!missing.length) return { html: source, added: 0 };
  const items = missing
    .map((e) => `<li id="${citationAnchorId(e.number)}" value="${e.number}">${e.html}</li>`)
    .join('');
  const heading = source.match(BIB_LIST_RE);
  if (heading) {
    /* `</ol>` de la liste ouverte juste après le titre : la bibliographie n'a pas
       de sous-liste, la première fermeture est donc la bonne. */
    const close = source.indexOf('</ol>', heading.index + heading[0].length);
    if (close !== -1) {
      return { html: `${source.slice(0, close)}${items}${source.slice(close)}`, added: missing.length };
    }
  }
  return {
    html: `${source}\n<div class="mb-4"><h2 class="text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">Bibliography</h2>`
      + `<ol class="list-decimal pl-5 text-sm text-slate-800 space-y-1">${items}</ol></div>`,
    added: missing.length
  };
};

/**
 * LA BIBLIOGRAPHIE D'UN DOCUMENT FIGÉ, RETIRÉE.
 *
 * « ✏️ Edit text » → « 💾 Save changes » fige le document ENTIER, liste des
 * références comprise : le « Bibliography (n) » enregistré garde la mise en
 * forme de la publication (order des champs, styles) telle qu'elle était ce
 * jour-là, et le format choisi depuis ne s'y voyait donc jamais — la plainte
 * exacte : « le publication format ne modifie pas le format des références dans
 * le texte du projet ». Le document figé est donc affiché SANS sa bibliographie
 * (celle du fichier enregistré, qui a pu vieillir) : la page imprime à la place
 * la liste VIVANTE des références du projet, rendue avec le format courant à
 * chaque affichage.
 *
 * Ne touche QUE le titre « Bibliography » et la liste qui le suit (le texte de
 * l'auteur, lui, reste intact) ; idempotente ; sans bibliographie, le document
 * ressort tel quel.
 */
export const withoutBibliographySection = (html) => {
  const source = String(html || '');
  const heading = source.match(BIB_LIST_RE);
  if (!heading) return source;
  const open = heading.index;
  const openEnd = heading.index + heading[0].length;
  const close = source.indexOf('</ol>', openEnd);
  const end = close === -1 ? source.length : close + '</ol>'.length;
  /* Le conteneur qui portait le titre (`<div class="mb-4">…`) part avec lui
     quand c'est LUI qui l'ouvre : sinon il resterait un cadre vide. */
  const wrap = /<div\b[^>]*>\s*$/i.exec(source.slice(0, open));
  const left = wrap ? wrap.index : open;
  const afterEnd = wrap ? (source.slice(end, end + 6) === '</div>' ? end + 6 : end) : end;
  return (source.slice(0, left) + source.slice(afterEnd)).trim();
};
