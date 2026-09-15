/* =========================================================================
   src/utils/referenceLinks.js
   LES CITATIONS D'UN TEXTE DEVIENNENT DES LIENS VERS LEURS RÉFÉRENCES.

   Un manuscrit écrit ailleurs (Google Docs, Word, Paperpile…) cite ses papiers
   par des NUMÉROS : « … as shown previously [12] » — ou « [3,4] », « [5-7] ».
   Le programme, lui, numérote les références d'un projet (project.references,
   voir « 📚 + Reference ») et affiche la liste dans la section « 📚 Bibliography »
   et dans le document exporté. Sans lien, le lecteur (et l'auteur lui-même !) ne
   peut pas savoir À QUOI correspond le « [12] » resté dans le texte : c'est
   exactement ce que ce module répare.

   `linkCitationNumbers(html, …)` remplace chaque « [12] » par « [12] » cliquable :
     • le numéro reste VISIBLE (le texte garde son sens, même imprimé) ;
     • le lien pointe sur l'ancre `#ref-12` de la liste bibliographique (le
       document exporté défile jusqu'à la référence) ;
     • la référence est rappelée en infobulle (`title`) ;
     • un numéro qui n'existe PAS dans le projet reste intact : rien n'est
       inventé, on n'ajoute jamais de lien mort ;
     • la fonction est IDEMPOTENTE et ne touche ni les balises, ni le contenu
       d'un lien existant (un texte déjà traité peut être retraité sans dégât).

   Tout est PUR (aucune dépendance React, aucun DOM) : la page projet s'en sert
   à l'import, sur le bouton « 🔗 Link citations… » et dans le document exporté.
   ========================================================================= */

import { NUMERIC_CITATION_RE, numericCitationNumbers } from './manuscriptImport';

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

/**
 * Le TEXTE HTML d'une section, ses citations numérotées transformées en liens.
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
  let anchor = 0; // profondeur : on ne réécrit JAMAIS l'intérieur d'un lien
  return source.split(/(<[^>]*>)/).map((token) => {
    if (!token) return token;
    if (isTag(token)) {
      if (/^<a[\s>]/i.test(token)) anchor += 1;
      else if (/^<\/a\s*>/i.test(token)) anchor = Math.max(0, anchor - 1);
      return token;
    }
    if (anchor > 0) return token;
    return token.replace(NUMERIC_CITATION_RE, (raw, group) => {
      const nums = numericCitationNumbers(group);
      if (!nums.length || !nums.every((n) => valid.has(n))) return raw;
      return `[${nums.map((n) => {
        const title = titleOf(n);
        return `<a class="${CITE_LINK_CLASS}" href="${escapeAttr(href(n))}" data-ref="${n}"`
          + `${title ? ` title="${escapeAttr(title)}"` : ''}>${n}</a>`;
      }).join(',')}]`;
    });
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
