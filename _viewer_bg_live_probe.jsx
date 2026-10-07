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

/* ── 5. LE CANVAS D'NGL (le SEUL de la vue qui soit WebGL) ──────────────── */
const glCanvas = () => {
  const list = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  return list.find((c) => {
    try { return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  }) || null;
};
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
  OUT.cases.push({ id: 'define', pressed, ramp: rampOf(canvas), stored: (() => { try { return localStorage.getItem('labViewerBgGradient'); } catch { return null; } })() });
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
  const early = { ramp: rampOf(canvas), pressed: switchPressed(), at: Math.round(performance.now() - pressedAt) };
  await sleep(1950);          // bien après l'échéance du rappel
  const late = { ramp: rampOf(canvas), pressed: switchPressed(), at: Math.round(performance.now() - pressedAt) };
  OUT.cases.push({ id: 'revert', early, late, stories: { snapshots: (() => { try { return Object.keys(JSON.parse(localStorage.getItem('labViewerSnapshots') || '{}')); } catch { return []; } })() } });
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
  mountViewer();
  if (PHASE === 'define') { await runDefine(); return; }
  if (PHASE === 'revert') { await runRevert(); return; }
  await raf();
  OUT.stage = 'mount';
  await post({ shadows: SHADOWS });

  const canvas = await waitFor(glCanvas, 25000);
  if (!canvas) { OUT.stage = 'fatal'; log('aucun canvas WebGL : le viewer n’a pas monté'); await post({}); return; }
  /* La scène est VIVANTE quand NGL a écrit la couleur de fond de son canvas
     (`setBackground` → `style.backgroundColor`) : c'est le repère d'attente. */
  const painted = await waitFor(() => (canvas.style.backgroundColor ? canvas : null), 25000);
  if (!painted) { OUT.stage = 'fatal'; log('la scène n’a jamais pris sa couleur de fond (status pas prêt ?)'); await post({}); return; }

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
