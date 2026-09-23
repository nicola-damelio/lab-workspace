/* =========================================================================
   _auth_identity_test.mjs — L'UTILISATEUR CONNECTÉ EST TOUJOURS LE BON.

   Deux défauts signalés, tous les deux dans la session :

     1. « parfois, en entrant son mot de passe, on ne voit pas sa page mais
        celle d'un utilisateur générique ; il faut recharger pour retrouver la
        bonne page ». Cause : DEUX écritures concurrentes de l'identité — la
        connexion par mot de passe (id de l'opérateur, et par lui le
        `personnelId` de la fiche Personnel) et l'écouteur d'état Firebase
        (`onAuthStateChanged`, qui ne connaît QUE l'uid Firebase). Quand
        l'écouteur écrivait en dernier, `adminAccessProfile` ne retrouvait plus
        la fiche par id : il ne restait que la correspondance de NOM, et sans
        correspondance le profil tombait sur « Non permanent » sans fonction,
        c'est-à-dire les pages d'un utilisateur générique. D'où le caractère
        INTERMITTENT (l'ordre d'arrivée des deux écritures dépend du réseau —
        les revendications du jeton, elles, peuvent venir du cache) et le
        rechargement qui « répare » (l'identité bonne, elle, est mémorisée).

     2. « la session ne se ferme jamais : qui s'assoit devant ce poste n'a plus
        besoin du mot de passe ». Cause : `firebase.auth()` sans
        `setPersistence` garde le jeton de rafraîchissement dans IndexedDB
        (« local ») et l'écouteur reconstruisait l'identité à chaque
        chargement — fermeture du navigateur comprise.

   Ce qui est vérifié ici, avec les modules RÉELS :
     • `memberIdentity` (src/utils/auth.js) est le SEUL point de vérité : quel
       que soit l'ordre des deux écritures, la même identité en sort — id de
       l'opérateur conservé, `personnelId` conservé, nom précédent jamais
       remplacé par une revendication vide ;
     • `adminAccessProfile` retrouve la fiche Personnel quand l'identité ne
       porte plus que l'uid, et l'échec de liaison est bien ce qui produit le
       profil générique (page Congés seule) ;
     • App.jsx passe par cette règle des DEUX côtés (écran de connexion,
       modale et écouteur d'état), et la persistance Firebase est « session » :
       la session ne survit plus à la fermeture du navigateur.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { memberIdentity, opNameKey, operatorForName, normalizeOperators } from './src/utils/auth.js';
import {
  ADMIN_PAGES, DEFAULT_OPTIONS, adminAccessProfile, adminCanViewPage, adminPageIdsFor,
} from './src/administration/adminSchema.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};
const count = (src, re) => (src.match(re) || []).length;
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what} — introuvable : ${needle}`);
  passed += 1;
};
const hasNot = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what} — encore présent : ${needle}`);
  passed += 1;
};

/* Lu en normalisant les fins de ligne (le dépôt est en CRLF sous Windows) :
   les vérifications peuvent alors porter sur un fragment de plusieurs lignes. */
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');

/* ── Le jeu de données de l'équipe et de la base d'administration ──────────
   `personnelId` est la liaison explicite faite dans Paramètres › Équipe ; il
   n'existe que dans la liste LOCALE des opérateurs (le roster servi par le
   serveur de jetons ne donne que { id, name, role }). */
const operators = normalizeOperators([
  { id: 'op_nico', name: 'Damélio Nicolas', role: 'user', personnelId: 'pers_nico', passwordHash: 'x' },
  { id: 'op_boss', name: 'Martin Claire', role: 'superuser', personnelId: 'pers_boss', passwordHash: 'y' },
]);
const personnel = [
  { id: 'pers_nico', nom: 'Damélio Nicolas', type: 'Permanent', fonction: 'Gestionnaire' },
  { id: 'pers_boss', nom: 'Martin Claire', type: 'Permanent', fonction: [] },
];

/* ── 1. Reconnaissance d'un opérateur par son nom ───────────────────────── */
eq(opNameKey('Damélio Nicolas'), opNameKey('NICOLAS  damelio !'),
  'accents, casse, ponctuation et ordre des mots ne changent pas la clé d’un nom');
eq(opNameKey(''), '', 'un nom vide n’a pas de clé (il ne peut donc désigner personne)');
eq(operatorForName(operators, 'damelio nicolas')?.id, 'op_nico',
  'l’opérateur est retrouvé par son nom, accents et ordre compris');
eq(operatorForName(operators, 'Personne Inconnue'), null, 'un nom inconnu ne désigne personne');

/* ── 2. L'identité canonique : la MÊME quelle que soit l'écriture ───────── */
const viaLogin = memberIdentity(
  { id: 'op_nico', name: 'Damélio Nicolas', role: 'user', personnelId: 'pers_nico' },
  { operators, previous: null }
);
eq(viaLogin.id, 'op_nico', 'la connexion garde l’id de l’opérateur');
eq(viaLogin.personnelId, 'pers_nico', 'la connexion garde le lien vers la fiche Personnel');

/* C'est CETTE écriture qui, avant, remplaçait l'id de l'opérateur par l'uid. */
const viaListener = memberIdentity(
  { id: 'UID_FIREBASE_28_CARACTERES', name: 'Damélio Nicolas', role: 'user' },
  { operators, previous: null }
);
eq(viaListener.id, 'op_nico',
  'l’écouteur Firebase ne remplace plus l’id de l’opérateur par l’uid (le lien `personnelId` survit)');
eq(viaListener.personnelId, 'pers_nico', '…et le profil pourra donc retrouver la fiche Personnel');
eq(JSON.stringify(viaListener), JSON.stringify(viaLogin),
  'les DEUX écritures produisent la même identité : l’ordre d’arrivée n’a plus d’effet');

const sansNom = memberIdentity(
  { id: 'UID_FIREBASE', name: '', role: 'user' },
  { operators, previous: viaLogin }
);
eq(sansNom.name, 'Damélio Nicolas', 'une revendication sans nom ne fait pas perdre l’identité acquise');
eq(sansNom.id, 'op_nico', '…ni l’id de l’opérateur');
eq(sansNom.personnelId, 'pers_nico', '…ni la fiche Personnel');
eq(memberIdentity({ id: 'UID', name: 'Martin Claire', role: 'superuser' }, { operators }).role, 'superuser',
  'le rôle signé par le serveur reste celui de la session');

const inconnu = memberIdentity({ id: 'UID_X', name: 'Voisin Inconnu', role: 'user' }, { operators, previous: null });
eq(inconnu.id, 'UID_X', 'un membre absent de la liste locale n’est pas effacé : son id est conservé');
eq(inconnu.name, 'Voisin Inconnu', '…ainsi que son nom');
eq(inconnu.personnelId, null, '…et aucune fiche Personnel ne lui est inventée');
eq(memberIdentity(null, {}).role, 'user', 'une entrée absente ne fait pas lever d’exception');
eq(memberIdentity(null, {}).id, '', '…et donne une identité vide, jamais un objet cassé');

/* ── 3. Le profil d'administration suit la fiche, pas l'uid ─────────────── */
const profUid = adminAccessProfile(viaListener, operators, personnel);
eq(profUid.person && profUid.person.id, 'pers_nico',
  'la fiche Personnel est retrouvée même avec l’identité de l’écouteur (liaison par l’opérateur de même nom)');
eq(profUid.statut, 'Permanent', 'le statut vient bien de la fiche (et non du statut minimal)');
ok(profUid.fonctions.indexOf('Gestionnaire') !== -1, 'la fonction Gestionnaire de la fiche est reconnue');

const profParLien = adminAccessProfile(
  { id: 'UID', name: '', role: 'user', personnelId: 'pers_nico' }, operators, personnel
);
eq(profParLien.person && profParLien.person.id, 'pers_nico',
  'un `personnelId` porté par l’identité (roster local) suffit à relier la fiche');

/* Le profil GÉNÉRIQUE — celui qui s'affichait à la place du bon : aucune
   liaison possible (uid inconnu, nom vide). Il reste le dernier recours d'un
   inconnu, mais ne doit plus jamais apparaître pour un membre identifiable. */
const profGenerique = adminAccessProfile({ id: 'UID_FIREBASE', name: '', role: 'user' }, operators, personnel);
eq(profGenerique.statut, 'Non permanent', 'sans liaison, le profil est bien le profil générique');
eq(profGenerique.person, null, '…sans fiche Personnel');
const pagesGenerique = adminPageIdsFor(profGenerique, DEFAULT_OPTIONS);
ok(pagesGenerique.has('conges'), '…qui n’ouvre que les pages d’un non-permanent');
ok(!pagesGenerique.has('depenses'),
  '…et PAS les pages du membre : c’est exactement la « page d’un utilisateur générique » signalée');

/* Bout en bout, par l'API réellement utilisée par App.jsx. */
const pageDepenses = ADMIN_PAGES.find((p) => p.id === 'depenses');
ok(adminCanViewPage(pageDepenses, viaListener, operators, personnel, DEFAULT_OPTIONS),
  'la page Dépenses est ouverte au Gestionnaire, y compris via l’identité de l’écouteur');
ok(!adminCanViewPage(pageDepenses, { id: 'UID_FIREBASE', name: '', role: 'user' }, operators, personnel, DEFAULT_OPTIONS),
  'elle ne l’est pas pour le profil générique');

/* ── 4. La session suit l'onglet, et les deux écritures passent par la règle */
has(APP, 'auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION)',
  'la session Firebase ne survit plus à la fermeture du navigateur');
has(APP, "const SESSION_TAB_KEY = 'labSessionTab'", 'le marqueur d’onglet de la session existe');
has(APP, "sessionStorage.getItem(SESSION_TAB_KEY) === '1'",
  'l’écouteur distingue la session de CET onglet d’une session d’une exécution précédente');
eq(count(APP, /sessionStorage\.setItem\(SESSION_TAB_KEY, '1'\)/g), 2,
  'le marqueur est posé à la connexion ET par l’écouteur (les deux chemins)');
has(APP, 'sessionStorage.removeItem(SESSION_TAB_KEY)',
  'la déconnexion explicite efface aussi le marqueur d’onglet');
eq(count(APP, /adoptIdentity\(\{/g), 5,
  'les deux écrans de connexion (mode serveur ET hors serveur) et l’écouteur d’état écrivent l’identité par le MÊME point de vérité');
hasNot(APP, 'setCurrentUser(user)', 'plus aucune écriture d’identité directe depuis un formulaire');
eq(count(APP, /setCurrentUser\(identity\)/g), 1,
  'l’identité n’est plus écrite qu’à UN SEUL endroit : le point unique adoptIdentity');
has(APP, 'identityRef.current = identity;\n    setCurrentUser(identity);',
  '…et c’est bien cette écriture-là (identité mémorisée puis publiée par le même appel)');
eq(count(APP, /id: fbUser\.uid/g), 1,
  'l’uid Firebase n’est plus utilisé que comme entrée de la règle d’identité, jamais comme identité');
has(APP, 'if (!normalized.length) return;',
  'une liste d’opérateurs encore VIDE ne fait pas conclure « ce compte n’existe plus »');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_auth_identity_test.mjs — ${passed} assertions OK (l’utilisateur connecté est toujours le bon, et la session suit l’onglet)`);
