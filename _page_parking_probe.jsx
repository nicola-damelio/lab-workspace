/* ============================================================================
   _page_parking_probe.jsx — LE MOTIF DES PLACES DE PAGE, RENDU POUR DE VRAI.

   C'est la sonde de _page_parking_render_test.cjs : elle est construite par Vite
   (mode navigateur, bundle autonome) et exécutée par Chrome en --headless=new.

   POURQUOI ELLE EXISTE. La promesse de la demande — « Keep alive EVERY page I
   leave (one at a time, hidden): nothing ever reloads when I come back » — tient
   à UNE propriété de React : entre frères d'un même parent, deux enfants qui
   échangent leur RANG mais gardent leur `key` sont DÉPLACÉS, pas reconstruits.
   Aucune lecture de source ne prouve cela, et si React ne le faisait pas, la page
   gardée perdrait son état au retour EN SILENCE (le défaut d'origine, en pire :
   on croirait le mécanisme en place).

   CE QU'ELLE MESURE (le même motif que src/App.jsx : pageSlotIds / pageSlotClass
   sont recopiés, et le harnais vérifie qu'ils sont IDENTIQUES à ceux de App.jsx) :
     1. la page qu'on quitte est TOUJOURS MONTÉE, et `display: none` ;
     2. elle CONTINUE de vivre : son compteur (une minuterie interne) avance
        pendant qu'elle est cachée — c'est le chargement en cours qui se termine ;
     3. au retour, c'est LE MÊME NŒUD DOM (===) et le compteur a continué ;
     4. le témoin NÉGATIF, monté à côté : le motif naïf (`{shown === 'x' && …}`)
        DÉTRUIT et RECRÉE la page — sans lui, la sonde pourrait être verte sans
        rien mesurer.
   ========================================================================== */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// La feuille de l'application : c'est elle qui porte `.hidden` (display: none) —
// la classe sur laquelle repose tout le mécanisme. La sonde mesure donc le VRAI
// style, pas une classe recopiée pour elle.
import './src/index.css';

/* ── le motif de App.jsx, recopié à l'identique (le harnais compare) ───────── */
export const parkedAfter = (leftModule) => {
  const left = String(leftModule == null ? '' : leftModule);
  if (!left || left === 'storage' || left === 'storage-detail') return null;
  return left;
};
export const pageSlotIds = (shownModule, parkedModule) => {
  const shown = String(shownModule == null ? '' : shownModule) || 'dashboard';
  const parked = parkedModule && parkedModule !== shown ? String(parkedModule) : null;
  return parked ? [shown, parked] : [shown];
};
export const pageSlotClass = (slotId, shownModule) => (slotId === shownModule ? 'contents' : 'hidden');

/* Une page : un compteur qui avance SEUL (50 ms) — la preuve de vie quand elle
   est cachée — et un identifiant DOM stable. Les compteurs de MONTAGE disent qui
   est recréé (la page ? son parent ?) quand on change de page. */
const Counter = ({ id, label }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    window.__mounts = window.__mounts || {};
    window.__mounts[id] = (window.__mounts[id] || 0) + 1;
    const t = setInterval(() => setN((v) => v + 1), 50);
    return () => clearInterval(t);
  }, [id]);
  return <div data-page={id} data-counter={n}>{label} {n}</div>;
};
const mounts = () => JSON.stringify(window.__mounts || {});

/* LE MOTIF DU MÉCANISME — la même chose que dans App.jsx : l'état de la page
   gardée est ajusté PENDANT LE RENDU (un effet s'exécuterait après le rendu, et
   la page quittée disparaîtrait de l'arbre pendant un rendu — la sonde mesure
   exactement ce piège). */
const Parked = ({ gotoRef }) => {
  const [shown, setShown] = useState('library');
  const [parked, setParked] = useState(null);
  const [shownSeen, setShownSeen] = useState(shown);
  if (shownSeen !== shown) {
    setShownSeen(shown);
    setParked(parkedAfter(shownSeen));
  }
  useEffect(() => { gotoRef.current = setShown; }, [gotoRef]);
  const slots = pageSlotIds(shown, parked);
  const slot = (id, render) => (
    slots.includes(id)
      ? <div key={id} data-page={id} className={pageSlotClass(id, shown)}>{render()}</div>
      : null
  );
  return (
    <div id="parked">
      {slot('library', () => <Counter id="library" label="Library" />)}
      {slot('tests', () => <Counter id="tests" label="Tests" />)}
    </div>
  );
};

/* LE TÉMOIN NÉGATIF : le motif d'avant (une page à la fois, montée/démontée). */
const Naive = ({ gotoRef }) => {
  const [shown, setShown] = useState('library');
  useEffect(() => { gotoRef.current = setShown; }, [gotoRef]);
  return (
    <div id="naive">
      {shown === 'library' && <Counter id="naive-library" label="Naive" />}
      {shown === 'tests' && <Counter id="naive-tests" label="Naive" />}
    </div>
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* La PLACE de la page (le div qui porte la classe de visibilité) et le COMPTEUR
   (le div de la page elle-même, qui porte `data-counter`) : deux nœuds distincts,
   et c'est leur identité DOM qui doit survivre — pas seulement celle du premier. */
const slotOf = (id) => document.querySelector(`#parked > [data-page="${id}"]:not([data-counter])`);
const countOf = (id) => Number((document.querySelector(`#parked [data-page="${id}"][data-counter]`) || { dataset: {} }).dataset.counter);
const node_ = (sel) => document.querySelector(sel);
const display = (el) => (el ? getComputedStyle(el).display : '(absent)');
const cls = (el) => ((el || {}).className || '(absent)');
const probeHtml = () => (node_('#parked') || {}).innerHTML || '(absent)';

/* Le geste de l'utilisateur, joué par la page elle-même : partir, revenir. */
const main = async () => {
  const gotoParked = { current: null };
  const gotoNaive = { current: null };
  createRoot(document.getElementById('root')).render(
    <div>
      <Parked gotoRef={gotoParked} />
      <Naive gotoRef={gotoNaive} />
    </div>
  );
  const out = { steps: [] };
  const step = (name, data) => { out.steps.push({ name, ...data }); };

  await sleep(500);
  const libSlot = slotOf('library');
  const libCounterNode = node_('#parked [data-page="library"][data-counter]');
  const naiveLib = node_('#naive > [data-page="naive-library"]');
  step('depart', {
    mounted: document.querySelectorAll('#parked > [data-page]:not([data-counter])').length,
    slots: [...document.querySelectorAll('#parked > [data-page]:not([data-counter])')].map((n) => n.dataset.page),
    slotDisplay: display(libSlot), slotClass: cls(libSlot),
    counter: countOf('library'), mounts: mounts(), html: probeHtml(),
  });

  /* ── on change de PAGE (c'est le geste de l'utilisateur) ─────────────────── */
  gotoParked.current('tests');
  gotoNaive.current('tests');
  await sleep(400);

  step('pendant-qu-on-est-ailleurs', {
    mounted: document.querySelectorAll('#parked > [data-page]:not([data-counter])').length,
    slots: [...document.querySelectorAll('#parked > [data-page]:not([data-counter])')].map((n) => n.dataset.page),
    sameSlot: slotOf('library') === libSlot,
    sameCounter: node_('#parked [data-page="library"][data-counter]') === libCounterNode,
    slotDisplay: display(slotOf('library')), slotClass: cls(slotOf('library')),
    counter: countOf('library'),
    testsDisplay: display(slotOf('tests')), testsClass: cls(slotOf('tests')),
    naiveGone: !node_('#naive > [data-page="naive-library"]'),
    mounts: mounts(), html: probeHtml(),
  });

  /* ── on REVIENT sur la page gardée ───────────────────────────────────────── */
  gotoParked.current('library');
  gotoNaive.current('library');
  await sleep(300);

  step('au-retour', {
    mounted: document.querySelectorAll('#parked > [data-page]:not([data-counter])').length,
    slots: [...document.querySelectorAll('#parked > [data-page]:not([data-counter])')].map((n) => n.dataset.page),
    sameSlot: slotOf('library') === libSlot,
    sameCounter: node_('#parked [data-page="library"][data-counter]') === libCounterNode,
    slotDisplay: display(slotOf('library')), slotClass: cls(slotOf('library')),
    counter: countOf('library'),
    testsParked: cls(slotOf('tests')) === 'hidden',
    naiveRebuilt: node_('#naive > [data-page="naive-library"]') !== naiveLib,
    naiveCounter: Number((node_('#naive > [data-page="naive-library"]') || { dataset: {} }).dataset.counter),
    mounts: mounts(), html: probeHtml(),
  });

  await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
  document.title = 'probe-done';
};

main().catch((e) => {
  fetch('/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fatal: String((e && e.message) || e) }),
  });
});
