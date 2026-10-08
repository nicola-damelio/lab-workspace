/* ============================================================================
   _chk_mk.cjs — L'ALPHA DU CLEAR D'ANGL DANS LE dist INSTALLÉ, EN CLAIR.

   POURQUOI CE FICHIER EXISTE. Le fond de l'écran du viewer n'est PAS dans la
   toile WebGL : NGL la vide en ALPHA ZÉRO (`setBackground` →
   `renderer.setClearColor(couleur, 0)`) et pose la couleur en CSS
   (`domElement.style.backgroundColor`). C'est ce qui rend une rampe CSS gratuite
   — et c'est aussi ce qui la rend INVISIBLE dès que la toile n'est plus
   transparente : un clear d'alpha UN recouvre tout son CSS, la couleur A comme
   la rampe.

   Or c'est NGL lui-même qui pose cet alpha UN : `makeImage` (le rendu du ✨ Ray)
   demande `setClearAlpha(transparent ? 0 : 1)` et ne remet l'alpha d'AVANT que
   dans le rappel `toBlob` — donc un rendu au fond OPAQUE qui n'aboutit jamais
   (le chien de garde du ✨ Ray, voir _viewer_ray_test.mjs §2 bis) laisse la
   toile opaque POUR DE BON. Ce script lit le dist installé et imprime les trois
   gestes (l'alpha lu, l'alpha posé, la remise) pour qu'on ne discute pas d'une
   reconstitution : c'est la preuve reproductible.

   LANCEMENT : node _chk_mk.cjs        (lecture seule, aucun effet)
   Ce fichier est une SONDE, pas une suite : il ne juge rien, il montre.
   Il se supprime quand la mesure ne sert plus.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'node_modules', 'ngl', 'dist', 'ngl.js');
if (!fs.existsSync(DIST)) {
  console.log('SAUTÉ  ' + DIST + ' est absent : `npm install` d’abord.');
  process.exit(0);
}
const source = fs.readFileSync(DIST, 'utf8');
const show = (needle, before, after, label) => {
  console.log('\n=== ' + label + ' ===');
  let at = source.indexOf(needle);
  let n = 0;
  if (at < 0) { console.log('(absent du dist : « ' + needle + ' »)'); return; }
  while (at >= 0 && n < 4) {
    console.log('--- @' + at + '\n' + source.slice(Math.max(0, at - before), at + after).replace(/\s+/g, ' ') + '\n');
    at = source.indexOf(needle, at + needle.length);
    n += 1;
  }
};

show('setClearAlpha', 260, 200, 'setClearAlpha — l’alpha POSÉ par le rendu');
show('getClearAlpha', 200, 160, 'getClearAlpha — l’alpha d’AVANT, celui qui doit revenir');
show('.toBlob(', 220, 200, 'toBlob — le rappel où la remise a lieu');
console.log('\nLecture : si `getClearAlpha()` apparaît AVANT le `setClearAlpha(…)` du même bloc,');
console.log('une image qui aboutit rend bien la toile transparente — et SEUL un rendu abandonné');
console.log('(promesse jamais résolue, chien de garde) peut la laisser opaque.');

