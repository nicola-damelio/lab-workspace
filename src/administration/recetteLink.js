/* =========================================================================
   src/administration/recetteLink.js
   Cohérence « Catégorie (Fonctionnement / Investissement) ⇄ ligne budgétaire ».

   Une dépense est classée par le champ « Catégorie » (Fonctionnement /
   Investissement) et imputée sur une fiche de la page Recettes via
   `recetteId`. Un même intitulé de ligne peut exister en DEUX fiches — une
   « Fonctionnement » et une « Investissement » (ex. « Overvalc (FED25001) »).

   Ces aides garantissent qu’une dépense est toujours reliée à une fiche dont
   le `type` correspond à sa catégorie :
     · à la saisie / à l’enregistrement (page Dépenses) ;
     · au transfert OM → Dépenses (page OM) ;
     · à l’import Google Sheets (onglet Dépenses) ;
     · par réattribution automatique des enregistrements existants (pages
       Recettes et Dépenses) — voir useDepenseLinkRepair.js.
   ========================================================================= */

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

/* Clé normalisée d’un intitulé : minuscules, sans accents ni ponctuation. */
export const normLabel = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* « Catégorie » de la dépense et « type » de la fiche Recettes désignent la
   même chose (comparaison insensible à la casse et aux accents). */
export const sameCatType = (categorie, recetteType) => {
  const a = normLabel(categorie);
  const b = normLabel(recetteType);
  return !!a && !!b && a === b;
};

/* Noyau d’un intitulé de ligne : la partie entre parenthèses (code projet)
   est ignorée pour retrouver les fiches « jumelles » d’un même projet. */
const coreOf = (label) => normLabel(label).replace(/\s*\([^)]*\)\s*$/, '').trim();

export const recetteOfId = (recettes, id) => {
  const s = txt(id);
  return s ? (Array.isArray(recettes) ? recettes : []).find((r) => r && r.id === s) || null : null;
};

/* Fiche Recettes recherchée par intitulé, avec les mêmes règles que
   l’import/l’ancien findRecetteId (intitulé exact → noyau → code entre
   parenthèses). Quand `type` est fourni, la recherche est restreinte aux
   fiches de CE type : on ne relie jamais vers une fiche de l’autre type. */
export const findRecetteByLabel = (recettes, label, type) => {
  const list = Array.isArray(recettes) ? recettes : [];
  if (!label) return null;
  const want = txt(type);
  const pool = want
    ? list.filter((r) => r && r.type && sameCatType(want, r.type))
    : list;
  if (!pool.length) return null;
  const n = normLabel(label);
  if (!n) return null;
  const exact = pool.find((r) => normLabel(r.ligne || '') === n);
  if (exact) return exact;
  const core = coreOf(n);
  if (core && core.length >= 3) {
    const byCore = pool.find((r) => coreOf(r.ligne || '') === core);
    if (byCore) return byCore;
  }
  const m = n.match(/\(([^)]+)\)\s*$/);
  const tok = m ? m[1].trim() : '';
  if (tok && tok.length >= 2 && tok !== 'na') {
    const byTok = pool.find((r) => normLabel(r.ligne || '').split(' ').includes(tok));
    if (byTok) return byTok;
  }
  return null;
};

/* Fiche « jumelle » de `rec` : même intitulé (ou même noyau) mais portant le
   type demandé — la fiche sur laquelle réattribuer une dépense dont la
   catégorie ne correspond pas au type de la ligne actuellement imputée. */
export const findRecetteTwin = (recettes, rec, type) => {
  if (!rec || !type) return null;
  const list = Array.isArray(recettes) ? recettes : [];
  const key = normLabel(rec.ligne || '');
  if (!key) return null;
  const want = normLabel(type);
  const match = (r) => r && r.id !== rec.id && r.type && normLabel(r.type) === want;
  const sameKey = list.find((r) => match(r) && normLabel(r.ligne || '') === key);
  if (sameKey) return sameKey;
  const core = coreOf(rec.ligne || '');
  if (core && core.length >= 3) {
    return list.find((r) => match(r) && coreOf(r.ligne || '') === core) || null;
  }
  return null;
};

/* État de cohérence d’une dépense par rapport aux fiches Recettes.
   Retourne { ok:true } quand rien ne peut être conclu (catégorie absente,
   fiche absente/sans type, ou type déjà conforme) ; sinon { ok:false,
   categorie, cur, twin } avec `cur` la fiche actuelle et `twin` la fiche du
   bon type si elle existe. */
export const depenseLinkStatus = (recettes, d) => {
  const categorie = txt(d && d.categorie);
  if (!categorie) return { ok: true };
  const cur = recetteOfId(recettes, d && d.recetteId);
  if (!cur) return { ok: true, orphan: true };
  if (!txt(cur.type)) return { ok: true, noType: true };
  if (sameCatType(categorie, cur.type)) return { ok: true };
  return { ok: false, categorie, cur, twin: findRecetteTwin(recettes, cur, categorie) };
};

/* Trace ajoutée aux « Commentaires » lors d’une réattribution automatique. */
export const relinkTraceText = (d, cur, twin) => {
  const date = new Date().toLocaleDateString('fr-FR');
  const from = `${cur.ligne || cur.id}${txt(cur.type) ? ` (${cur.type})` : ''}`;
  const to = `${twin.ligne || twin.id}${txt(twin.type) ? ` (${twin.type})` : ''}`;
  return `[Réattribution auto ${date}] La catégorie « ${txt(d.categorie)} » ne correspondait pas au type de la ligne imputée. Dépense réattribuée de « ${from} » vers « ${to} ».`;
};

export const appendComment = (d, line) => {
  const base = txt(d && d.commentaires);
  return base ? `${base}\n${line}` : line;
};
