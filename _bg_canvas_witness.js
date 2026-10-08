/* ============================================================================
   _bg_canvas_witness.js — LA RAMPE EST-ELLE SUR LA TOILE QU'ON REGARDE ?

   POURQUOI CE FICHIER, ET PAS `_bg_eye_probe.js`. La sonde de 205 lignes mesure
   tout (la pile, les pixels, la transparence, les toiles en double) et personne
   ne l'a encore collée. Celle-ci ne mesure QUE le fait qui reste après que le
   raisonnement a éliminé le reste — le rapport de cette session, mot pour mot :
   « when the gradient is on i see a small effect on the molecule (very slight)
   but not on the background », avec A et B CLAIREMENT différents.

   CE QUI EST DÉJÀ ÉTABLI (relu dans la source d'NGL, pas supposé) :
     · `viewer.setBackground` fait `renderer.setClearColor(couleur, 0)` — alpha
       ZÉRO — et pose la couleur en CSS (`domElement.style.backgroundColor`) ;
     · `Stage.setParameters` appelle `viewer.setBackground(tp.backgroundColor)`
       INCONDITIONNELLEMENT (_ngl_src/stage__stage.ts:271) : le fond est donc
       ré-affirmé à CHAQUE `setParameters`, y compris au clic sur ⬚ ;
     · la rampe est une `backgroundImage` du MÊME canvas, écrite par
       `applyBackgroundGradient` (NMRMoleculeViewer.jsx), et RIEN d'autre dans
       `src/` ne touche à un fond CSS.
   Donc, A ≠ B : la chaîne est valide, le canvas est transparent, la rampe doit
   se voir. Si elle ne se voit pas, c'est que la toile écrite n'est pas la toile
   regardée — ou que quelque chose la recouvre. Ce fichier lit CES DEUX faits.

   MODE D'EMPLOI (15 secondes) : ouvrez le panneau ⬚ avec la rampe ALLUMÉE,
   F12 → Console → collez tout ce fichier → Entrée → renvoyez les lignes.

   LECTURE SEULE : aucun magasin, aucun CSS, aucune scène n'est touché.
   ========================================================================== */
(() => {
  'use strict';
  const cs = (el) => { try { return getComputedStyle(el); } catch { return null; } };
  const short = (v, n) => String(v == null ? '' : v).slice(0, n);
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.width), Math.round(b.height), Math.round(b.left), Math.round(b.top)];
  };
  const canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  /* LA TOILE D'NGL SE RECONNAÎT SANS RIEN CRÉER : c'est la seule sur laquelle
     NGL a écrit sa couleur de fond (`setBackground` → style.backgroundColor) —
     le repère qu'emploie déjà _viewer_bg_live_probe.jsx. À défaut, celle qui
     porte une `backgroundImage` écrite en ligne ; à défaut la première. */
  const gl = canvases.find((c) => String((c.style && c.style.backgroundColor) || '') !== '')
    || canvases.find((c) => String((c.style && c.style.backgroundImage) || '') !== '')
    || canvases[0] || null;
  const rows = canvases.map((c, i) => ({
    i,
    pixels: c.width + '×' + c.height,
    cssBox: box(c).slice(0, 2).join('×'),
    inlineColor: short(c.style.backgroundColor, 20) || '-',
    inlineRamp: short(c.style.backgroundImage, 46) || '-',
    computedRamp: short(cs(c) && cs(c).backgroundImage, 46),
    display: c.style.display || (cs(c) && cs(c).display),
  }));
  /* CE QUI PEINT VRAIMENT (le seul fait qui compte pour un recouvrement) : une
     couleur non transparente ou une image de fond, et jamais un `mix-blend-mode`
     autre que `normal` (celui-là compose, il ne cache pas — voir _bg_eye_probe.js). */
  const alphaOf = (v) => {
    const s = String(v || '');
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return s.indexOf('transparent') >= 0 ? 0 : 1;
    const parts = m[1].split(',').map((p) => p.trim());
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const stack = (x, y) => {
    let els = [];
    try { els = document.elementsFromPoint(x, y) || []; } catch { els = []; }
    return els.slice(0, 5).map((el) => {
      const s = cs(el);
      const paints = !!s && String(s.mixBlendMode) === 'normal'
        && (alphaOf(s.backgroundColor) > 0 || String(s.backgroundImage) !== 'none');
      return el.tagName + '.' + short(el.className, 26) + (paints ? ' ⬛peint' : '');
    });
  };
  let points = null;
  if (gl) {
    const [w, h, x, y] = box(gl);
    points = {
      topLeft: stack(x + 4, y + 4),
      topRight: stack(x + w - 4, y + 4),
      centre: stack(x + w / 2, y + h / 2),
      bottomRight: stack(x + w - 4, y + h - 4),
    };
  }
  const out = {
    toiles: rows,
    toileNGL: gl ? rows[canvases.indexOf(gl)] : null,
    saRampeCalculee: gl ? short(cs(gl) && cs(gl).backgroundImage, 90) : null,
    saRampeEnLigne: gl ? short(gl.style.backgroundImage, 90) || '(VIDE)' : null,
    saBoite: gl ? box(gl) : null,
    /* LA BOÎTE DE LA VUE, pour comparer : la toile d'NGL doit la remplir. */
    boiteDeLaVue: gl && gl.parentElement ? box(gl.parentElement) : null,
    pile: points,
  };
  console.log('%c_bg_canvas_witness', 'font-weight:bold', out);
  /* LA CONCLUSION, EN UNE PHRASE — selon ce que la lecture montre. */
  const inline = gl ? String(gl.style.backgroundImage || '') : '';
  const computed = gl ? String((cs(gl) && cs(gl).backgroundImage) || '') : '';
  let verdict;
  if (!gl) verdict = 'aucune toile dans la page : le viewer n’a pas monté';
  else if (!inline) verdict = 'la rampe n’est PAS écrite sur la toile d’NGL (style.backgroundImage VIDE) — c’est le chemin d’écriture qu’il faut regarder (bgRampTaken : no-canvas / empty), pas le CSS';
  else if (computed === 'none') verdict = 'écrite mais REFUSÉE par le navigateur (calculée = none) — la chaîne est le suspect';
  else verdict = 'la rampe EST sur la toile d’NGL et le navigateur la calcule : comparez sa boîte (saBoite) à celle de la vue, et la pile aux quatre points — c’est donc SOIT une autre toile, SOIT une couche posée dessus';
  console.log('%c→ ' + verdict, 'font-weight:bold;color:#0b7285');
})();
