/* =========================================================================
   _reference_complete_test.mjs — COMPLÉTER UNE RÉFÉRENCE INCOMPLÈTE.

   Ce que l'utilisateur demande : « l'information incomplète de la référence
   (auteurs, titre manquants…) n'est pas reconstruite quand j'importe les
   références ». Vérifié ici sur le module RÉEL (src/utils/referenceEnrich.js,
   sans réseau : `fetchImpl` est remplacé) :

     • les champs vides sont remplis depuis les publications du laboratoire /
       « Relevant papers » (hors ligne, par DOI / identifiant PubMed / titre) ;
     • ce qui manque encore (auteurs, titre) est cherché dans Crossref : par DOI
       quand l'entrée en a un, sinon par titre — et JAMAIS un autre papier ;
     • un champ déjà rempli n'est jamais écrasé ;
     • la page projet s'en sert à l'import (manuscrit ET références) et offre le
       bouton « ✨ Complete missing fields » pour les références déjà là.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  REFERENCE_COMPLETION_FIELDS, referenceGaps, referenceNeedsCompletion, sameTitle,
  completeFromPool, crossrefReference, crossrefRequestFor, completeFromCrossref,
  enrichReference, enrichReferences, enrichReport
} from './src/utils/referenceEnrich.js';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

/* ── 1. Ce qui manque ─────────────────────────────────────────────────────── */
eq(referenceGaps({ title: 'A paper', authors: '' }), ['authors', 'journal', 'year', 'volume', 'pages', 'doi', 'pmid'],
  'les champs vides sont listés, dans l’ordre d’importance');
eq(referenceGaps({ title: 'A', authors: 'B', journal: 'C', year: '2020', volume: '1', pages: '2', doi: '10.1/x', pmid: '1' }), [],
  'une référence complète n’a rien à compléter');
ok(referenceNeedsCompletion({ title: 'Titre', authors: '' }), 'sans auteurs, une référence doit être complétée');
ok(referenceNeedsCompletion({ title: '', authors: 'Rossi M' }), 'sans titre aussi');
ok(!referenceNeedsCompletion({ title: 'Titre', authors: 'Rossi M' }), 'titre + auteurs : rien d’urgent (les détails ne sont pas cherchés)');
ok(referenceNeedsCompletion({ title: 'Titre', authors: 'Rossi M', doi: '' }, { all: true }),
  'le bouton manuel, lui, comble TOUS les champs vides');
eq(REFERENCE_COMPLETION_FIELDS[0], 'authors', 'les auteurs sont le premier champ réparé');

/* ── 2. Le pot commun du laboratoire (hors ligne) ─────────────────────────── */
const PUB = {
  id: 'pub_1', title: 'Voltage-dependent gating of a membrane channel', authors: 'Marco Rossi, Anna Bianchi, John Smith',
  journal: 'Journal of Biological Chemistry', year: '2018', volume: '293', pages: '105678', doi: '10.1016/j.jbc.2018.01.001'
};
const partial = { id: 'ref_1', title: 'Voltage-dependent gating of a membrane channel', authors: '', link: 'https://doi.org/10.1016/j.jbc.2018.01.001' };
const fromPool = completeFromPool(partial, [PUB, { id: 'x', title: 'Autre papier' }]);
eq(fromPool.entry.authors, 'Marco Rossi, Anna Bianchi, John Smith', 'les auteurs complets arrivent par le DOI');
eq(fromPool.filled, ['authors', 'journal', 'year', 'volume', 'pages', 'doi'], '…et chaque champ vide est compté');
eq(completeFromPool({ ...partial, authors: 'Rossi M (corrigé à la main)' }, [PUB]).entry.authors,
  'Rossi M (corrigé à la main)', 'un champ déjà rempli n’est JAMAIS écrasé');
eq(completeFromPool(partial, []), { entry: partial, filled: [] }, 'sans pot commun, rien ne change (et rien n’est inventé)');
eq(completeFromPool({ id: 'r2', title: 'Un papier inconnu' }, [PUB]).filled, [], 'un papier introuvable ne reçoit aucun champ inventé');

/* ── 3. Crossref ──────────────────────────────────────────────────────────── */
const ITEM = {
  DOI: '10.1016/j.jbc.2018.01.001',
  title: ['Voltage-dependent gating of a membrane channel'],
  author: [{ given: 'Marco', family: 'Rossi' }, { given: 'Anna', family: 'Bianchi' }],
  'container-title': ['Journal of Biological Chemistry'],
  issued: { 'date-parts': [[2018, 5, 3]] },
  volume: '293', page: '105678-105689'
};
eq(crossrefReference(ITEM), {
  title: 'Voltage-dependent gating of a membrane channel', authors: 'Marco Rossi, Anna Bianchi',
  journal: 'Journal of Biological Chemistry', year: '2018', volume: '293', pages: '105678-105689',
  doi: '10.1016/j.jbc.2018.01.001'
}, 'un « work » Crossref devient une référence du programme (mêmes conventions que Publications)');
eq(crossrefRequestFor({ doi: '10.1016/j.jbc.2018.01.001' }).url,
  'https://api.crossref.org/works/10.1016%2Fj.jbc.2018.01.001', 'un DOI connu ⇒ la requête exacte (pas de recherche)');
ok(crossrefRequestFor({ title: '' }) === null, 'sans DOI ni titre, aucune requête (rien à chercher)');
ok(crossrefRequestFor({ title: 'A paper' }).url
  .includes(`query.bibliographic=${encodeURIComponent('A paper')}`), 'sinon la recherche porte sur le titre');
const TITLE = 'Voltage-dependent gating of a membrane channel';
eq(crossrefRequestFor({ title: TITLE }).pick({ message: { items: [ITEM, { title: ['Autre chose'] }] } }).doi,
  '10.1016/j.jbc.2018.01.001', 'seul le titre qui CORRESPOND est retenu');
eq(crossrefRequestFor({ title: TITLE }).pick({ message: { items: [{ title: ['Autre chose'], DOI: '10.9/z' }] } }),
  null, 'aucun titre correspondant ⇒ rien (jamais un autre papier)');
ok(sameTitle('Voltage-dependent gating of a membrane channel', 'Voltage dependent gating of a membrane channel.'),
  'la ponctuation et la casse ne comptent pas');
ok(!sameTitle('Gating of a channel', 'Voltage-dependent gating of a membrane channel in cancer cells'),
  'un titre trop COURT ne « contient » pas un titre long (faux positif évité)');
ok(sameTitle('Voltage-dependent gating of a membrane channel',
  'Voltage-dependent gating of a membrane channel (voltage-gated)'),
  'un titre long retrouvé avec une précision en plus reste le même papier');
ok(!sameTitle('', 'Titre'), 'un titre vide ne correspond à rien');

/* Le porteur des requêtes : on remplace `fetch` (aucun accès réseau dans un test). */
const fetchJson = (payload) => {
  const calls = [];
  const impl = async (url) => { calls.push(url); return { ok: true, json: async () => payload }; };
  impl.calls = calls;
  return impl;
};

const webEntry = { id: 'r3', title: 'Voltage-dependent gating of a membrane channel', authors: '', doi: '10.1016/j.jbc.2018.01.001' };
const byDoi = await completeFromCrossref(webEntry, { fetchImpl: fetchJson({ message: ITEM }) });
eq(byDoi.filled, ['authors', 'journal', 'year', 'volume', 'pages'], 'Crossref remplit ce qui manquait (le DOI était déjà là)');
eq(byDoi.entry.authors, 'Marco Rossi, Anna Bianchi', '…auteurs compris');
eq(byDoi.failed, false, '…et la requête est un succès');

const byTitle = await completeFromCrossref(
  { id: 'r4', title: 'Voltage-dependent gating of a membrane channel', authors: 'Rossi M' },
  { fetchImpl: fetchJson({ message: { items: [ITEM] } }) }
);
eq(byTitle.entry.doi, '10.1016/j.jbc.2018.01.001', 'sans DOI, le titre retrouve le papier (et son DOI)');
eq(byTitle.entry.authors, 'Rossi M', 'l’auteur déjà écrit (format PubMed) n’est pas écrasé par celui de Crossref');

const broken = await completeFromCrossref(webEntry, { fetchImpl: async () => { throw new Error('offline'); } });
eq([broken.filled, broken.failed], [[], true], 'un service injoignable est signalé (l’import continue sans attendre)');
const notFound = await completeFromCrossref(webEntry, { fetchImpl: fetchJson({ message: { items: [] } }) });
eq(notFound.entry, webEntry, 'un papier introuvable sur Crossref ressort tel quel');

/* ── 4. Entrée par entrée, puis par liste ─────────────────────────────────── */
const poolOnly = fetchJson({ message: ITEM });
const one = await enrichReference({ id: 'r5', title: 'Voltage-dependent gating of a membrane channel' }, { pool: [PUB], fetchImpl: poolOnly });
eq(one.sources, ['the lab publications'], 'le pot commun répond d’abord (aucun appel réseau nécessaire)');
eq(one.entry.authors, 'Marco Rossi, Anna Bianchi, John Smith', '…et la référence sort complète');
eq(poolOnly.calls, [], 'aucune requête n’est faite quand le pot commun suffit');

const many = await enrichReferences(
  [{ id: 'a', title: '', doi: '10.1016/j.jbc.2018.01.001' }, { id: 'b', title: 'Titre', authors: 'Rossi M' }, null],
  { pool: [], fetchImpl: fetchJson({ message: ITEM }) }
);
eq(many.completed, 1, 'seules les entrées incomplètes sont travaillées');
eq(many.skipped, 2, 'une entrée déjà complète (et l’entrée vide) sont comptées comme « rien à faire »');
eq(many.list[0].title, 'Voltage-dependent gating of a membrane channel', 'le titre manquant est retrouvé');
eq(many.list[1].title, 'Titre', 'les autres entrées restent identiques');
ok(enrichReport(many).startsWith('✨ 1 reference(s) completed'), 'le compte rendu dit combien de références ont été complétées');
eq(enrichReport({ completed: 0 }), '', 'aucun travail ⇒ aucun compte rendu (l’appelant choisit quoi dire)');

const offline = await enrichReferences(
  [{ id: 'a', title: 'Un titre sans DOI' }, { id: 'b', title: 'Un autre titre' }, { id: 'c', title: 'Encore un' }],
  { fetchImpl: async () => { throw new Error('offline'); } }
);
eq(offline.completed, 0, 'hors ligne, rien n’est inventé');
eq(offline.offline, true, '…et l’enrichissement s’arrête de lui-même après deux échecs');

/* ── 5. Le câblage dans la page projet ───────────────────────────────────── */
const PROJ = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
ok(PROJ.includes("import { enrichReferences, enrichReport } from '../../utils/referenceEnrich';"),
  'la page projet importe l’enrichissement');
ok(PROJ.includes('const completed = await enrichReferences(pickedEntries, { pool: citationPool });'),
  '« 📄 Import references from a paper » complète les entrées cochées AVANT de les ranger');
ok(PROJ.includes('const chosen = completed.list.map((entry) => projectBibEntry(entry, project, genProjectId()));'),
  '…c’est l’entrée complétée qui rejoint la bibliographie du projet');
ok(PROJ.includes('const numbered = numberImportedReferences(completed.list, refs);'),
  '…et c’est elle qui reçoit son numéro (le texte et le document la montrent donc complète)');
ok(PROJ.includes('const bib = await enrichReferences(projectBib, { pool: citationPool, all: true });')
  && PROJ.includes('const numbered = await enrichReferences(refs, { pool: citationPool, all: true });'),
  'le bouton « ✨ Complete missing fields » reprend la bibliographie ET les références numérotées du projet');
ok(PROJ.includes('✨ Complete missing fields') && PROJ.includes('onClick={completeProjectReferences}'),
  '…et il est offert dans la section « 📚 Bibliography »');
ok(PROJ.includes('⚠ no authors recorded — use “✨ Complete missing fields” below'),
  'une référence sans auteurs le dit, avec la marche à suivre');
ok(PROJ.includes('commitProjectVerified(patch, { lighten: true })'),
  '…et l’écriture vérifiée est utilisée (un magasin plein ne fait pas disparaître les réparations en silence)');
ok(PROJ.includes('An incomplete entry is completed before it is stored'),
  'la fenêtre d’import de références annonce la complétion');

console.log(`_reference_complete_test: ${passed} passed`);
