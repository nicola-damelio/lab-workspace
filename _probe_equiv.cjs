/* Sonde jetable : ce que le réaménagement des palettes a vraiment déplacé.
   Compare l'ARBRE DE TRAVAIL à HEAD sur trois mesures qui ne dépendent pas
   de l'ORDRE : le nombre de sections, le nombre de pastilles de couleur et,
   surtout, le MULTI-ENSEMBLE des `aria-label` d'une part, la liste ORDONNÉE
   des titres de section d'autre part (c'est elle qui doit avoir changé).
   But : prouver qu'aucun réglage n'a été perdu en route. */
const fs = require('fs');
const cp = require('child_process');

const cur = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const head = cp.execSync('git show HEAD:src/components/NMRMoleculeViewer.jsx', { maxBuffer: 1e9 }).toString();

const count = (t, re) => (t.match(re) || []).length;
const stats = (t) => ({
  sections: count(t, /<section/g),
  sectionsClosed: count(t, /<\/section>/g),
  colorInputs: count(t, /type="color"/g),
  ariaTemplates: count(t, /aria-label=\{`[^`]*`\}/g),
});
const headers = (t) => (t.match(/text-\[11px\] font-black uppercase[^>]*>([^<]{0,60})</g) || [])
  .map((s) => s.replace(/.*>([^<]*)$/, '$1').trim());
const ariaLabels = (t) => {
  const m = {};
  for (const s of (t.match(/aria-label=\{`([^`]*)`\}/g) || [])) {
    const k = s.replace(/.*\{`([^`]*)`\}$/, '$1');
    m[k] = (m[k] || 0) + 1;
  }
  return m;
};
const multiset = (list) => {
  const m = {};
  for (const x of list) m[x] = (m[x] || 0) + 1;
  return m;
};

const out = [];
const a = stats(head), b = stats(cur);
out.push('=== COMPTES (HEAD -> WORK) ===');
for (const k of Object.keys(a)) out.push(`  ${k}: ${a[k]} -> ${b[k]}${a[k] === b[k] ? '  (=)' : '  <-- DIFFERE'}`);

const A = headers(head), B = headers(cur);
out.push('', `=== TITRES DE SECTION, DANS L'ORDRE (HEAD: ${A.length}, WORK: ${B.length}) ===`);
out.push('HEAD: ' + A.join(' | '));
out.push('WORK: ' + B.join(' | '));

const ma = multiset(A), mb = multiset(B);
out.push('', '=== TITRES : MULTIPLICITÉ (seul ce qui DIFFÈRE est listé) ===');
let same = true;
for (const k of [...new Set([...Object.keys(ma), ...Object.keys(mb)])]) {
  if ((ma[k] || 0) !== (mb[k] || 0)) { same = false; out.push(`  ${k} :: ${ma[k] || 0} -> ${mb[k] || 0}`); }
}
if (same) out.push('  aucun : les mêmes titres, autant de fois de part et d\'autre');

const ala = ariaLabels(head), alb = ariaLabels(cur);
out.push('', '=== PASTILLES (aria-label dynamiques) : seules les différences ===');
let sameSwatches = true;
for (const k of [...new Set([...Object.keys(ala), ...Object.keys(alb)])]) {
  if ((ala[k] || 0) !== (alb[k] || 0)) { sameSwatches = false; out.push(`  ${k} :: ${ala[k] || 0} -> ${alb[k] || 0}`); }
}
if (sameSwatches) out.push('  aucune : chaque pastille dynamique est toujours là, autant de fois');

fs.writeFileSync('_refactor_equiv.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
