/* ============================================================================
   _viewer_bg_live_probe.jsx — LA SONDE DU FOND, SUR LE VRAI COMPOSANT.

   LE RAPPORT DE CETTE SESSION : « the gradient does not work and the program is
   slow even if it does not have processes to do. » Deux symptômes, deux
   questions, et AUCUNE des deux ne se lit dans le source :

     1. LA RAMPE ARRIVE-T-ELLE AU CANVAS DU VIEWER VIVANT ? Le module
        (utils/viewerBackground.js) est prouvé au pixel (_viewer_background_pixels_test.cjs)
        et le câblage est prouvé au source (_viewer_background_test.mjs) — mais
        PERSONNE n'avait encore monté le VRAI composant, cliqué sur le fond,
        appuyé sur l'interrupteur ⬚ Gradient et REGARDÉ la toile. C'est ce que
        fait cette sonde : clic sur le fond de la vue → panneau → interrupteur,
        puis lecture du CSS RÉELLEMENT COMPOSITÉ par le navigateur
        (`getComputedStyle(canvas).backgroundImage`).

     2. LE VIEWER TRAVAILLE-T-IL QUAND ON NE LUI DEMANDE RIEN ? NGL ne rend que
        sur demande : au repos, la scène ne doit plus rien peindre. La sonde
        MESURE le repos pendant 2,5 s — images WebGL vidées (`gl.clear`, un par
        rendu d'NGL), images demandées (`requestAnimationFrame`), tâches longues
        (`longtask`) et mutations du DOM — au repos AVANT la rampe, puis au repos
        AVEC la rampe. Une rampe qui coûterait quelque chose au repos, ou un
        viewer qui tourne à vide, se lisent dans ces quatre nombres.

   ELLE MONTE LE VRAI COMPOSANT, JAMAIS UNE COPIE : `import NMRMoleculeViewer
   from './src/components/NMRMoleculeViewer'`. Aucune règle du viewer n'est
   recopiée ici — sinon la sonde pourrait être verte sans rien mesurer.
   ========================================================================== */
import React from 'react';
import { createRoot } from 'react-dom/client';
import NMRMoleculeViewer from './src/components/NMRMoleculeViewer';

/* ── 1. L'INSTRUMENTATION — POSÉE AVANT QUE REACT NE MONTE ──────────────────
   Tout ce qui compte est compté au niveau de la PAGE : le bundle de l'appli est
   minifié puis exécuté, on ne peut donc pas aller y glisser un compteur. */
const PERF = { rafSched: 0, rafRan: 0, clears: 0, long: 0, longMs: 0, muts: 0, reqs: 0, renders2: 0, rafBy: {}, clearBy: {}, reqBy: {}, renderBy: {} };
const origRaf = typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window) : null;

/* QUI DEMANDE UNE IMAGE ? Un compteur seul dit « il travaille » ; il ne dit pas
   QUI. On garde donc, pour chaque appel, les premières trames de sa pile — le
   bundle est construit sans minification (`minify: false`), les noms de fonctions
   y sont donc lisibles. C'est ce qui transforme « ça rame » en une ligne de code. */
const STACK_FRAMES = 7;
const stackKeyOf = (skip) => {
  try {
    const lines = String((new Error()).stack || '').split('\n').slice(1 + skip)
      .map((l) => l.trim().replace(/^at\s+/, ''));
    return lines.slice(0, STACK_FRAMES).join(' ← ') || '(pile vide)';
  } catch { return '(pile illisible)'; }
};
const bump = (map, key) => {
  const n = Object.keys(map).length;
  if (n > 60 && !map[key]) return;
  map[key] = (map[key] || 0) + 1;
};
const topOf = (map, n) => Object.keys(map)
  .map((k) => ({ n: map[k], stack: k }))
  .sort((a, b) => b.n - a.n)
  .slice(0, n);

/* ── 1bis. NGL À LA DEMANDE, ET L'ÉCOUTE DES DEMANDES D'IMAGE ────────────────
   `NGL.Viewer.prototype.requestRender` est LE point par lequel passe toute
   demande de rendu (un réglage, un geste, un appel de notre code). Le patcher
   répond exactement à « qui travaille alors qu'on ne lui demande rien ? » : la
   pile de chaque demande, avec les noms de fonctions du bundle (non minifié).
   ⚠ NGL est chargé du dist LOCAL (`/ngl.js`, servi par le test) : `ensureNGL` de
   src/utils/ngl.js prend `window.NGL` s'il est déjà là — la sonde ne dépend donc
   d'aucun réseau, et le patcheur est posé AVANT que le moindre stage existe. */
const loadScript = (src) => new Promise((resolve) => {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onload = () => resolve(true);
  s.onerror = () => resolve(false);
  document.head.appendChild(s);
});
const watchNgl = () => {
  const V = window.NGL && window.NGL.Viewer;
  if (!V || !V.prototype || typeof V.prototype.requestRender !== 'function') return false;
  if (V.prototype.__probeWatched) return true;
  const origReq = V.prototype.requestRender;
  V.prototype.requestRender = function (...a) {
    PERF.reqs += 1;
    bump(PERF.reqBy, stackKeyOf(2));
    return origReq.apply(this, a);
  };
  /* `render()` est l'IMAGE elle-même : la seule mesure qui dise « il a peint »
     sans dépendre du nombre de `gl.clear` d'un rendu (NGL en fait plusieurs, un
     par groupe de modèles et par cible). La pile dit QUI l'a déclenché : une
     demande de notre code, ou la boucle éternelle d'NGL (`Qc.animate`). */
  if (typeof V.prototype.render === 'function') {
    const origRender = V.prototype.render;
    V.prototype.render = function (...a) {
      PERF.renders2 += 1;
      bump(PERF.renderBy, stackKeyOf(2));
      return origRender.apply(this, a);
    };
  }
  V.prototype.__probeWatched = true;
  return true;
};

if (origRaf) {
  window.requestAnimationFrame = function (cb) {
    PERF.rafSched += 1;
    bump(PERF.rafBy, stackKeyOf(1));
    return origRaf(function (t) { PERF.rafRan += 1; return cb(t); });
  };
}
/* Un rendu d'NGL vide la toile (`renderer.clear()` → `gl.clear`). Compter les
   `clear` des contextes WebGL, c'est donc compter les IMAGES rendues : c'est le
   seul témoin du « il travaille alors qu'on ne lui demande rien ». */
['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach((name) => {
  const proto = window[name] && window[name].prototype;
  if (!proto || typeof proto.clear !== 'function') return;
  const orig = proto.clear;
  proto.clear = function (...a) {
    PERF.clears += 1;
    bump(PERF.clearBy, stackKeyOf(1));
    return orig.apply(this, a);
  };
});
try {
  new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => { PERF.long += 1; PERF.longMs += e.duration; });
  }).observe({ entryTypes: ['longtask'] });
} catch { /* pas de longtask sur ce navigateur : les trois autres nombres suffisent */ }

/* ── 2. LE VERDICT ──────────────────────────────────────────────────────── */
const OUT = { stage: 'start', cases: [], log: [], ua: navigator.userAgent };
const log = (...a) => { OUT.log.push(a.join(' ')); };
const post = (extra) => {
  const payload = { stage: OUT.stage, cases: OUT.cases, log: OUT.log, ua: OUT.ua, ngl: OUT.ngl || '', watched: !!OUT.watched, shadows: OUT.shadows || '' };
  if (extra) Object.keys(extra).forEach((k) => { payload[k] = extra[k]; });
  return fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => { if (!origRaf) { setTimeout(r, 0); return; } origRaf(() => origRaf(r)); });
const waitFor = async (fn, ms) => {
  const end = performance.now() + ms;
  for (;;) {
    let v = null;
    try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (performance.now() > end) return null;
    await sleep(50);
  }
};
window.addEventListener('error', (e) => log('window.error: ' + (e.message || e)));

/* ── 3. LA STRUCTURE FACTICE (celle de la sonde des pixels, 64 atomes) ───── */
const pad = (v, w) => { let s = String(v); while (s.length < w) s = ' ' + s; return s; };
const f8 = (v) => { let s = v.toFixed(3); while (s.length < 8) s = ' ' + s; return s; };
const PDB = (() => {
  const out = ['HEADER    SONDE FOND DU VIEWER (VIVANT)'];
  let serial = 0;
  for (let gx = 0; gx < 4; gx += 1) {
    for (let gy = 0; gy < 4; gy += 1) {
      for (let gz = 0; gz < 4; gz += 1) {
        serial += 1;
        out.push('ATOM  ' + pad(serial, 5) + '  C   ALA A' + pad(serial, 4) + '    '
          + f8((gx - 1.5) * 2.6) + f8((gy - 1.5) * 2.6) + f8((gz - 1.5) * 2.6) + '  1.00  0.00          C');
      }
    }
  }
  out.push('END');
  return out.join('\n');
})();

/* ── 4. UNE MESURE DE REPOS ──────────────────────────────────────────────── */
const sampleIdle = async (ms) => {
  PERF.rafBy = {};
  PERF.clearBy = {};
  PERF.reqBy = {};
  PERF.renderBy = {};
  const a = { ...PERF };
  const gaps = [];
  let stop = false;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (!stop && origRaf) origRaf(tick);
  };
  if (origRaf) origRaf(tick);
  await sleep(ms);
  stop = true;
  const b = { ...PERF };
  const maxGap = gaps.length ? Math.max.apply(null, gaps) : 0;
  return {
    ms,
    rafSched: b.rafSched - a.rafSched,
    rafRan: b.rafRan - a.rafRan,
    renders: b.clears - a.clears,
    renderCalls: b.renders2 - a.renders2,
    requested: b.reqs - a.reqs,
    longTasks: b.long - a.long,
    longTaskMs: Math.round(b.longMs - a.longMs),
    domMutations: b.muts - a.muts,
    maxGapMs: Math.round(maxGap * 10) / 10,
    /* QUI, exactement : les deux plus gros demandeurs d'images, et de rendus. */
    rafWho: topOf(PERF.rafBy, 2),
    renderWho: topOf(PERF.clearBy, 2),
    reqWho: topOf(PERF.reqBy, 2),
    renderCallWho: topOf(PERF.renderBy, 2),
  };
};

/* ── 5. LE CANVAS D'NGL (le SEUL de la vue qui soit WebGL) ────────────────
   ⚠ SANS JAMAIS CRÉER DE CONTEXTE SUR UNE AUTRE TOILE : l'ancienne version
   demandait `getContext('webgl2')` à chaque canvas de la page, ce qui MARCHE —
   mais qui, tant que l'étage n'existe pas encore, transformait la toile 2D de
   l'ombre vivante en toile WebGL et la rendait ensuite inutilisable (mesuré : la
   phase `ramp` mesurait une boîte de 300×150, la taille par défaut d'un canvas, au
   lieu des 2100×620 de la vue). Le canvas d'NGL se reconnaît SANS RIEN CRÉER :
   c'est le seul sur lequel NGL a écrit sa couleur de fond (`setBackground`). */
const glCanvas = () => Array.prototype.slice.call(document.querySelectorAll('canvas'))
  .find((c) => String((c.style && c.style.backgroundColor) || '') !== '') || null;
/* Le clic sur le FOND, exactement comme la sonde des pixels : `mousedown` puis
   `mouseup` sur la toile, dans un COIN (aucun atome) — c'est ce que NGL traduit
   en `stage.signals.clicked` sans atome, la branche du viewer qui bascule
   `bgPanelOpen`. */
const clickCanvas = (canvas, x, y) => {
  const ev = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
  canvas.dispatchEvent(new MouseEvent('mousedown', ev));
  canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0 }));
};
/* L'interrupteur ⬚ Gradient du panneau : un `button` du panneau qui annonce son
   état (`aria-pressed`) et se nomme « Gradient ». */
const switchOf = (panel) => Array.prototype.slice.call((panel || document).querySelectorAll('button'))
  .find((b) => b.hasAttribute('aria-pressed') && /Gradient/i.test(b.textContent || '')) || null;

/* ── 5ter. ☀ LA RAMPE EST-ELLE VISIBLE ? LE PIXEL COMPOSÉ, PAS LE CSS ─────────
   Lire le CSS ne prouve pas ce que l'œil voit : `backgroundImage` peut très bien
   être écrite sur la toile et ne JAMAIS paraître. C'est le trou de la première
   sonde, et il est exactement là où le rapport de cette session se place — « it has
   worked in the past for some seconds but now nothing happens, ONLY UNIFORM
   BACKGROUND » : une rampe présente dans le CSS et un fond uni peuvent être le même
   écran.

   NGL construit son renderer avec `alpha: true` ET `preserveDrawingBuffer: true`
   (lu dans _ngl_src/viewer__viewer.ts) : `drawImage(canvas)` rend donc le bitmap
   RÉEL, alpha compris, à n'importe quel moment. La sonde empile alors les deux
   couches comme le navigateur le fait pour l'ÉLÉMENT — le CSS du canvas DERRIÈRE,
   le rendu d'NGL DEVANT — puis elle lit trois lignes : haut, milieu, bas. C'est
   l'écran, au pixel près, sans capture d'écran et sans CDP.

   ⚠ LA COUCHE CSS EST RASTERISÉE PAR LE NAVIGATEUR LUI-MÊME. `fillStyle` d'un
   contexte 2D n'accepte PAS une chaîne `linear-gradient(…)`, donc la rampe est
   peinte par le moteur dans un `<foreignObject>` SVG (la MÊME chaîne CSS, servie en
   `data:` URL) puis recopiée. Aucune règle du module du fond n'est recopiée ici :
   c'est un INSTRUMENT de mesure, jamais une seconde implémentation. */
const cssLayerBitmap = async (css, w, h) => {
  const grad = css && css !== 'none' ? css : 'transparent';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${h}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background-image:${grad}"></div>`
    + `</foreignObject></svg>`;
  const img = new Image();
  img.width = w;
  img.height = h;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try { ctx.drawImage(img, 0, 0, w, h); } catch { return null; }
  return c;
};
/* LES LIGNES D'UNE TOILE — le haut (2 %), le milieu (50 %) et le bas (98 %) au CENTRE
   horizontalement, PLUS les deux coins (2 %, 2 %) et (98 %, 98 %) : la molécule est
   au milieu, les coins sont donc du FOND à coup sûr, et sur une rampe diagonale (☀
   la direction de la lampe) ce sont exactement ses deux extrémités. */
const rowsOf = (source, w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try { ctx.drawImage(source, 0, 0, w, h); } catch { return null; }
  const px = (x, y) => Array.prototype.slice.call(ctx.getImageData(
    Math.max(0, Math.min(w - 1, Math.round(x))), Math.max(0, Math.min(h - 1, Math.round(y))), 1, 1
  ).data, 0, 4);
  const mid = Math.max(0, Math.round(w / 2) - 1);
  return {
    top: px(mid, h * 0.02),
    middle: px(mid, h * 0.5),
    bottom: px(mid, h * 0.98),
    topLeft: px(w * 0.02, h * 0.02),
    bottomRight: px(w * 0.98, h * 0.98),
  };
};
const hexOfRow = (row) => (row ? '#' + row.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') : null);
/* L'ÉCART ENTRE LES DEUX EXTRÉMITÉS MESURÉES — la somme des trois canaux : c'est le
   nombre qui dit « une rampe se voit » (0 = fond uni). */
const rowGap = (a, b) => (a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : null);
const maxChannelGap = (a, b) => (a && b ? Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) : null);

/* LE PIXEL COMPOSÉ DE LA BOÎTE DU CANVAS — la rampe SEULE (ce que l'œil verrait si
   la toile était vide), puis la rampe SOUS le rendu d'NGL, et l'alpha du contenu
   tout seul (0 = la couche CSS est visible AU TRAVERS de la toile ; 255 = elle est
   recouverte, et l'écran est donc UNI quoi que dise le CSS). */
const composedOf = async (canvas) => {
  const b = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(b.width));
  const h = Math.max(1, Math.round(b.height));
  const css = String(getComputedStyle(canvas).backgroundImage || 'none');
  const out = { box: [w, h], css: css.slice(0, 96), ramp: null, screen: null, rampHex: null, screenHex: null, rampGap: null, screenGap: null, screenGapMaxChannel: null, contentAlpha: null };
  const layer = await cssLayerBitmap(css, w, h);
  const stack = document.createElement('canvas');
  stack.width = w;
  stack.height = h;
  const ctx = stack.getContext('2d');
  if (!ctx) return out;
  /* ⚠ LA COULEUR D'ABORD, LA RAMPE ENSUITE — exactement la pile du CSS
     (`background-image` SUR `background-color`), sans quoi la couche serait
     transparente là où la rampe est éteinte et la mesure mentirait. */
  ctx.fillStyle = canvas.style.backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (layer) {
    ctx.drawImage(layer, 0, 0, w, h);
    out.ramp = rowsOf(layer, w, h);
    if (out.ramp) {
      out.rampHex = { top: hexOfRow(out.ramp.top), bottom: hexOfRow(out.ramp.bottom), topLeft: hexOfRow(out.ramp.topLeft), bottomRight: hexOfRow(out.ramp.bottomRight) };
      out.rampGap = rowGap(out.ramp.topLeft, out.ramp.bottomRight);
    }
  }
  try {
    ctx.drawImage(canvas, 0, 0, w, h);        // ⚠ possible : preserveDrawingBuffer
    out.screen = rowsOf(stack, w, h);
    if (out.screen) {
      out.screenHex = { top: hexOfRow(out.screen.top), middle: hexOfRow(out.screen.middle), bottom: hexOfRow(out.screen.bottom), topLeft: hexOfRow(out.screen.topLeft), bottomRight: hexOfRow(out.screen.bottomRight) };
      out.screenGap = rowGap(out.screen.topLeft, out.screen.bottomRight);
      out.screenGapMaxChannel = maxChannelGap(out.screen.topLeft, out.screen.bottomRight);
    }
  } catch { out.screen = null; }
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const pctx = probe.getContext('2d');
  if (pctx) {
    try {
      pctx.drawImage(canvas, Math.round(-w / 2), Math.round(-h * 0.06), w, h);
      out.contentAlpha = pctx.getImageData(0, 0, 1, 1).data[3];
    } catch { out.contentAlpha = null; }
  }
  return out;
};
/* LE DÉFAUT PÂLE D'HIER CONTRE CELUI D'AUJOURD'HUI — la mesure qui explique le
   rapport « only uniform background ». Les deux chaînes sont celles que le module
   écrit (le format de tout ce fichier), et c'est le navigateur qui les rasterise.
   Le magasin du jour RÉÉCRIT le défaut pâle (voir le module), donc cette
   comparaison ne peut pas passer par la page : elle est faite ici, en clair. */
const paleVsToday = async (w, h) => {
  const rows = (layer) => (layer ? rowsOf(layer, w, h) : null);
  const pale = rows(await cssLayerBitmap('linear-gradient(180deg, #f8fafc 0%, #cbd5e1 100%)', w, h));
  const today = rows(await cssLayerBitmap('linear-gradient(180deg, #f8fafc 0%, #94a3b8 100%)', w, h));
  const ends = (r) => [r && r.topLeft, r && r.bottomRight];
  return {
    pale, today,
    gapPale: rowGap(...ends(pale)), gapToday: rowGap(...ends(today)),
    maxPale: maxChannelGap(...ends(pale)), maxToday: maxChannelGap(...ends(today)),
    hexPale: { top: hexOfRow(pale && pale.topLeft), bottom: hexOfRow(pale && pale.bottomRight) },
    hexToday: { top: hexOfRow(today && today.topLeft), bottom: hexOfRow(today && today.bottomRight) },
  };
};
/* ⚠ LA VUE A BESOIN D'UNE VRAIE BOÎTE POUR LA MESURE CI-DESSUS. Le viewer se
   dimensionne sur ses ancêtres (`h-full`) : hors de la page de l'application la
   chaîne de hauteurs peut se rompre et la toile retomber à 1 px (déjà mesuré :
   « host: [2100, 1] » — une rampe ne mesurerait alors qu'un trait). La sonde force
   donc la hauteur des ancêtres de la toile, en s'arrêtant à #root, et laisse NGL se
   redimensionner. */
const growViewer = async (canvas) => {
  const grew = [];
  let el = canvas.parentElement;
  while (el && el !== container) {
    const h = Math.round(el.getBoundingClientRect().height);
    if (h < 420) { el.style.height = '620px'; el.style.minHeight = '620px'; grew.push(h); }
    el = el.parentElement;
  }
  await sleep(150);
  await raf();
  const box = canvas.getBoundingClientRect();
  return { grew, canvas: [Math.round(box.width), Math.round(box.height)] };
};

/* ── 6. LE MONTAGE DU VRAI VIEWER ───────────────────────────────────────── */
/* ⚠ LA PAGE DOIT DONNER UNE VRAIE BOÎTE À LA VUE. Le viewer se dimensionne sur
   son parent (l'application lui donne ~1000 px) : sans hauteur, le canvas fait
   1 px de haut et la sonde ne mesurerait qu'un trait. `height` est la même
   entrée que celle des pages (NMR passe « 1000px »). */
const params = new URLSearchParams(location.search);
/* Le volet d'ombre portée vivante est ALLUMÉ par défaut (aucune clé = `true`) :
   la sonde peut le couper d'une requête (`?shadow=off`) pour ATTRIBUER le coût
   du repos à l'une ou l'autre des deux fonctions. */
if (params.get('shadow') === 'off') {
  try { localStorage.setItem('labViewerRayShadows', 'off'); } catch { /* ignore */ }
}
const SHADOWS = params.get('shadow') === 'off' ? 'off' : 'on';
const container = document.getElementById('root');
const root = createRoot(container);
/* Le VRAI composant est le petit-fils de #root (la boîte à hauteur fixe est la
   fille) : c'est lui que la sonde mesure. */
const viewerEl = () => {
  const wrap = container.firstElementChild;
  return (wrap && wrap.firstElementChild) || null;
};
/* ⚠ LE MONTAGE ATTEND QUE NGL SOIT LÀ ET QUE `requestRender` SOIT ÉCOUTÉ : c'est
   ce qui permet de dire QUI demande les images du repos (voir main()). */
/* ⚠ LE VIEWER A BESOIN D'UN PARENT À HAUTEUR DÉFINIE. Ses éléments internes sont
   en `h-full` (100 %) : dans une page où l'ancêtre est en `height: auto`, 100 %
   ne résout rien et la toile retombe à 1 px de haut (mesuré : « host:[2100,1] »,
   alors que la colonne du viewer fait 2246 px de chrome). Les pages de
   l'application donnent, elles, une hauteur à la vue (`height="1000px"` côté NMR) —
   la sonde fait donc la même chose, avec une boîte de hauteur FIXE. */
const mountViewer = () => root.render(
  <div style={{ height: '1100px' }}>
    <NMRMoleculeViewer structureText={PDB} structureTextExt="pdb" instanceKey="cond_A" height="1000px" />
  </div>
);

/* Le compteur de mutations se pose APRÈS le montage : il ne doit voir que la vie
   d'APRÈS, celle du repos. */
setTimeout(() => {
  try {
    new MutationObserver((recs) => { PERF.muts += recs.length; })
      .observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch { /* ignore */ }
}, 1200);

/* ── 6bis. LE SCÉNARIO DU RAPPORT — 📌 UN STYLE, PUIS UN ⬚ JUSTE APRÈS L'OUVERTURE ──
   Deux phases, une seule page (la seconde est un RECHARGEMENT : localStorage reste).
     · `?phase=define` : le viewer s'ouvre, on presse 📌 Define style — la rampe est
       ÉTEINTE (c'est le défaut), donc le style retenu dit « rampe éteinte » ;
       puis on recharge sur la phase suivante.
     · `?phase=revert` : au chargement, le rappel automatique va reposer ce style
       400 ms après que la scène est prête. On presse donc ⬚ Gradient TOUT DE SUITE,
       et on regarde la rampe à +250 ms puis à +2200 ms : si elle a disparu entre
       les deux, c'est le rappel qui l'a reprise — le « gradient does not work » du
       rapport, reproduit sur le vrai composant. */
const PHASE = params.get('phase') || '';
const clickByText = (needle) => {
  const btn = Array.prototype.slice.call(document.querySelectorAll('button'))
    .find((b) => String(b.textContent || '').includes(needle));
  if (!btn) return false;
  btn.click();
  return true;
};
const rampOf = (canvas) => getComputedStyle(canvas).backgroundImage;
const switchPressed = () => {
  const panel = document.getElementById('viewer-background');
  const sw = switchOf(panel);
  return sw ? sw.getAttribute('aria-pressed') : null;
};

const runDefine = async () => {
  OUT.stage = 'define';
  await post({});
  const canvas = await waitFor(glCanvas, 25000);
  if (!canvas) { OUT.stage = 'fatal'; log('aucun canvas WebGL (phase define)'); await post({}); return; }
  await waitFor(() => canvas.style.backgroundColor, 25000);
  await sleep(300);
  const pressed = clickByText('📌 Define style');
  await growViewer(canvas);
  OUT.cases.push({
    id: 'define', pressed, ramp: rampOf(canvas),
    composed: await composedOf(canvas),   // ⬚ la rampe est ÉTEINTE ici : le témoin « fond uni »
    stored: (() => { try { return localStorage.getItem('labViewerBgGradient'); } catch { return null; } })(),
  });
  await sleep(1200);          // laisse l'écriture (mémoire + fichier) se faire
  await post({});
  location.replace('/?phase=revert');
};

const runRevert = async () => {
  OUT.stage = 'revert';
  const canvas = await waitFor(glCanvas, 25000);
  if (!canvas) { OUT.stage = 'fatal'; log('aucun canvas WebGL (phase revert)'); await post({}); return; }
  await waitFor(() => canvas.style.backgroundColor, 25000);
  /* LE GESTE, TOUT DE SUITE — c'est le cas du rapport : on change la scène pendant
     que le rappel automatique (400 ms) est encore en vol. */
  const box = canvas.getBoundingClientRect();
  clickCanvas(canvas, box.left + box.width - 8, box.top + 8);
  await raf();
  const sw0 = switchOf(document.getElementById('viewer-background'));
  const pressedAt = performance.now();
  if (sw0) sw0.click();
  await sleep(250);
  const early = { ramp: rampOf(canvas), pressed: switchPressed(), at: Math.round(performance.now() - pressedAt), composed: await composedOf(canvas) };
  await sleep(1950);          // bien après l'échéance du rappel
  const late = { ramp: rampOf(canvas), pressed: switchPressed(), at: Math.round(performance.now() - pressedAt), composed: await composedOf(canvas) };
  OUT.cases.push({ id: 'revert', early, late, stories: { snapshots: (() => { try { return Object.keys(JSON.parse(localStorage.getItem('labViewerSnapshots') || '{}')); } catch { return []; } })() } });
  OUT.stage = 'done';
  await post({});
};

/* LA PHASE `ramp` — LE CAS DU RAPPORT, MESURÉ AU PIXEL : le viewer s'ouvre sur une
   rampe ALLUMÉE et l'on ne touche à RIEN (ni clic sur le fond, ni interrupteur).
   « I open the instance and the background is uniform » n'a alors plus nulle part où
   se cacher : la sonde lit la rampe telle que le navigateur la rasterise, puis le
   pixel COMPOSÉ (la rampe sous le rendu d'NGL), et l'alpha du rendu tout seul. */
const runRamp = async () => {
  OUT.stage = 'ramp';
  await post({});
  const canvas = await waitFor(glCanvas, 25000);
  if (!canvas) { OUT.stage = 'fatal'; log('aucun canvas WebGL (phase ramp)'); await post({}); return; }
  const grown = await growViewer(canvas);
  /* ⚠ ON ATTEND LA RAMPE ELLE-MÊME (le réglage est relu du magasin au montage, et
     la pose demande que l'étage existe) PUIS une VRAIE BOÎTE : mesurer plus tôt
     mesurerait une toile de 300×150 sans fond — déjà vu, et le chiffre serait faux. */
  const rampSeen = await waitFor(() => (String(canvas.style.backgroundImage || '') ? canvas.style.backgroundImage : null), 12000);
  const boxSeen = await waitFor(() => (canvas.getBoundingClientRect().height > 100 ? canvas : null), 8000);
  await sleep(300);
  if (!rampSeen) log('⚠ la rampe du magasin n’est jamais arrivée sur le canvas (phase ramp)');
  OUT.cases.push({
    id: 'ramp',
    grown,
    rampSeen: !!rampSeen,
    boxSeen: !!boxSeen,
    composed: await composedOf(canvas),
    paleToday: await paleVsToday(160, 240),
    cssBg: canvas.style.backgroundColor,
    inline: canvas.style.backgroundImage,
    stored: (() => { try { return localStorage.getItem('labViewerBgGradient'); } catch { return null; } })(),
  });
  OUT.stage = 'done';
  await post({});
};

const main = async () => {
  OUT.shadows = SHADOWS;
  /* 1. NGL D'ABORD (le dist local), puis on écoute ses demandes d'image. */
  const loaded = await loadScript('/ngl.js');
  OUT.ngl = loaded ? 'local' : (window.NGL ? 'déjà là' : 'absent');
  OUT.watched = watchNgl();
  /* 2. Le viewer ENSUITE : il trouvera `window.NGL` et montera aussitôt. */
  /* ⚠ LA PHASE `ramp` PRÉPARE LE MAGASIN AVANT LE MONTAGE — c'est le cas même du
     rapport, « I open the instance and the background is uniform » : une rampe
     ALLUMÉE qu'on relit à l'ouverture, sans toucher à rien. Les deux clés sont
     celles que le viewer écrit lui-même (elles sont lues par lui, jamais devinées) ;
     les couleurs sont fortes pour qu'un pixel ne puisse pas mentir. */
  if (PHASE === 'ramp') {
    try {
      localStorage.setItem('labViewerBg', '#ff0000');
      localStorage.setItem('labViewerBgGradient', JSON.stringify({ on: true, to: '#0000ff', angle: 180 }));
    } catch { /* ignore */ }
  }
  mountViewer();
  if (PHASE === 'define') { await runDefine(); return; }
  if (PHASE === 'revert') { await runRevert(); return; }
  if (PHASE === 'ramp') { await runRamp(); return; }
  await raf();
  OUT.stage = 'mount';
  await post({ shadows: SHADOWS });

  const canvas = await waitFor(glCanvas, 25000);
  if (!canvas) { OUT.stage = 'fatal'; log('aucun canvas WebGL : le viewer n’a pas monté'); await post({}); return; }
  /* La scène est VIVANTE quand NGL a écrit la couleur de fond de son canvas
     (`setBackground` → `style.backgroundColor`) : c'est le repère d'attente. */
  const painted = await waitFor(() => (canvas.style.backgroundColor ? canvas : null), 25000);
  if (!painted) { OUT.stage = 'fatal'; log('la scène n’a jamais pris sa couleur de fond (status pas prêt ?)'); await post({}); return; }
  /* ⚠ UNE VRAIE BOÎTE POUR LA TOILE — sinon la rampe mesurée ne serait qu'un trait
     (voir growViewer : c'est la mesure qui a fait sortir le « host: [2100, 1] »). */
  const grown = await growViewer(canvas);

  const box = canvas.getBoundingClientRect();
  const boxOf = (el) => { const b = el && el.getBoundingClientRect(); return b ? [Math.round(b.width), Math.round(b.height)] : null; };
  const vEl = viewerEl();
  /* ⚠ TÉMOIN DU RÉVEIL : un DEUXIÈME IntersectionObserver, posé par la sonde sur
     la même boîte, écrit ce que le navigateur annonce (visible / caché). C'est ce
     qui distingue « le viewer n'a pas su se réveiller » de « le navigateur n'a
     rien dit » quand la page revient. */
  const ioSaw = [];
  if (typeof IntersectionObserver !== 'undefined') {
    const witness = new IntersectionObserver((entries) => {
      entries.forEach((e) => ioSaw.push((e.isIntersecting ? 'visible' : 'hidden') + '@' + Math.round(performance.now())));
    }, { threshold: 0 });
    witness.observe(canvas.parentElement);
  }
  const base = {
    canvas: [Math.round(box.width), Math.round(box.height)],
    grown,
    /* ☀ LE DÉFAUT PÂLE D'HIER CONTRE CELUI DU JOUR — la mesure qui explique le
       rapport, faite par le rasteriseur du navigateur (voir paleVsToday). */
    paleToday: await paleVsToday(160, 240),
    boxes: {
      root: boxOf(container),
      viewer: boxOf(vEl),
      host: boxOf(canvas.parentElement),
      canvas: boxOf(canvas),
    },
    /* Ce qui mange la hauteur du viewer : les boîtes de ses enfants directs. */
    children: (() => {
      const kids = vEl ? vEl.children : [];
      return Array.prototype.slice.call(kids, 0, 10).map((k) => [String(k.className || '').slice(0, 40), boxOf(k)]);
    })(),
    cssBg: canvas.style.backgroundColor,
    rampsBefore: getComputedStyle(canvas).backgroundImage,
  };
  OUT.stage = 'repos-avant';
  /* LE REPOS, AVANT TOUT GESTE : c'est « the program is slow even if it does not
     have processes to do », mesuré. */
  const idleBefore = await sampleIdle(2500);

  /* LE GESTE 1 — le clic sur le FOND ouvre le panneau (un seul état basculé). */
  clickCanvas(canvas, box.left + box.width - 8, box.top + 8);
  await raf();
  await sleep(150);
  let panel = document.getElementById('viewer-background');
  let openedBy = 'clic sur le fond';
  if (!panel) {
    /* repli : le ⬚ de la barre fait le MÊME geste (`aria-controls` le désigne). */
    const bar = document.querySelector('[aria-controls="viewer-background"]');
    if (bar) { bar.click(); await raf(); await sleep(150); panel = document.getElementById('viewer-background'); openedBy = 'bouton ⬚ de la barre'; }
  }
  const btn = switchOf(panel);
  const gesture = {
    opened: !!panel,
    openedBy,
    panelLabel: panel ? String(panel.getAttribute('aria-label') || '').slice(0, 60) : '',
    switchFound: !!btn,
    switchText: btn ? String(btn.textContent || '').replace(/\s+/g, ' ').trim() : '',
    pressedBefore: btn ? btn.getAttribute('aria-pressed') : null,
  };
  OUT.stage = 'panneau';
  await post({});

  /* LE GESTE 2 — l'interrupteur ⬚ Gradient : c'est LUI qui peint la rampe. */
  let after = null;
  if (btn) {
    btn.click();
    await raf();
    await sleep(250);
    after = {
      pressed: btn.getAttribute('aria-pressed'),
      inlineCss: canvas.style.backgroundImage,
      computedCss: getComputedStyle(canvas).backgroundImage,
      cssBg: canvas.style.backgroundColor,
      stored: (() => { try { return localStorage.getItem('labViewerBgGradient'); } catch { return null; } })(),
      canvas: (() => { const b = canvas.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })(),
      /* ☀ LE PIXEL COMPOSÉ — la rampe telle que le navigateur la peint SOUS la
         scène : c'est l'écran, et c'est ce que « le fond reste uni » met en doute. */
      composed: await composedOf(canvas),
    };
  }
  OUT.stage = 'rampe-allumee';
  await post({});

  /* LE REPOS, AVEC LA RAMPE — une rampe CSS ne doit RIEN coûter au repos. */
  const idleAfter = await sampleIdle(2500);

  /* ── 5. LE REPOS VUE CACHÉE — LA PAGE PARQUÉE ────────────────────────────
     Le cœur du rapport « the program is slow even if it does not have processes
     to do » : une page quittée reste MONTÉE (`display: none`, le « page
     parking » d'App.jsx). Les deux boucles éternelles d'NGL ne s'en aperçoivent
     pas toutes seules — la sonde cache donc la vue comme le fait l'application,
     mesure, puis la remontre. */
  container.style.display = 'none';
  await sleep(500);                       // laisse l'IntersectionObserver parler
  const idleHidden = await sampleIdle(2500);
  container.style.display = '';
  await sleep(700);                       // le réveil (IO) + l'image qui le suit
  const wake = {
    computedCss: getComputedStyle(canvas).backgroundImage,
    cssBg: canvas.style.backgroundColor,
    visible: (() => { const b = canvas.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })(),
  };
  const idleShown = await sampleIdle(1500);

  /* LE GESTE 3 — l'interrupteur ÉTEINT rend la couleur d'NGL telle quelle. */
  let off = null;
  if (btn) {
    btn.click();
    await raf();
    await sleep(250);
    off = {
      pressed: btn.getAttribute('aria-pressed'),
      inlineCss: canvas.style.backgroundImage,
      computedCss: getComputedStyle(canvas).backgroundImage,
      composed: await composedOf(canvas),
    };
  }

  OUT.cases.push({ id: 'probe', base, gesture, after, off, idleBefore, idleAfter, idleHidden, idleShown, wake, ioSaw });
  OUT.stage = 'done';
  await post({});
};

main().catch(async (e) => {
  OUT.stage = 'fatal';
  log('pilote : ' + ((e && e.stack) || e));
  try { await post({}); } catch { /* rien */ }
});

window.addEventListener('unhandledrejection', (e) => log('rejet: ' + ((e.reason && e.reason.message) || e.reason)));
