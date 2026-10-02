/* =========================================================================
   _sequence_line_render_test.mjs — LA LIGNE SOUS UNE CASE DE SÉQUENCE, RENDUE.

   LA DEMANDE, MOT POUR MOT : « Under the sequence field please write the number
   of each type of aminoacids, the total charge at pH 7 and the estimated molar
   extinction coefficient. Keep this information compact utilising as much
   horizontal space. »

   _sequence_charge_test.mjs VÉRIFIE LE TEXTE DES SOURCES (le module, le composant
   partagé, les deux cases de séquence qui l'appellent) ; cette suite-ci va plus
   loin et REND LA LIGNE POUR DE VRAI : elle construit la sonde en SSR (Vite, sans
   minification), l'exécute dans Node et lit le HTML obtenu — donc ce qu'un écran
   affiche. C'est la seule façon de distinguer « le JSX contient la bonne chaîne »
   de « la ligne apparaît vraiment, et avec les bons nombres ».

   Ce qui est mesuré, cas par cas :
     • le PEPTIDE DU RAPPORT (pH 7, terminus libres) — « 31 aa », LA COMPOSITION
       (« A 1 · F 1 · … V 2 »), « net +3.00 e at pH 7 », « free N-term · free
       C-term », « ε₂₈₀ 0 M⁻¹cm⁻¹ » (ni Trp, ni Tyr, ni cystine : il n'absorbe
       rien à 280 nm) ;
     • LES DEUX CAPUCHONS (Acetylation + Amidation) — la ligne le DIT
       (« acetylated · amidated ») et ne prétend plus que l'ammonium N-terminal
       est libre ;
     • UNE LECTURE ABSENTE (une case non protéique, ou vide) NE REND RIEN —
       aucun HTML : jamais une ligne muette ni un « 0 aa » trompeur ;
     • LA COMPACTITÉ (« utilising as much horizontal space ») — la ligne est en
       flex-wrap et porte la classe de son appelant ;
     • LA BULLE D'AIDE est là (le pKa de CHAQUE chaîne latérale, les deux
       terminus, la règle des terminus libres), donc le chiffre est auditable.

   Run: node _sequence_line_render_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { build } from 'vite';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const ENTRY = '_seqline_render_probe.jsx';
const OUT_DIR = '_seqline_smoke';

/* ── 1 · build SSR de la sonde ─────────────────────────────────────────────── */
await build({
  logLevel: 'error',
  build: { ssr: ENTRY, outDir: OUT_DIR, emptyOutDir: true, minify: false },
});
const built = `${OUT_DIR}/${ENTRY.replace(/\.jsx$/, '.js')}`;
ok(existsSync(built), `${built} doit être construit (sinon rien n'est rendu)`);

/* ── 2 · exécution ─────────────────────────────────────────────────────────── */
let out = '';
let exitCode = 0;
try {
  out = execFileSync(process.execPath, [built], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  exitCode = e.status === undefined ? -1 : e.status;
  out = `${e.stdout || ''}\n${e.stderr || ''}`;
}
const lines = out.split(/\r?\n/).map((l) => l.trim());
const rows = lines.filter((l) => /^(ok|threw)\s*\|/.test(l));
const row = (label) => rows.find((l) => l.split('|')[1].trim() === label);
const cell = (label, i) => {
  const r = row(label);
  assert.ok(r && r.startsWith('ok'), `la ligne « ${label} » doit avoir été rendue\n${out.slice(-800)}`);
  return (r.split('|')[i] || '').trim();
};
const text = (label) => cell(label, 4);
const classes = (label) => cell(label, 5);
const tooltip = (label) => cell(label, 6);
const htmlLen = (label) => Number(cell(label, 2));
const hasTitle = (label) => cell(label, 3) === '1';

const threw = rows.filter((l) => l.startsWith('threw'));
ok(threw.length === 0, `aucun rendu ne doit jeter —\n${threw.join('\n')}\n${lines.filter((l) => l.includes('@ ')).join('\n')}`);
ok(out.includes('RENDER PROBE OK'), `la sonde doit finir sur RENDER PROBE OK (exit=${exitCode})\n${lines.slice(-6).join('\n')}`);
ok(rows.length === 4, `les 4 cas de la sonde sont mesurés (mesurés : ${rows.length})`);

/* ── 3 · LE PEPTIDE DU RAPPORT — ce qu'un écran montre, à pH 7 ─────────────── */
const free = text('free termini');
ok(htmlLen('free termini') > 0, 'la ligne est bien dans le HTML (pas seulement dans le JSX)');
ok(free.includes('31 aa'), `…elle dit le NOMBRE DE RÉSIDUS — « 31 aa » (vu : ${free})`);
ok(free.includes('A 1 · F 1 · G 4 · I 10 · K 3 · L 1 · M 2 · N 2 · P 1 · Q 2 · S 2 · V 2'),
  '…LE NOMBRE DE CHAQUE ACIDE AMINÉ, en une ligne (« A 1 · F 1 · G 4 … V 2 »)');
ok(free.includes('net +3.00 e at pH 7'), '…LA CHARGE TOTALE À pH 7 (+3,00 e pour ce peptide)');
ok(free.includes('free N-term') && free.includes('free C-term'),
  '…et les DEUX TERMINUS, dits en mots (la règle « assume free termini » est visible)');
ok(free.includes('ε₂₈₀ 0 M⁻¹cm⁻¹'), '…et l’ε₂₈₀ estimé, en M⁻¹cm⁻¹ (0 ici : rien n’absorbe à 280 nm)');
ok(!/undefined|NaN|\[object/.test(free), '…sans jamais laisser passer un undefined, un NaN ni un [object Object]');

/* ── 4 · LES DEUX CAPUCHONS DE LA FICHE DU COMPOSÉ — la ligne le DIT ───────── */
const capped = text('capped termini');
ok(capped.includes('acetylated') && capped.includes('amidated'),
  `…la ligne DIT les capuchons (« acetylated · amidated », vu : ${capped})`);
ok(!capped.includes('free N-term') && !capped.includes('free C-term'),
  '…et ne prétend plus qu’un terminus est libre quand la définition du composé l’a capuchonné');
ok(capped.includes('net +3.00 e at pH 7'), '…la charge reste celle des trois lysines de ce peptide');

/* ── 5 · RIEN À DIRE, RIEN DE RENDU ────────────────────────────────────────── */
ok(htmlLen('reading absent') === 0 && text('reading absent') === '',
  '⚠ une lecture ABSENTE (case non protéique, structure sans séquence) ne rend AUCUN HTML');
ok(htmlLen('empty sequence') === 0 && text('empty sequence') === '',
  '…et une séquence VIDE non plus : jamais un « 0 aa · net +0.00 e » trompeur');

/* ── 6 · COMPACTE, ET LA CLASSE DE SON APPELANT ───────────────────────────── */
ok(classes('free termini').includes('flex flex-wrap items-center gap-x-3 gap-y-1'),
  '⚠ la ligne est COMPACTE et REMPLIT la largeur (flex-wrap, « utilising as much horizontal space »)');
ok(classes('free termini').includes('mb-4'), '…la fiche du composé de la Librairie lui donne sa marge basse');
ok(classes('capped termini').includes('mt-1'), '…et la case de séquence de la page NMR la sienne (juste sous la case)');

/* ── 7 · LA BULLE D'AIDE — le chiffre reste auditable ─────────────────────── */
ok(hasTitle('free termini') && hasTitle('capped termini'),
  'la bulle d’aide accompagne la ligne (on peut demander d’où vient le chiffre)');
ok(tooltip('free termini').includes('the pKa of EVERY side chain') && tooltip('free termini').includes('assume free termini'),
  '…elle nomme le modèle (le pKa de CHAQUE chaîne latérale) et la règle des terminus libres');
ok(tooltip('free termini').includes('N-term 9.69') && tooltip('free termini').includes('C-term 2.34'),
  '…en CITANT les deux pKa du module (9,69 · 2,34) — aucune table recopiée en dur');

console.log(`_sequence_line_render_test.mjs — ${passed} assertions OK `
  + '(🧬 la ligne sous une case de séquence, RENDUE : composition · charge à pH 7 · ε₂₈₀, '
  + 'les capuchons dits, rien pour une lecture absente)');
