/* =========================================================================
   _approval_bc_probe.jsx — RENDU RÉEL (SSR dans Node) des pages
   « Approbation devis & BC » et « Achats prévus / souhaités ».

   Les vérifications qui LISENT le source (voir _approval_bc_flow_test.mjs)
   attrapent une consigne perdue, jamais une erreur qui n'existe qu'au RENDU
   (TDZ d'un useEffect, valeur lue pendant le rendu, tableau mélangeant deux
   natures de lignes…). Ce probe monte vraiment les deux pages dans Node
   (react-dom/server exécute les corps de composants) et rend une ligne par
   cible :
       ok | <label> | <HTML rendu, encodé en JSON>
       threw | <label> | <message>   (+ 1 ligne de pile)
   Code de sortie : 1 dès qu'une cible a jeté.
   Lancé par _approval_bc_flow_test.mjs (build SSR puis exécution).
   ========================================================================= */
import { writeSync } from 'node:fs';

/* ── Globals navigateur ─────────────────────────────────────────────────────
   Les pages importent des utilitaires de Google Drive (OAuth) : ils lisent
   `window` / `document` à l'évaluation du module. Ces bouchons ne servent QU'À
   permettre le chargement dans Node — aucun rendu ne doit en dépendre. */
const stubEl = () => ({
  style: {}, setAttribute() {}, appendChild() {}, removeChild() {},
  addEventListener() {}, removeEventListener() {}, getContext: () => null,
  getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
});
const setGlobal = (key, value) => { try { globalThis[key] = value; } catch { /* getter seul */ } };
setGlobal('window', globalThis);
setGlobal('document', {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: stubEl, createElementNS: stubEl, createTextNode: () => ({}),
  head: stubEl(), body: stubEl(), documentElement: stubEl(),
  addEventListener() {}, removeEventListener() {},
});
setGlobal('navigator', { userAgent: 'node-test', language: 'fr-FR', languages: ['fr-FR'] });
setGlobal('localStorage', {
  getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0,
});
setGlobal('sessionStorage', globalThis.localStorage);

import React from 'react';
import { renderToString } from 'react-dom/server';
import { AdminProvider } from './src/administration/AdminContext';
import { ApprobationPage } from './src/administration/approbationPage';
import { DesiderataPage } from './src/administration/desiderataPage';

const out = (line) => writeSync(1, `${line}\n`);
const YEAR = new Date().getFullYear();

const SUPER = { id: 'op-super', name: 'Alice Martin', role: 'superuser' };
const MEMBER = { id: 'op-member', name: 'Bob Durand', role: 'user' };
const OPERATORS = [SUPER, MEMBER];
const PERSONNEL = [
  { id: 'p1', nom: 'Alice Martin', statut: 'Permanent', email: 'alice@labo.fr', fonction: 'Gestionnaire' },
  { id: 'p2', nom: 'Bob Durand', statut: 'Permanent', email: 'bob@labo.fr' },
];

/* Jeu d'essai : un devis EN ATTENTE (« DEV-EN-ATTENTE »), un devis SIGNÉ AVEC
   bon de commande déposé (« DEV-SIGNE-AVEC-BC »), un devis SIGNÉ SANS bon de
   commande (« DEV-SIGNE-SANS-BC » — c'est lui qui doit apparaître « à faire »
   dans la section des BC) et le BC à approuver (« BC-DEPOSE-A-APPROUVER »). */
const DEVIS_BC = [
  {
    id: 'd-attente', kind: 'devis', statut: 'En attente', description: 'DEV-EN-ATTENTE microscope',
    numDevis: 'DEV-001', fournisseur: 'Fournisseur Un', deposant: 'Alice Martin',
    ligneBudgetaire: 'S2R01', demandeur: 'Alice Martin', createdAt: 3000,
  },
  {
    id: 'd-signe', kind: 'devis', statut: 'Approuvé', description: 'DEV-SIGNE-AVEC-BC centrifugeuse',
    numDevis: 'DEV-002', fournisseur: 'Fournisseur Deux', deposant: 'Alice Martin',
    ligneBudgetaire: 'S2R02', demandeur: 'Alice Martin', createdAt: 2000,
    decidedBy: 'Alice Martin', decidedAt: 2500,
  },
  {
    id: 'd-signe-sans-bc', kind: 'devis', statut: 'Approuvé', description: 'DEV-SIGNE-SANS-BC spectromètre',
    numDevis: 'DEV-003', fournisseur: 'Fournisseur Deux', deposant: 'Alice Martin',
    ligneBudgetaire: 'S2R04', demandeur: 'Alice Martin', createdAt: 1500,
    decidedBy: 'Alice Martin', decidedAt: 1800,
  },
  {
    id: 'b-depose', kind: 'bc', statut: 'En attente', description: 'BC-DEPOSE-A-APPROUVER consommables',
    numBC: 'BC-001', devisId: 'd-signe', fournisseur: 'Fournisseur Trois', deposant: 'Alice Martin',
    ligneBudgetaire: 'S2R03', demandeur: 'Alice Martin', createdAt: 1000,
  },
];

const DESIDERATE = [
  {
    id: 'w-approuve', description: 'ACHAT-APPROUVE a transferer', demandeur: 'Alice Martin',
    fournisseur: 'Fournisseur Un', ligneBudgetaire: 'S2R01', montantEstime: 1200, fraisPort: 15,
    statut: 'Approuvé', numDevis: 'DEV-010', fichierUrl: 'https://drive.google.com/file/d/abc/view',
    dateDemande: `${YEAR}-01-15`, createdAt: 4000,
  },
  {
    id: 'w-transfere-signe', description: 'ACHAT-TRANSFERE-SIGNE', demandeur: 'Alice Martin',
    fournisseur: 'Fournisseur Deux', ligneBudgetaire: 'S2R02', montantEstime: 800, fraisPort: 0,
    statut: 'Approuvé', numDevis: 'DEV-011', fichierUrl: 'https://drive.google.com/file/d/def/view',
    dateDemande: `${YEAR}-01-10`, createdAt: 3500,
    transfert: { cible: 'Achats', by: 'Alice Martin', at: Date.now(), mode: 'signature', devisId: 'd-signe' },
  },
];

const ADMIN = {
  recettes: [], librerie: [], depenses: [], om: [], questioni: [], sicurezza: [],
  personnel: PERSONNEL,
  devisBc: DEVIS_BC,
  desiderate: DESIDERATE,
  settings: { approvalSignature: null },
};

const wrap = (user, content, children) => (
  <AdminProvider
    currentUser={user}
    user={user}
    operators={OPERATORS}
    content={content}
    onChange={() => {}}
    navigate={() => {}}
    focus={null}
    clearFocus={() => {}}
  >
    {children}
  </AdminProvider>
);

const target = (label, element) => {
  try {
    const html = renderToString(element);
    out(`ok | ${label} | ${JSON.stringify(html)}`);
  } catch (err) {
    out(`threw | ${label} | ${(err && err.message) || err}`);
    const frame = String((err && err.stack) || '').split('\n').filter((l) => l.trim())[1] || '';
    out(`  @ ${frame.trim()}`);
    process.exitCode = 1;
  }
};

target('approbation-superuser', wrap(SUPER, ADMIN, <ApprobationPage />));
target('approbation-membre', wrap(MEMBER, ADMIN, <ApprobationPage />));
target('achats-prevus-superuser', wrap(SUPER, ADMIN, <DesiderataPage />));
out('done');
