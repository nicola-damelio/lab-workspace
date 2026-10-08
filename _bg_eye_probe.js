/* ============================================================================
   _bg_eye_probe.js — CE QUE L'ŒIL REÇOIT VRAIMENT, DANS **VOTRE** NAVIGATEUR.

   POURQUOI CE FICHIER EXISTE. Les suites de ce dépôt prouvent, sur un viewer
   monté PAR ELLES, que la rampe est écrite dans le CSS du canvas ET composée par
   le navigateur (`_viewer_bg_live_test.cjs` ; `_viewer_background_pixels_test
   .cjs`). Aucune ne peut dire ce que VOTRE session montre, parce que trois faits
   dépendent de l'état vivant de la page et ne se lisent pas de loin :

     1. LA TOILE EST-ELLE ENCORE TRANSPARENTE ? Le fond que l'on voit n'est pas
        dans la toile WebGL : NGL la vide en ALPHA ZÉRO (`setClearColor(couleur,
        0)`) et pose la couleur en CSS (`domElement.style.backgroundColor`),
        donc c'est le CSS du canvas qu'on voit À TRAVERS la toile. Le rendu du
        ✨ Ray, lui, pose un clear d'alpha UN le temps du rendu (`setClearAlpha
        (s ? 0 : 1)`). Une toile restée OPAQUE rend TOUT son CSS invisible — la
        couleur A comme la rampe : l'écran ne montre plus que la couleur du
        clear, unie dans toutes les directions.
     2. QUEL ÉLÉMENT LE NAVIGATEUR PEINT-IL À CE POINT ? Une couche posée
        au-dessus de la toile cacherait la rampe de la même façon, sans que le
        CSS y soit pour rien.
     3. EXISTE-T-IL UNE AUTRE TOILE que celle où le panneau a écrit ? Un étage
        recréé, ou une page gardée en `display: none`, laisserait la rampe sur
        une toile que personne ne regarde.

   MODE D'EMPLOI (30 secondes, aucun outil)
     1. ouvrez l'application sur la vue qui montre le fond UNI ;
     2. ouvrez le panneau ⬚ (un clic sur le fond) et laissez-le ouvert ;
     3. F12 → Console → collez TOUT ce fichier → Entrée ;
     4. renvoyez le rapport imprimé (le JSON et la conclusion en clair).

   Ce fichier ne fait que LIRE : il ne touche ni au magasin, ni au CSS, ni à la
   scène. Il ne fait pas partie du programme — il se supprime après la mesure.
   ========================================================================== */
(() => {
  'use strict';
  const styleOf = (el) => { try { return getComputedStyle(el); } catch { return null; } };
  const alphaOf = (css) => {
    const s = String(css || '');
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return s.indexOf('transparent') >= 0 ? 0 : 1;
    const parts = m[1].split(',').map((v) => v.trim());
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const paints = (cs) => !!(cs && (alphaOf(cs.backgroundColor) > 0 || String(cs.backgroundImage) !== 'none'));
  const boxOf = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.width), Math.round(b.height)];
  };
  /* LE PIXEL DE LA TOILE ELLE-MÊME, par le truc du recadrage : une toile 1×1 qui
     ne reçoit QUE le pixel voulu (`drawImage` décalé, puis `getImageData`).
     L'ALPHA est le fait qui compte : 0 = la couche CSS est visible À TRAVERS la
     toile ; 255 = elle est recouverte, et l'écran est uni quoi que dise le CSS. */
  const pixelOf = (canvas, fx, fy) => {
    try {
      const p = document.createElement('canvas');
      p.width = 1;
      p.height = 1;
      const ctx = p.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, -Math.round(canvas.width * fx), -Math.round(canvas.height * fy), canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    } catch (e) { return 'erreur : ' + String((e && e.message) || e); }
  };
  const hexOf = (px) => (Array.isArray(px) ? '#' + px.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') : null);
  /* CE QUE LE NAVIGATEUR DIT ÊTRE SOUS LE CURSEUR, du plus haut au plus bas — et
     le PREMIER élément qui PEINT (couleur non transparente ou image de fond) :
     c'est lui que l'œil voit là. Un `mix-blend-mode` autre que `normal` ne cache
     pas (il compose) : il ne compte donc pas comme un recouvrement. */
  const stackAt = (x, y) => {
    let els = [];
    try { els = document.elementsFromPoint(x, y) || []; } catch { els = []; }
    return els.slice(0, 8).map((el) => {
      const cs = styleOf(el);
      return {
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 48),
        id: String(el.id || ''),
        bg: cs ? String(cs.backgroundColor) : null,
        img: cs ? String(cs.backgroundImage).slice(0, 40) : null,
        blend: cs ? String(cs.mixBlendMode) : null,
        isCanvas: el.tagName === 'CANVAS',
        paints: paints(cs) && (!cs || String(cs.mixBlendMode) === 'normal'),
      };
    });
  };

  /* ---- 1. LES TOILES DE LA PAGE ------------------------------------------ */
  const canvases = Array.prototype.slice.call(document.querySelectorAll('canvas')).map((c, i) => {
    const cs = styleOf(c);
    let ctxAlpha = null;
    try {
      const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      const attrs = gl && gl.getContextAttributes ? gl.getContextAttributes() : null;
      ctxAlpha = attrs ? !!attrs.alpha : null;
    } catch { /* pas une toile WebGL */ }
    return {
      i,
      el: c,
      box: boxOf(c),
      inlineRamp: String(c.style.backgroundImage || ''),
      computedRamp: cs ? String(cs.backgroundImage) : null,
      cssColor: String(c.style.backgroundColor || ''),
      connected: !!c.isConnected,
      display: cs ? cs.display : null,
      visibility: cs ? cs.visibility : null,
      context_alpha: ctxAlpha,
    };
  });
  /* LA TOILE D'NGL : celle où NGL a écrit sa couleur (`setBackground`), et assez
     grande pour être la vue. S'il y en a plusieurs, toutes sont dans le rapport. */
  const main = canvases.filter((c) => c.cssColor && c.box[0] > 120 && c.box[1] > 120)
    .sort((a, b) => (b.box[0] * b.box[1]) - (a.box[0] * a.box[1]))[0] || null;

  /* ---- 2. LE PIXEL DE LA TOILE — la transparence, et rien d'autre --------- */
  let pixels = null;
  if (main) {
    const at = { tl: [0.02, 0.02], tr: [0.98, 0.02], bl: [0.02, 0.98], br: [0.98, 0.98], mid: [0.5, 0.5], left: [0.02, 0.5] };
    pixels = {};
    Object.keys(at).forEach((k) => {
      const px = pixelOf(main.el, at[k][0], at[k][1]);
      pixels[k] = Array.isArray(px) ? { rgba: px, hex: hexOf(px), alpha: px[3] } : px;
    });
  }
  const cornerAlphas = pixels ? [pixels.tl, pixels.tr, pixels.bl, pixels.br]
    .filter((p) => p && Array.isArray(p.rgba)).map((p) => p.alpha) : [];
  const opaqueEverywhere = cornerAlphas.length === 4 && cornerAlphas.every((a) => a === 255);

  /* ---- 3. CE QUI EST POSÉ SUR LA VUE ------------------------------------- */
  let overlay = null;
  if (main) {
    const b = main.el.getBoundingClientRect();
    const pts = [
      ['haut-gauche', b.left + 0.10 * b.width, b.top + 0.10 * b.height],
      ['haut-droit', b.left + 0.90 * b.width, b.top + 0.10 * b.height],
      ['bas-gauche', b.left + 0.10 * b.width, b.top + 0.90 * b.height],
      ['centre', b.left + 0.50 * b.width, b.top + 0.50 * b.height],
    ];
    overlay = pts.map((p) => {
      const stack = stackAt(p[1], p[2]);
      const first = stack.filter((e) => e.paints)[0] || null;
      return {
        point: p[0],
        premier_qui_peint: first
          ? (first.tag + (first.id ? '#' + first.id : '') + (first.cls ? '.' + first.cls.split(' ').join('.') : ''))
          : null,
        est_la_toile: !!(first && first.isCanvas && first.cls.indexOf('ngl') >= 0),
        pile: stack,
      };
    });
  }
  const covered = overlay ? (overlay.filter((o) => o.premier_qui_peint && !o.est_la_toile)[0] || null) : null;

  /* ---- 4. LA CONCLUSION, EN CLAIR --------------------------------------- */
  let verdict;
  if (!canvases.length) {
    verdict = 'AUCUNE TOILE sur la page : la vue n’est pas montée (ou l’onglet n’est pas celui de la vue).';
  } else if (!main) {
    verdict = 'AUCUNE TOILE D’NGL (aucune toile portant une couleur de fond écrite par NGL) : la scène n’a jamais pris son fond.';
  } else if (!main.inlineRamp && !main.computedRamp) {
    verdict = 'CLASSE 3 — LA TOILE QUE L’ŒIL VOIT NE PORTE AUCUNE RAMPE : le panneau a écrit dans une AUTRE toile que celle-ci (comparez la liste des toiles : l’une porte la rampe, l’autre est visible).';
  } else if (opaqueEverywhere) {
    verdict = 'CLASSE 1 — LA TOILE EST OPAQUE (alpha 255 dans ses quatre coins) : TOUT son CSS est invisible, la couleur A comme la rampe, et l’écran ne montre que la couleur du CLEAR d’NGL — un fond uni. Le geste qui l’a laissée ainsi est un rendu au fond OPAQUE (✨ Ray) resté inachevé : NGL ne remet l’alpha d’avant que dans son rappel `toBlob`. RECARGEZ la page et regardez si la rampe revient.';
  } else if (covered) {
    verdict = 'CLASSE 2 — QUELQUE CHOSE PEINT PAR-DESSUS LA VUE (' + covered.premier_qui_peint + ' au point « ' + covered.point + ' ») : la rampe est bien sur la toile, mais ce n’est pas elle que l’œil voit. La pile complète est ci-dessus.';
  } else {
    verdict = 'LA TOILE PORTE LA RAMPE, ELLE EST TRANSPARENTE ET RIEN NE LA RECOUVRE : le CSS du canvas EST ce que l’œil voit. Si l’écran est pourtant uni, envoyez-moi ce rapport tel quel — c’est le cas le plus intéressant des quatre.';
  }

  console.log('%c=== FOND DU VIEWER — CE QUE L’ŒIL REÇOIT ===', 'font-weight:bold');
  console.log(JSON.stringify({
    url: location.href.slice(0, 120),
    vue: main ? main.box : null,
    rampe_inline: main ? main.inlineRamp : null,
    rampe_calculee: main ? main.computedRamp : null,
    couleur_css: main ? main.cssColor : null,
    pixels_de_la_toile: pixels,
    toiles: canvases.map((c) => ({
      i: c.i, box: c.box, inlineRamp: c.inlineRamp, computedRamp: c.computedRamp,
      cssColor: c.cssColor, connected: c.connected, display: c.display,
      visibility: c.visibility, context_alpha: c.context_alpha,
      /* LE PIXEL DU CENTRE DE *CHAQUE* TOILE — la mesure qui manquait au rapport
         « still flat » : une toile posée AU-DESSUS de la vue qui peint OPAQUE
         (alpha 255, la couleur de SON clear) cache la rampe sans rien dire en
         CSS ; et une toile CACHÉE qui porte la rampe la laisse sur un écran que
         personne ne regarde. Ce seul champ nomme les deux cas. */
      pixel_centre: c.el ? pixelOf(c.el, 0.5, 0.5) : null,
    })),
    /* ⚠ LE CAS QUE LA PREMIÈRE SONDE NE POUVAIT PAS NOMMER : une AUTRE toile que
       celle d'NGL, connectée, qui couvre la vue (≥ 90 % de sa boîte) et peint des
       pixels OPAQUES au centre → c'est ELLE que l'œil voit, et son fond uni n'est
       pas le CSS d'NGL. Si la liste est non vide, la classe 2 est nommée, avec
       sa toile. */
    toiles_opaque_au_centre: main ? canvases.filter((c) => c.el !== main.el && c.connected
      && c.box[0] >= main.box[0] * 0.9 && c.box[1] >= main.box[1] * 0.9
      && Array.isArray(pixelOf(c.el, 0.5, 0.5)) && pixelOf(c.el, 0.5, 0.5)[3] === 255)
      .map((c) => ({
        i: c.i, box: c.box, pixel_centre: pixelOf(c.el, 0.5, 0.5),
        cls: String(c.el.className || ''),
      })) : [],
    peint_sur_la_vue: overlay,
  }, null, 2));
  console.log('%cCONCLUSION : ' + verdict, 'font-weight:bold;color:#b45309');
  return verdict;
})();
