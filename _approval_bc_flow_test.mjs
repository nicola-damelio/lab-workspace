/* =========================================================================
   _approval_bc_flow_test.mjs — « DEVIS SIGNÉ → BC À FAIRE », et le dépôt du BC
   depuis le devis (section « BC à faire et à approuver »).

   Ce qui doit rester vrai après ce correctif :
     1. un devis SIGNÉ ne reste plus dans « Devis à approuver » : il migre dans
        la section « BC à faire et à approuver » (ex-« Bons de commande à
        approuver ») — la règle vit dans UN endroit testable
        (src/administration/transferAchats.js : isDevisSigned / devisHasBc /
        devisAwaitingBc), pas seulement dans le JSX ;
     2. le bouton « Déposer un BC » a disparu : le bon de commande se dépose en
        cliquant la ligne du devis signé (le devis est déjà rattaché) ;
     3. « Ranger les fichiers » n'est visible que du superutilisateur ;
     4. dans « Achats prévus / souhaités », le bouton « ✓ Signature et BC »
        (ex-« ✓ Signature ») SIGNE le devis et le fait arriver directement dans
        la section des BC ; le bouton « → Devis & BC » a disparu ;
     5. la signature du document (copie « …_approuvé_signé.pdf ») a UNE seule
        implémentation — src/administration/depositSigning.js — utilisée par les
        deux chemins (page Approbation ET transfert depuis Achats prévus).

   Trois niveaux de vérification (comme les autres suites du dépôt) :
     · le CODE PUR des règles et des noms de fichiers (imports réels) ;
     · le RENDU RÉEL des deux pages (SSR via Vite, voir _approval_bc_probe.jsx) ;
     · le câblage du JSX (le source), pour ce qui n'est visible qu'au clic.
   ========================================================================= */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { build } from 'vite';

register('./_esm_test_hook.mjs', import.meta.url);

const {
  isDevisSigned, devisHasBc, devisAwaitingBc, desiderataTransferStatus,
  isDevisGestion, devisCompleteOf,
} = await import('./src/administration/transferAchats.js');
const {
  depositFileKindOf, sniffBudgetDocBytes, depositDocDriveNameOf, depositDocDriveFinalName,
  signedDocDriveName, budgetLaboPath, bytesToDataUrl, buildSignedDeposit,
} = await import('./src/administration/depositSigning.js');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};

/* ── 1. La règle de migration (code réel) ────────────────────────────────── */
const devis = (id, statut, extra = {}) => ({ id, kind: 'devis', statut, ...extra });
const bc = (id, statut, devisId, extra = {}) => ({ id, kind: 'bc', statut, devisId, ...extra });

eq(isDevisSigned(devis('d1', 'Approuvé')), true, 'un devis « Approuvé » est signé');
eq(isDevisSigned(devis('d2', 'En attente')), false, 'un devis « En attente » n’est pas signé');
eq(isDevisSigned(devis('d3', 'En gestion')), false, 'un devis « En gestion » n’est pas signé');
eq(isDevisSigned(bc('b1', 'Approuvé', 'd1')), false, 'un BC approuvé n’est pas « un devis signé »');
eq(isDevisSigned(null), false, 'sans ligne, aucun devis signé');

eq(devisHasBc([bc('b1', 'En attente', 'd1')], 'd1'), true, 'un BC déposé (même à approuver) prend le relais du devis');
eq(devisHasBc([bc('b1', 'Refusé', 'd1')], 'd1'), false, 'un BC REFUSÉ rend le devis à nouveau « à faire »');
eq(devisHasBc([bc('b1', 'En attente', 'd9')], 'd1'), false, 'un BC d’un autre devis ne compte pas');
eq(devisHasBc([], 'd1'), false, 'sans BC, le devis reste « à faire »');

const LIST = [
  devis('d-signe', 'Approuvé'),
  devis('d-signe-avec-bc', 'Approuvé'),
  devis('d-attente', 'En attente'),
  devis('d-gestion', 'En gestion'),
  devis('d-refuse', 'Refusé'),
];
const BCS = [bc('b-1', 'En attente', 'd-signe-avec-bc')];
eq(
  devisAwaitingBc(BCS, LIST).map((d) => d.id).join(','),
  'd-signe',
  'seuls les devis SIGNÉS sans bon de commande restent « à faire » dans la section des BC',
);
eq(devisAwaitingBc([], []).length, 0, 'aucune ligne « à faire » sans devis');

/* Le suivi d'un souhait transféré distingue « devis signé, BC à faire » de
   « en attente de signature » (badge de la page Achats prévus). */
const wish = { id: 'w1', transfert: { cible: 'Achats' } };
eq(
  desiderataTransferStatus(wish, [devis('d1', 'Approuvé', { sourceKind: 'desiderate', sourceId: 'w1' })], []).devisSigned,
  true,
  'un devis signé au transfert ⇒ le souhait affiche « Devis signé · BC à faire »',
);
eq(
  desiderataTransferStatus(wish, [devis('d2', 'En gestion', { sourceKind: 'desiderate', sourceId: 'w1' })], []).state,
  'devis-attente',
  'un devis « En gestion » reste « en attente de signature »',
);
eq(
  desiderataTransferStatus(wish, [devis('d1', 'Approuvé', { sourceKind: 'desiderate', sourceId: 'w1' })], []).state,
  'bc-a-faire',
  'devis signé sans dépense ⇒ état « bc-a-faire »',
);

/* Rappels utiles à la page : ces deux règles n'ont pas changé. */
eq(isDevisGestion(devis('d', 'En gestion')), true, '« En gestion » reste reconnu');
eq(
  devisCompleteOf({ numDevis: 'D-1', fichierUrl: 'https://drive.google.com/file/d/x/view' }),
  true,
  'un devis avec N° ET fichier est complet (donc signable au transfert)',
);

/* ── 2. Signature du document : une seule implémentation, testable ───────── */
eq(depositFileKindOf({ fichierNom: 'devis.pdf' }), 'pdf', 'un fichier .pdf est reconnu');
eq(depositFileKindOf({ fichierNom: 'scan.PNG' }), 'image', 'un .PNG est une image à signer');
eq(depositFileKindOf({ fichierMime: 'application/pdf' }), 'pdf', 'le type MIME suffit à reconnaître un PDF');
eq(depositFileKindOf({ fichierNom: 'budget.xlsx' }), 'other', 'un tableur n’est pas signable');

eq(sniffBudgetDocBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'pdf', 'l’en-tête %PDF identifie un PDF');
eq(sniffBudgetDocBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png', 'l’en-tête PNG identifie une image');
eq(sniffBudgetDocBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg', 'l’en-tête JPEG identifie une photo');
eq(sniffBudgetDocBytes(new Uint8Array([1, 2, 3, 4])), '', 'un contenu inconnu est signalé (jamais de fausse copie signée)');
eq(sniffBudgetDocBytes(null), '', 'sans octets, aucun type deviné');

const DEV = {
  kind: 'devis', statut: 'Approuvé', numDevis: '2026-015', ligneBudgetaire: 'S2R01',
  fournisseur: 'Fournisseur Un', demandeur: 'Alice Martin', description: 'Microscope',
  dateDepot: '2026-02-01',
};
ok(
  depositDocDriveNameOf(DEV).startsWith('Devis_2026-015_'),
  `le nom conventionnel commence par « Devis_<N°>_ » :: ${depositDocDriveNameOf(DEV)}`,
);
ok(depositDocDriveNameOf(DEV).includes('S2R01'), 'le nom conventionnel porte la ligne budgétaire');
ok(/_approuvé/.test(depositDocDriveFinalName(DEV)), 'un devis approuvé porte la marque « _approuvé »');
eq(
  depositDocDriveFinalName({ ...DEV, statut: 'En attente' }).includes('_approuvé'),
  false,
  'un devis en attente ne porte pas « _approuvé »',
);
ok(
  signedDocDriveName(DEV).endsWith('_approuvé_signé.pdf'),
  `la copie signée s’appelle « …_approuvé_signé.pdf » :: ${signedDocDriveName(DEV)}`,
);
eq(depositDocDriveNameOf({ kind: 'bc', numBC: '' }), '', 'sans N° de BC : aucun renommage (nom d’origine conservé)');
eq(budgetLaboPath('bc').join('/'), `Budget_labo/${new Date().getFullYear()}/BC`, 'le BC est classé dans Budget_labo/<année>/BC');
eq(budgetLaboPath('devis').join('/'), `Budget_labo/${new Date().getFullYear()}/Devis`, 'le devis dans Budget_labo/<année>/Devis');
ok(
  bytesToDataUrl(new Uint8Array([0x41])).startsWith('data:application/octet-stream;base64,QQ=='),
  'les octets d’une image deviennent un data:URL',
);

/* Best-effort : sans image de signature, RIEN n'est fait (aucun correctif) ;
   sans Google Drive connecté, l'échec est EXPLIQUÉ sans bloquer la décision. */
const noSig = await buildSignedDeposit({ rec: { id: 'd1', kind: 'devis' }, signature: null, currentName: 'Alice' });
eq(noSig.patch, null, 'sans image de signature : aucun correctif (la décision reste seule)');
eq(noSig.frags.length, 0, 'sans image de signature : aucun message');
eq(
  (await buildSignedDeposit({ rec: null, signature: { dataUrl: 'data:image/png;base64,AAAA' } })).patch,
  null,
  'sans ligne devis / BC : rien à signer',
);
const offline = await buildSignedDeposit({
  rec: { id: 'd1', kind: 'devis', fichierUrl: 'https://drive.google.com/file/d/abc/view' },
  signature: { dataUrl: 'data:image/png;base64,AAAA' },
  currentName: 'Alice',
});
eq(offline.patch, null, 'Drive non connecté (bouchon de test) : aucune copie signée, aucun correctif');
ok(
  offline.frags.join(' ').includes('Google Drive non connecté'),
  '…et la raison est dite en clair (best-effort, jamais bloquant)',
);

/* ── 3. RENDU RÉEL des deux pages (SSR) ──────────────────────────────────── */
const ENTRY = '_approval_bc_probe.jsx';
const OUT_DIR = '_approval_bc_render';
await build({ logLevel: 'error', build: { ssr: ENTRY, outDir: OUT_DIR, emptyOutDir: true, minify: false } });
const built = `${OUT_DIR}/${ENTRY.replace(/\.jsx$/, '.js')}`;
ok(existsSync(built), `${built} doit être construit (sinon rien n’est rendu)`);

let renderOut = '';
try {
  renderOut = execFileSync(process.execPath, [built], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  renderOut = `${e.stdout || ''}\n${e.stderr || ''}`;
}
const rows = renderOut.split(/\r?\n/).filter((l) => /^(ok|threw) \|/.test(l));
/* Texte seul : React sépare les nœuds texte adjacents par des commentaires
   (`1<!-- --> devis signé`) — on les retire pour comparer la phrase entière. */
const textOf = (html) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const htmlOf = (label) => {
  const row = rows.find((l) => l.split('|')[1].trim() === label);
  assert.ok(row, `cible « ${label} » absente du rendu :\n${renderOut}`);
  passed += 1;
  assert.ok(row.startsWith('ok |'), `cible « ${label} » a jeté au rendu : ${row.split('|').slice(2).join('|')}`);
  passed += 1;
  return textOf(JSON.parse(row.slice(row.indexOf('|', row.indexOf('|') + 1) + 1)));
};

const apprSuper = htmlOf('approbation-superuser');
const apprMember = htmlOf('approbation-membre');
const achats = htmlOf('achats-prevus-superuser');

/* Les deux sections, et la nouvelle règle de répartition. */
ok(apprSuper.includes('Devis à approuver'), 'la section « Devis à approuver » est rendue');
ok(apprSuper.includes('BC à faire et à approuver'), 'la section est renommée « BC à faire et à approuver »');
ok(!apprSuper.includes('Bons de commande à approuver'), 'l’ancien titre « Bons de commande à approuver » a disparu');
ok(apprSuper.includes('DEV-EN-ATTENTE'), 'un devis « En attente » reste dans « Devis à approuver »');
ok(!apprSuper.includes('DEV-SIGNE-SANS-BC'), 'un devis SIGNÉ n’est plus listé dans « Devis à approuver »');
ok(!apprSuper.includes('DEV-SIGNE-AVEC-BC'), '…même quand son bon de commande est déjà déposé');
ok(
  apprSuper.includes('1 devis signé sans BC'),
  'seuls les devis signés SANS bon de commande sont comptés « à faire » dans la section des BC',
);
ok(apprSuper.includes('2 à faire / en attente'), 'le compteur de la section additionne devis signés et BC déposés');
ok(!apprSuper.includes('Déposer un BC'), 'le bouton « Déposer un BC » a disparu');
ok(apprSuper.includes('Ranger les fichiers'), 'le superutilisateur garde « Ranger les fichiers »');
ok(apprMember.includes('BC à faire et à approuver'), 'la section renommée existe aussi pour un membre');
ok(!apprMember.includes('Ranger les fichiers'), '« Ranger les fichiers » n’est PAS visible pour un membre');

/* Achats prévus : le bouton dit ce qu’il fait, et l’ancien a disparu. */
ok(achats.includes('Signature et BC'), 'le bouton de transfert s’appelle « Signature et BC »');
ok(achats.includes('ACHAT-APPROUVE a transferer'), 'un achat approuvé non transféré reste proposé au transfert');
ok(!achats.includes('→ Devis & BC'), 'le bouton « → Devis & BC » a disparu');
ok(!achats.includes('Devis signé · BC à signer'), 'l’ancien libellé « Devis signé · BC à signer » a disparu');

/* ── 4. Câblage du JSX (ce qui ne se voit qu'au clic / à l'onglet BC) ────── */
const apprSrc = readFileSync('src/administration/approbationPage.jsx', 'utf8');
const desiSrc = readFileSync('src/administration/desiderataPage.jsx', 'utf8');
const tableSrc = readFileSync('src/administration/smartTable.jsx', 'utf8');
const signingSrc = readFileSync('src/administration/depositSigning.js', 'utf8');

const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

/* La section des BC mélange devis signés et BC déposés : la table accepte donc
   un clic de ligne, et ce clic ouvre le formulaire de dépôt du BC. */
has(tableSrc, 'onRowClick', 'smartTable : une ligne peut être cliquable');
has(tableSrc, 'rowClickable', 'smartTable : le clic se choisit par ligne');
has(
  tableSrc,
  "closest('button, a, input, select, textarea, label, .cursor-cell')",
  'smartTable : un clic sur un bouton / lien / cellule de somme ne déclenche PAS le clic de ligne',
);
has(apprSrc, 'onRowClick={openBcDeposit}', 'approbationPage : la ligne du devis signé ouvre le dépôt du BC');
has(
  apprSrc,
  "rowClickable={(r) => activeKind === 'bc' && r && r.kind === 'devis'}",
  'approbationPage : seules les lignes de devis signés réagissent au clic',
);
has(apprSrc, 'devisAwaitingBc(rows, devisList)', 'approbationPage : les « BC à faire » viennent de la règle partagée');
has(
  apprSrc,
  '!isDevisSigned(r) && (showTreated || isApprovalPending(r.statut))',
  'approbationPage : un devis signé est exclu de « Devis à approuver »',
);
gone(apprSrc, "setModal({ mode: 'new', kind: 'bc' })", 'approbationPage : le bouton « Déposer un BC » a été retiré');
assert.ok(
  /\{isSuper && \([\s\S]{0,900}?Ranger les fichiers/.test(apprSrc),
  'approbationPage : « Ranger les fichiers » est conditionné au superutilisateur',
);
passed += 1;
has(apprSrc, 'linkedDevisId', 'approbationPage : le BC ouvert depuis un devis signé connaît son devis');
gone(apprSrc, 'stampPdfWithSignature', 'approbationPage : la signature PDF n’est plus implémentée deux fois');
has(signingSrc, 'export const buildSignedDeposit', 'depositSigning : buildSignedDeposit est le point d’entrée unique');
has(signingSrc, 'export const renameDepositDriveFileTo', 'depositSigning : le renommage conventionnel est partagé lui aussi');

/* Achats prévus : le transfert SIGNE le devis (mêmes règles que le bouton ✓). */
has(desiSrc, "'✓ Signature et BC'", 'desiderataPage : le bouton s’appelle « ✓ Signature et BC »');
has(desiSrc, "'📨 Signature et BC'", 'desiderataPage : variante « 📨 Signature et BC » (demande déjà approuvée)');
has(desiSrc, 'patch.statut = APPROVAL_APPROVED;', 'desiderataPage : le transfert « Signature et BC » signe le devis');
has(desiSrc, 'patch.decidedBy = actorName;', 'desiderataPage : la signature porte le nom de son auteur');
has(desiSrc, 'buildSignedDeposit(', 'desiderataPage : la copie signée du PDF est créée au transfert');
has(desiSrc, "'Devis signé · BC à faire'", 'desiderataPage : le badge dit « Devis signé · BC à faire »');
gone(desiSrc, '>→ Devis & BC<', 'desiderataPage : le bouton « → Devis & BC » a été retiré');
gone(desiSrc, "'Devis signé · BC à signer'", 'desiderataPage : l’ancien badge a disparu');
has(desiSrc, 'to: cible.emails,', 'desiderataPage : le transfert notifie toujours la cible (destinataires inchangés)');

console.log(`_approval_bc_flow_test: ${passed} passed`);
