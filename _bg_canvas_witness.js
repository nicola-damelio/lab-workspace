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

   ⚠ CE QU'ELLE LIT EN PLUS DEPUIS CETTE SESSION — LA DIRECTION. Le rapport « the
   gradient is in the direction of the screen and not horizontal or vertical » se
   lit de deux façons possibles, et elles demandent des réparations OPPOSÉES :
     · ☀ LIGHT EST LE DÉFAUT (`BG_GRADIENT_DEFAULT_LIGHT = true`) : la rampe suit
       la LAMPE, c'est-à-dire la direction de la SCÈNE projetée à l'écran
       (`bgAngleFromLight`, le rig ◐ Shadows). Lampe de biais — le défaut 25° / 28°
       — veut dire 142°, une DIAGONALE. Rien n'est cassé : la diagonale est le
       défaut, et les huit flèches reprennent la direction en main.
     · LE BROUILLARD DE PROFONDEUR (`viewer.setBackground` fait `setFog(couleur)`) :
       les atomes lointains s'éclaircissent vers A — là, la variation est bien
       « dans la direction de l'écran » (en profondeur), et la rampe CSS n'y est
       pour rien.
   Cette sonde lit l'ANGLE écrit (le navigateur l'omet quand c'est son défaut, et
   l'absence est alors une information), l'état du ☀, l'angle affiché, la ligne du
   panneau et les magasins (`labViewerBgGradient`, `labViewerFog`,
   `labViewerShadowAz/El`) — de quoi trancher SANS capture d'écran.

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
  /* ── LA TOILE EST-ELLE ENCORE TRANSPARENTE ? ───────────────────────────────
     LE FAIT QUI DÉCIDE SI TOUTE LA QUESTION A UN SENS. Le fond de l'écran n'est
     pas dans la toile WebGL : NGL la vide en ALPHA ZÉRO (`setBackground` →
     `setClearColor(couleur, 0)`) et pose la couleur en CSS — c'est ce qui laisse
     voir une rampe CSS À TRAVERS elle. Un clear d'alpha UN recouvre TOUT le CSS
     du même canvas : la couleur A COMME la rampe → le fond redevient uni et
     RIEN n'accuse la rampe (voir _chk_mk.cjs, qui lit ce clear dans le dist).
     Or c'est NGL qui pose cet alpha UN : `makeImage` (le rendu du ✨ Ray) fait
     `setClearAlpha(transparent ? 0 : 1)` et ne remet l'alpha d'AVANT que dans le
     rappel `toBlob` — un rendu abandonné (chien de garde) laisse donc la toile
     opaque POUR DE BON, et plus aucune rampe ne se voit.
     On lit le BITMAP RÉEL (`drawImage` — possible parce qu'NGL construit son
     renderer avec `alpha: true` ET `preserveDrawingBuffer: true`, lus dans
     _ngl_src/viewer__viewer.ts:422-426) : un COIN de la toile, loin de la
     molécule, a un alpha de 0 tant qu'elle est transparente, et de 255 dès
     qu'elle ne l'est plus. Aucun `getContext` n'est appelé ici (l'appeler sur
     une toile 2D en CRÉERAIT un — la sonde s'est déjà prise à ce piège). */
  const alphaDuBitmap = (cv) => {
    if (!cv) return null;
    try {
      const [w, h] = box(cv).slice(0, 2);
      const c = document.createElement('canvas');
      c.width = Math.max(2, w);
      c.height = Math.max(2, h);
      const x = c.getContext('2d');
      if (!x) return null;
      x.drawImage(cv, 0, 0, c.width, c.height);
      return {
        coin: x.getImageData(1, 1, 1, 1).data[3],                       // un coin : jamais un atome
        milieu: x.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data[3],
      };
    } catch (e) {
      // Une toile « tainted » (une texture d'une autre origine) ne se relit pas :
      // le dire vaut mieux que rendre un 0 qui ferait croire à une transparence.
      return { erreur: short(e && e.message, 60) };
    }
  };
  /* ── LA DIRECTION, LUE SANS RIEN DÉVINER ───────────────────────────────────
     La question ouverte de cette session : « the gradient is in the direction of
     the screen and not horizontal or vertical ». Trois lectures la tranchent, et
     AUCUNE ne demande de capture d'écran :
       · l'ANGLE de la chaîne que le navigateur a calculée — il OMET l'angle quand
         c'est son défaut (180deg, du haut vers le bas) et l'écrit sinon :
         l'absence d'angle est donc une INFORMATION, jamais un manque ;
       · ce que le PANNEAU en dit (sa ligne du bas nomme la direction : « in the
         direction of the light (142°) », ou un des huit noms) ;
       · l'état du ☀ et l'angle affiché. ☀ ALLUMÉ VEUT DIRE « la rampe suit la
         LAMPE », c'est-à-dire la direction de la SCÈNE (le rig ◐ Shadows projeté
         à l'écran) : elle n'est ni horizontale ni verticale dès que la lampe est
         de biais, et le défaut du module (25° / 28°) donne 142°, une DIAGONALE.
     ⚠ Une diagonale n'est PAS une rampe cassée : c'est le défaut du module. Ce
     que ce bloc doit empêcher, c'est qu'on répare une diagonale en croyant
     réparer un fond uni. */
  const angleDe = (css) => {
    const m = /(-?[\d.]+)deg/.exec(String(css || ''));
    return m ? Number(m[1]) : null;      // null = aucun angle écrit : le défaut du CSS (180deg)
  };
  const panneau = document.getElementById('viewer-background');
  const boutonDuPanneau = (re) => (panneau
    ? Array.prototype.slice.call(panneau.querySelectorAll('button')).find((b) => re.test(b.textContent || '')) || null
    : null);
  const lampe = boutonDuPanneau(/☀/);
  const angleAffiche = panneau ? panneau.querySelector('input[type="number"]') : null;
  const magasin = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
  const DIAGONALES = [45, 135, 225, 315];
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
    /* LE BITMAP, PAS LE CSS — voir alphaDuBitmap : coin = 0 quand la toile est
       transparente (le CSS du canvas DOIT alors se voir), coin = 255 quand elle
       ne l'est plus (elle recouvre TOUT son CSS : la couleur A ET la rampe). */
    alphaDeLaToile: alphaDuBitmap(gl),
    pile: points,
    saDirection: gl ? {
      angleEnLigne: angleDe(gl.style.backgroundImage),
      angleCalcule: angleDe(cs(gl) && cs(gl).backgroundImage),
      lampeAllumee: lampe ? lampe.getAttribute('aria-pressed') : null,
      angleAffiche: angleAffiche ? angleAffiche.value : null,
    } : null,
    /* CE QUE LE PANNEAU DIT, MOT POUR MOT — c'est lui qui nomme la direction
       (« in the direction of the light (142°) ») et qui dit si le canvas a pris
       la rampe (voir bgRampTaken). */
    ditParLePanneau: panneau
      ? short(String(panneau.textContent || '').replace(/\s+/g, ' ').trim(), 240)
      : '(panneau fermé — ouvrez ⬚ et relancez)',
    /* LES MAGASINS — le fond vit sous `labViewerBgGradient`, la couleur de scène
       sous `labViewerBg`. Les deux réglages qui DÉPLACENT la rampe sans la
       peindre sont ici aussi : le rig ◐ Shadows, dont l'azimut et l'élévation
       SONT l'angle de la rampe tant que ☀ est allumé, et 🌫 Fog (quand il est
       allumé, les atomes lointains s'éclaircissent vers A : une teinte « en
       profondeur » de A, à ne pas confondre avec la rampe). */
    magasins: {
      labViewerBgGradient: magasin('labViewerBgGradient'),
      labViewerBg: magasin('labViewerBg'),
      labViewerFog: magasin('labViewerFog'),
      labViewerShadows: magasin('labViewerShadows'),
      labViewerShadowAz: magasin('labViewerShadowAz'),
      labViewerShadowEl: magasin('labViewerShadowEl'),
    },
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
  /* ⚠ LA TRANSPARENCE DE LA TOILE — c'est ELLE qui décide si la question a un
     sens : une rampe parfaitement écrite ET parfaitement calculée reste
     INVISIBLE sur une toile devenue opaque, parce qu'un clear d'alpha UN
     recouvre TOUT le CSS du canvas, la couleur A COMME la rampe. C'est l'état
     que laisse un rendu au fond opaque (✨ Ray : `setClearAlpha` posé par NGL et
     remis seulement dans le rappel `toBlob`) abandonné par son chien de garde —
     la mesure est dans _chk_mk.cjs, la lecture du bitmap ici. */
  const alpha = out.alphaDeLaToile;
  if (alpha && alpha.erreur) {
    console.log('%c→ toile : transparence ILLISIBLE (' + alpha.erreur + ') — une toile « tainted » ne se relit pas : cette mesure ne peut pas conclure.', 'color:#9a3412');
  } else if (alpha) {
    if (alpha.coin === 0) {
      console.log('%c→ toile : TRANSPARENTE (alpha du coin = 0, centre = ' + alpha.milieu + ') — le CSS du canvas DOIT donc se voir : si le fond est quand même UNI, c’est une COUCHE AU-DESSUS (voir `pile`) ou une AUTRE TOILE (comparez `saBoite` à `boiteDeLaVue`), jamais la rampe.', 'color:#0b7285');
    } else {
      console.log('%c→ toile : ⚠ OPAQUE (alpha du coin = ' + alpha.coin + ' / 255) — un clear d’alpha UN recouvre TOUT le CSS de ce canvas : la couleur A COMME la rampe. Le fond uni que vous voyez EST ce clear, et la rampe n’y est pour rien. NGL pose cet alpha UN lui-même pour un rendu au fond opaque (✨ Ray : `makeImage` → `setClearAlpha(transparent ? 0 : 1)`) et ne remet l’alpha d’AVANT que dans le rappel `toBlob` : un rendu abandonné le laisse en place pour de bon (voir _chk_mk.cjs). ⚠ MAIS tout `stage.setParameters(…)` repose l’alpha à ZÉRO (NGL appelle `viewer.setBackground` inconditionnellement, _ngl_src/stage__stage.ts:271) : un geste sur 🎨 / 🌫 / la qualité LE RÉPARE. Si la rampe revient après un de ces gestes, c’est ce clear-là qu’il faut regarder ; si elle ne revient pas, l’alpha n’est pas la cause.', 'color:#9a3412');
    }
  }
  /* ⚠ LA DIRECTION — trois lectures, et les DEUX pièges qui font dire « le
     gradient est dans la direction de l'écran » alors que rien n'est cassé. */
  const a = gl ? angleDe((cs(gl) && cs(gl).backgroundImage) || gl.style.backgroundImage) : null;
  if (inline && computed !== 'none') {
    console.log('%c→ direction : ' + (a == null
      ? 'aucun angle écrit dans la chaîne — c’est le DÉFAUT du CSS, 180deg (du haut vers le bas)'
      : `l’angle écrit est ${a}° — ${DIAGONALES.indexOf(a) >= 0 ? 'une DIAGONALE'
        : (a % 90 === 0 ? 'un des quatre axes (horizontal / vertical)'
          : 'un angle libre : ni un axe, ni une diagonale')}`), 'color:#0b7285');
  }
  if (lampe && lampe.getAttribute('aria-pressed') === 'true') {
    console.log('%c→ ☀ Light est ALLUMÉ : la direction de la rampe est celle de la LAMPE (le rig ◐ Shadows projeté à l’écran), pas celle des huit flèches. Une lampe de biais — le défaut du module, 25° / 28° — donne 142°, c’est-à-dire une DIAGONALE. C’est le DÉFAUT, pas une panne : presser une des huit flèches rend la direction au magasin, et l’angle affiché passe alors à 0 / 90 / 180 / 270.', 'color:#0b7285');
  }
  if (magasin('labViewerFog') === 'on') {
    console.log('%c→ 🌫 Fog est ALLUMÉ : `viewer.setBackground` fait aussi `setFog(couleur)`, donc les atomes LOINTAINS s’éclaircissent vers A — une teinte de A « en profondeur », qui n’est PAS la rampe : la rampe vit dans le CSS de la toile, le brouillard dans la scène. Sortez le brouillard (🌫) avant de juger la rampe.', 'color:#0b7285');
  }
})();
