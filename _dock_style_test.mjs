/* =========================================================================
   _dock_style_test.mjs — le STYLE DU BOUTON « 🧬 Docking » du viewer 3D.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • le look d'amarrage (partie PROTÉINE + partie LIGAND) est un RÉGLAGE
       enregistré, pas une capture silencieuse : une fois défini, passer le mode
       à ON applique CE look au lieu de réécrire le style avec ce qui traîne à
       l'écran ;
     • un réglage jamais défini (`defined:false`) laisse le premier passage à ON
       copier la vue — le geste historique — puis plus jamais ;
     • un jeton de style inconnu retombe sur le défaut du rôle (ribbon /
       ball+stick) au lieu de casser le rendu ;
     • src/components/NMRMoleculeViewer.jsx utilise bien ce réglage : la
       définition est lue, les deux menus la modifient, et le toggle ne capture
       QUE si rien n'a été défini.

   Le VRAI module est importé : src/utils/dockStyles.js (aucun faux Drive : cet
   utilitaire ne connaît ni React ni NGL).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const DOCK = await import('./src/utils/dockStyles.js');

/* ── 1. Le défaut ─────────────────────────────────────────────────────────── */
eq(DOCK.DOCK_STYLE_DEFAULT, { protein: 'ribbon', ligand: 'ball+stick' }, 'le look d’amarrage par défaut');
eq(DOCK.DOCK_STYLE_TOKENS.includes('lines'), true, 'les lignes font partie des styles proposés');
eq(DOCK.DOCK_STYLE_TOKENS.includes('spheres'), true, 'les sphères font partie des styles proposés');
eq(DOCK.DOCK_STYLE_LABELS['ball+stick'], 'Ball & Stick', 'le libellé d’un style');

/* ── 2. Normalisation d'un réglage ────────────────────────────────────────── */
eq(DOCK.normalizeDockRoleStyles(null), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'aucun réglage → défaut et « jamais défini » (le premier ON copiera la vue)');
eq(DOCK.normalizeDockRoleStyles({}), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'un objet vide ne définit rien');
eq(DOCK.normalizeDockRoleStyles({ protein: 'lines', ligand: 'spheres' }), { protein: 'lines', ligand: 'spheres', defined: true },
  'les deux rôles choisis sont conservés');

/* ── 3. Lecture / écriture du réglage (localStorage simulé) ───────────────── */
const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
};

const st1 = fakeStorage();
eq(DOCK.loadDockRoleStyles(st1), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'sans clé enregistrée : défaut + « pas encore défini »');

DOCK.saveDockRoleStyles({ protein: 'lines', ligand: 'spheres' }, st1);
eq(st1._map.get(DOCK.DOCK_STYLE_KEY), JSON.stringify({ protein: 'lines', ligand: 'spheres' }),
  'le réglage est écrit sous la clé labViewerDockStyle');
eq(DOCK.loadDockRoleStyles(st1), { protein: 'lines', ligand: 'spheres', defined: true },
  'aller-retour : le look choisi est retrouvé et marqué comme défini');

DOCK.saveDockRoleStyles({ protein: 'nonsense', ligand: 'nonsense' }, st1);
eq(DOCK.loadDockRoleStyles(st1).defined, false,
  'un réglage illisible n’est jamais pris pour une définition');
eq(st1._map.has(DOCK.DOCK_STYLE_KEY), false,
  'un réglage illisible retire la clé au lieu d’y écrire des jetons inventés');

const st2 = fakeStorage();
st2.setItem(DOCK.DOCK_STYLE_KEY, '{ceci n’est pas du JSON');
eq(DOCK.loadDockRoleStyles(st2), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'un JSON cassé ne fait pas planter le viewer');
eq(DOCK.loadDockRoleStyles(null), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'sans storage (rendu serveur / test) : défaut, jamais une exception');

/* ── 4. 📸 Capturer la vue = définir ──────────────────────────────────────── */
eq(DOCK.dockRoleStylesFromCapture({ protein: 'cartoon', ligand: 'sticks' }), { protein: 'cartoon', ligand: 'sticks', defined: true },
  '📸 copie la vue et la retient comme définition');
eq(DOCK.dockRoleStylesFromCapture(null), { protein: 'ribbon', ligand: 'ball+stick', defined: true },
  '📸 sur une vue illisible reste une définition (le défaut), donc plus de capture automatique');
eq(DOCK.saveDockRoleStyles(DOCK.dockRoleStylesFromCapture({ protein: 'sticks', ligand: 'lines' }), st1),
  { protein: 'sticks', ligand: 'lines', defined: true },
  'save renvoie le réglage normalisé (l’appelant peut le garder en mémoire)');

/* ── 5. Le viewer utilise bien la DÉFINITION ─────────────────────────────── */
const VIEWER = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8');
ok(/from '\.\.\/utils\/dockStyles'/.test(VIEWER), 'le viewer importe src/utils/dockStyles');
ok(/useState\(\(\) => loadDockRoleStyles\(\)\)/.test(VIEWER), 'la définition est chargée à l’ouverture du viewer');
ok(/saveDockRoleStyles\(dockStyles\)/.test(VIEWER), 'la définition est enregistrée à chaque changement');
ok(/if \(!dockStyles\.defined\)/.test(VIEWER), 'le toggle ne capture la vue que si RIEN n’a été défini');
ok(/setDockRoleStyle\('protein'/.test(VIEWER) && /setDockRoleStyle\('ligand'/.test(VIEWER),
  'les deux menus (protéine / ligand) définissent le look');
ok(/const captureDockStylesFromViewer = /.test(VIEWER), '📸 « copier la vue » existe comme bouton explicite');
ok(/const resetDockStyles = /.test(VIEWER), '↺ « défaut » existe');
ok(/DOCK_STYLE_TOKENS\.map/.test(VIEWER), 'les menus proposent exactement les styles connus');
ok(/applyDockStylesNow\(\)/.test(VIEWER), 'changer la définition ré-applique le look au viewer');
ok(/const st = dockRoleStylesRef\.current \|\| \{\};/.test(VIEWER), 'applyDockRoleStyle lit les styles définis');
ok(/dockRoleStylesRef\.current = \{ protein: dockStyles\.protein, ligand: dockStyles\.ligand \};/.test(VIEWER),
  'le réglage est synchronisé dans la réf utilisée par le rendu');
ok((VIEWER.match(/captureDockRoleStyles\(/g) || []).length <= 3,
  'la capture de la vue n’a pas lieu ailleurs qu’au premier passage à ON (toggle + 📸 + helper)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_dock_style_test.mjs — ${passed} assertions OK`);

eq(DOCK.normalizeDockRoleStyles({ protein: 'lines' }), { protein: 'lines', ligand: 'ball+stick', defined: true },
  'un seul rôle choisi suffit à définir le look ; l’autre garde son défaut');
eq(DOCK.normalizeDockRoleStyles({ protein: 'blob', ligand: 'blob' }), { protein: 'ribbon', ligand: 'ball+stick', defined: false },
  'des jetons inconnus ne définissent RIEN (on retombe sur le comportement historique)');
eq(DOCK.normalizeDockRoleStyles({ protein: 'sphere', ligand: 'ball+stick' }).protein, 'ribbon',
  'seuls les jetons canoniques sont acceptés (pas d’alias NGL)');
