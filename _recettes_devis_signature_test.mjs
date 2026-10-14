/* =========================================================================
   _recettes_devis_signature_test.mjs — UN DEVIS DÉPOSÉ DIRECTEMENT DANS
   « APPROBATION DEVIS & BC » COMPTE DANS « DEVIS EN SIGNATURE / SIGNÉ ».

   Demande : « c'era un devis nella pagina approbation e non compariva nella
   colonna, dopo ché l'ho firmato e passato nella sezione BC ma ancora non
   c'era ».

   Deux causes distinctes, corrigées ensemble :
     1. la colonne ne sommait QUE les devis nés d'un achat prévu / souhaité
        (`sourceKind: 'desiderate'`) — un devis DÉPOSÉ À LA MAIN dans
        « Approbation devis & BC » (sa propre ligne budgétaire, aucun achat
        prévu ni OM d'origine) n'entrait dans AUCUNE colonne : d'où le 0,00 €
        AVANT comme APRÈS sa signature (un devis signé attend son BC dans la
        section « BC à faire et à approuver ») ;
     2. un devis VIVANT ne suffisait pas à considérer le transfert comme fait
        (il fallait aussi la marque `transfert` sur la demande), alors que
        `desiderataTransferStatus` — la source de vérité de l'application —
        reconnaît `rec.transfert || devis`.

   Ce qui doit rester vrai :
     · la règle vit dans UN endroit testable (src/administration/
       transferAchats.js : `directDevisEnSignature`, `recetteIdOfDeposit`) et
       la page Recettes ne fait que la consommer ;
     · un devis déposé directement compte sur SA ligne budgétaire — `recetteId`
       choisi au dépôt, sinon l'intitulé « Ligne budgétaire » résolu dans les
       fiches Recettes (catégorie d'abord) : les MÊMES règles que la dépense
       « BC signé » créée à l'approbation du BC, donc aucun saut de colonne ;
     · « En attente » (en signature) ET « Approuvé » (signé, BC à signer)
       comptent ; « En gestion » (à compléter) et « Refusé » ne comptent pas ;
     · dès que le BC est signé, la dépense liée prend le relais dans
       « Achats (BC signé) » et le devis quitte la colonne ;
     · les devis nés d'un transfert (achat prévu / OM) gardent leur chemin
       actuel : jamais comptés deux fois ;
     · le montant de la colonne (montant + frais de port) et le solde prévu
       suivent le même total.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const { directDevisEnSignature, recetteIdOfDeposit, isDepenseBcSigne, desiderataTransferStatus } =
  await import('./src/administration/transferAchats.js');

let passed = 0;
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};

const SRC = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PAGE = SRC('src/administration/recettesPage.jsx');
const APPROBATION = SRC('src/administration/approbationPage.jsx');
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const ids = (list) => list.map((x) => x.id).join(',');
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ── Le décor : deux fiches « jumelles » (même intitulé, deux types) ─────── */
const RECETTES = [
  { id: 'r-fonc', ligne: 'Overvalc (FED25001)', type: 'Fonctionnement' },
  { id: 'r-inv', ligne: 'Overvalc (FED25001)', type: 'Investissement' },
  { id: 'r-mic', ligne: 'Microscopie', type: 'Investissement' },
];
/* Un devis TEL QU'IL EST DÉPOSÉ dans « Approbation devis & BC » : sa ligne
   budgétaire (`recetteId`) est celle du formulaire de dépôt. */
const devisOf = (id, extra = {}) => ({ id, kind: 'devis', statut: 'En attente', recetteId: 'r-mic', ...extra });

/* ── 1. Rattachement d'un devis déposé à sa ligne budgétaire ─────────────── */
eq(recetteIdOfDeposit({ recetteId: 'r-mic' }, RECETTES), 'r-mic',
  'le recetteId choisi au dépôt rattache le devis à sa ligne');
eq(recetteIdOfDeposit({ recetteId: 'r-fonc', ligneBudgetaire: 'Microscopie' }, RECETTES), 'r-fonc',
  'le recetteId explicite l’emporte sur l’intitulé');
eq(recetteIdOfDeposit({ ligneBudgetaire: 'Microscopie' }, RECETTES), 'r-mic',
  'sans recetteId, l’intitulé « Ligne budgétaire » est résolu dans les fiches Recettes (données plus anciennes)');
eq(recetteIdOfDeposit({ ligneBudgetaire: 'Overvalc (FED25001)', categorie: 'Investissement' }, RECETTES), 'r-inv',
  'la catégorie choisit la bonne fiche jumelle (Investissement)');
eq(recetteIdOfDeposit({ ligneBudgetaire: 'Overvalc (FED25001)', categorie: 'Fonctionnement' }, RECETTES), 'r-fonc',
  'même intitulé, catégorie Fonctionnement ⇒ l’autre fiche jumelle');
eq(recetteIdOfDeposit({}, RECETTES), '',
  'sans recetteId ni ligne budgétaire, aucun rattachement (le devis n’est imputé sur aucune ligne)');
eq(recetteIdOfDeposit({ ligneBudgetaire: 'Ligne inconnue' }, RECETTES), '',
  'un intitulé qui ne correspond à aucune fiche ne crée pas de rattachement');

/* ── 2. Cause n° 1 : le devis déposé à la main compte « en signature » ──── */
const DIRECT_PENDING = devisOf('d-direct-1', { statut: 'En attente', montant: 1200, fraisPort: 50 });
eq(ids(directDevisEnSignature([DIRECT_PENDING], [], RECETTES, 'r-mic')), 'd-direct-1',
  'un devis déposé directement « En attente » compte sur sa ligne budgétaire');
eq(directDevisEnSignature([DIRECT_PENDING], [], RECETTES, 'r-fonc').length, 0,
  'il ne compte pas sur une autre ligne budgétaire');
const DIRECT_SIGNE = devisOf('d-direct-2', { statut: 'Approuvé', montant: 3400 });
eq(ids(directDevisEnSignature([DIRECT_SIGNE], [], RECETTES, 'r-mic')), 'd-direct-2',
  'un devis déposé directement puis SIGNÉ (BC à signer) reste compté « en signature/signé » — le scénario rapporté');

/* ── 3. Ce qui ne compte pas dans cette colonne ─────────────────────────── */
eq(directDevisEnSignature([devisOf('d-gestion', { statut: 'En gestion' })], [], RECETTES, 'r-mic').length, 0,
  'un devis « En gestion » (à compléter, pas encore envoyé pour signature) ne compte pas');
eq(directDevisEnSignature([devisOf('d-refuse', { statut: 'Refusé' })], [], RECETTES, 'r-mic').length, 0,
  'un devis refusé ne compte pas');
eq(directDevisEnSignature([{ id: 'b1', kind: 'bc', statut: 'En attente', recetteId: 'r-mic' }], [], RECETTES, 'r-mic').length, 0,
  'un BC déposé n’est pas un devis (c’est le devis rattaché qui porte le montant)');

/* ── 4. Jamais deux fois : les devis d’un transfert gardent leur chemin ─── */
const DV_DEMANDE = {
  id: 'd-des', kind: 'devis', statut: 'En attente', recetteId: 'r-mic',
  sourceKind: 'desiderate', sourceId: 'w1',
};
const DV_OM = {
  id: 'd-om', kind: 'devis', statut: 'En attente', recetteId: 'r-mic',
  sourceKind: 'om', sourceId: 'om1', sourcePart: 'transport',
};
eq(ids(directDevisEnSignature([DV_DEMANDE, DV_OM, DIRECT_PENDING], [], RECETTES, 'r-mic')), 'd-direct-1',
  'les devis nés d’un transfert (achat prévu / OM) sont laissés à leur colonne (jamais comptés deux fois)');

/* ── 5. Le BC signé fait sortir le devis, la dépense prend le relais ────── */
const DEP_SIGNEE = { id: 'dep-1', recetteId: 'r-mic', statut: 'BC signé', dateSignature: '2026-03-04' };
const DV_SIGNE_DEP = devisOf('d-direct-3', { statut: 'Approuvé', montant: 2000, depenseId: 'dep-1' });
eq(isDepenseBcSigne(DEP_SIGNEE), true, 'une dépense « BC signé » a bien son bon de commande signé');
eq(directDevisEnSignature([DV_SIGNE_DEP], [DEP_SIGNEE], RECETTES, 'r-mic').length, 0,
  'BC signé ⇒ le devis quitte la colonne (sa dépense est comptée dans « Achats (BC signé) »)');
eq(DEP_SIGNEE.recetteId, DV_SIGNE_DEP.recetteId,
  'la dépense créée à l’approbation du BC tombe sur la MÊME ligne budgétaire que le devis (aucun saut de colonne)');
has(APPROBATION, 'let recetteId = txt(rec.recetteId) || txt(devisRec.recetteId) || txt(srcDep && srcDep.recetteId);',
  'la page d’approbation reprend le recetteId du devis pour créer la dépense');
has(APPROBATION, 'if (!recetteId && ligneBudgetaire) {',
  'sinon elle le retrouve par l’intitulé + la catégorie (même résolution que `recetteIdOfDeposit`)');

/* ── 6. BC pas encore signé / devis « orphelin » ────────────────────────── */
const DEP_EN_COURS = { id: 'dep-2', recetteId: 'r-mic', statut: 'Devis en cours' };
eq(isDepenseBcSigne(DEP_EN_COURS), false,
  'une dépense sans date de signature ni statut « BC signé » ne l’est pas');
eq(directDevisEnSignature([devisOf('d-direct-4', { statut: 'Approuvé', depenseId: 'dep-2' })], [DEP_EN_COURS], RECETTES, 'r-mic').length, 1,
  'BC pas encore signé ⇒ le devis reste dans la colonne « Devis en signature/signé »');
eq(directDevisEnSignature([devisOf('d-orphelin', { statut: 'Approuvé', depenseId: 'dep-disparue' })], [], RECETTES, 'r-mic').length, 0,
  'devis « orphelin » (dépense liée supprimée) : plus rien ne le relie à la page d’approbation');

/* ── 7. Le montant de la colonne : « en signature » + « signé (BC à faire) » ─ */
const columnTotal = (list, deps) => directDevisEnSignature(list, deps, RECETTES, 'r-mic')
  .reduce((s, dv) => s + toNum(dv.montant) + toNum(dv.fraisPort), 0);
eq(columnTotal(
  [DIRECT_PENDING, DIRECT_SIGNE, DV_DEMANDE, DV_OM, DV_SIGNE_DEP, devisOf('d-gestion', { statut: 'En gestion' })],
  [DEP_SIGNEE],
), 1200 + 50 + 3400,
  'montant de la colonne = devis en attente + devis signés (BC à signer), hors devis soldés, transférés ou à compléter');

/* ── 8. Cause n° 2 : le critère de transfert est celui de l’application ──── */
const demandeSansMarque = { id: 'w1', statut: 'Approuvé' };
eq(desiderataTransferStatus(demandeSansMarque, [DV_DEMANDE], []).transferred, true,
  'un devis vivant suffit : `desiderataTransferStatus` voit la demande transférée SANS la marque `transfert`');
eq(desiderataTransferStatus(demandeSansMarque, [], []).transferred, false,
  'sans devis ni marque `transfert`, la demande n’est toujours pas transférée');
has(PAGE, 'const transferred = !!(d.transfert || dv);',
  'la page Recettes utilise ce MÊME critère (marque `transfert` OU devis vivant) pour classer la demande');

/* ── 9. Le câblage de la page « Recettes » ──────────────────────────────── */
has(PAGE, "import { omTransferStatus, demandeTransferOrphaned, directDevisEnSignature } from './transferAchats';",
  'la page importe la règle (aucune seconde formule locale)');
has(PAGE, 'const devisEnSignatureDirects = directDevisEnSignature(devisBc, depenses, recettes, recId);',
  'les devis déposés directement sont calculés ligne par ligne');
has(PAGE, 'const devisEnSignatureTotal = desEnSignatureTotal + devisDirectsTotal;',
  'le total de la colonne additionne transferts et dépôts directs');
has(PAGE, 'value: (r) => Number(r.__agg.devisEnSignatureTotal) || 0,',
  'la colonne « Devis en signature/signé » affiche ce total');
has(PAGE, 'amount={r.__agg.devisEnSignatureTotal}',
  'le survol de la case porte le même montant');
has(PAGE, '...r.__agg.devisEnSignatureDirects.map((dv) => ({',
  'le survol liste aussi les devis déposés directement');
has(PAGE, 'value: euro.format(toNum(dv.montant) + toNum(dv.fraisPort)),',
  'le survol chiffre un devis direct comme la dépense à venir (montant + frais de port)');
has(PAGE, "'déposé dans Approbation devis & BC'].filter(Boolean).join(' · ')",
  'chaque devis déposé directement est signalé dans le survol');
has(PAGE, 'to: devisBcLink(dv),', 'le lien de la case mène à la page « Approbation devis & BC »');
has(PAGE, 'const soldePrevu = solde - omPrevuEnCours - desMontant - omEnSignatureTotal - devisEnSignatureTotal;',
  'le solde prévu déduit aussi ces devis (montants déjà transmis pour signature)');
has(PAGE, "{ key: 'desSign', label: 'Devis en signature/signé', value: agg.devisEnSignatureTotal, sign: '−' },",
  'le détail « Solde prévu » au survol utilise le même total');

/* ── Bilan ────────────────────────────────────────────────────────────── */
console.log(`_recettes_devis_signature_test.mjs — ${passed} assertions OK (un devis déposé dans « Approbation devis & BC » compte dans « Devis en signature/signé »)`);

