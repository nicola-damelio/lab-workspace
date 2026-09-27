/* =========================================================================
   _scan19.mjs — LA CHECKLIST DU LOT WIP dans l'arbre VIVANT
   (viewer + toutes les sources) → _live_scan19.txt
   ========================================================================= */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const O = [];
const w = (s = '') => O.push(s);
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const cnt = (s, x) => (x ? s.split(x).length - 1 : 0);

const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (['.js', '.jsx'].includes(extname(e.name))) acc.push(p.replace(/\\/g, '/'));
  }
  return acc;
};
const FILES = new Map(walk('src').map((p) => [p, rd(p)]));
const VIEWP = 'src/components/NMRMoleculeViewer.jsx';
const VIEW = FILES.get(VIEWP);
const VL = VIEW.split('\n');
const at = (needle, max = 40) => {
  const hits = [];
  VL.forEach((l, i) => { if (l.includes(needle) && hits.length < max) hits.push(`    l.${i + 1}: ${l.trim().slice(0, 160)}`); });
  return hits.length ? hits.join('\n') : '    (aucune)';
};

w(`viewer : ${VL.length} lignes · sources src/ : ${FILES.size} fichiers`);

w('\n===== A. ce que le viewer EXPORTE (les sondes ne testent que .a) =====');
w([...VIEW.matchAll(/(?:^|\n)export (?:const|function) ([A-Za-z_$][\w$]*)/g)].map((m) => m[1]).join(', '));

w('\n===== B. plaques de cycles + changement de frame =====');
for (const n of ['nucleicRingPlates', 'addRingPlates', 'addBufferRepresentation', 'refreshed', 'frameChanged',
  'signals.', 'updatePosition(', 'setFrameSafe(', 'setFrame(', 'trajRef.current']) {
  w(`  -- « ${n} » × ${cnt(VIEW, n)}`);
  w(at(n));
}

w('\n===== C. currentFrame : chaque occurrence =====');
w(at('currentFrame', 60));

w('\n===== D. effets : tableau de dépendances (et si currentFrame y est) =====');
let lastUE = 0;
VL.forEach((l, i) => {
  if (l.includes('useEffect(')) lastUE = i + 1;
  const m = l.match(/^\s*\}\s*,\s*\[(.*)\]\);/);
  if (m) w(`  l.${i + 1} (useEffect l.${lastUE}) : [${m[1].slice(0, 150)}]`);
});

w('\n===== E. clés de stockage du viewer (persistance) =====');
w([...VIEW.matchAll(/const ([A-Z][A-Z0-9_]*KEY[A-Z0-9_]*)\s*=\s*'([^']+)'/g)].map((m) => `  ${m[1]} = '${m[2]}'`).join('\n') || '  (aucune)');
w('  usages localStorage : ' + cnt(VIEW, 'localStorage.') + ' · sessionStorage : ' + cnt(VIEW, 'sessionStorage.'));

w('\n===== F. la fenêtre de style : All / None / Fit / move-rotate / reset =====');
for (const n of ['toggleAllMolecules', 'allMoleculesShown', '\u2611 All', '\u2610 None', 'fitMoleculesOnChosen', 'Fit to chosen',
  'worldDeltaForScreen', 'resetExtraMolPosition', 'resetMainPosition', 'Fit to chosen (mouse)']) {
  w(`  -- « ${n} » × ${cnt(VIEW, n)}`);
  w(at(n, 12));
}

w('\n===== G. les champs de décalage X / Y / Z ont-ils disparu ? =====');
for (const n of ['Shift X', 'Shift Y', 'Shift Z', 'shiftX', 'shiftY', 'shiftZ', 'setExtraMolPosition', 'setMainPosition',
  'X shift', 'Y shift', 'Z shift', 'd\u00e9calage X']) {
  w(`  -- « ${n} » × ${cnt(VIEW, n)}${cnt(VIEW, n) ? '' : '  (absent)'}`);
}
w('  -- tous les libellés de boutons de la fenêtre de style contenant « Move » / « Rotate » :');
VL.forEach((l, i) => { if (/>\s*(Move|Rotate|Reset)[^<]{0,40}</.test(l)) w(`    l.${i + 1}: ${l.trim().slice(0, 150)}`); });

w('\n===== H. matrice fonctionnalité → fichiers (toute la src/) =====');
const FEATURES = [
  ['groupe « Sequence and structure »', ['Sequence and structure', 'CollapsibleSection']],
  ['page dans l\u2019URL', ['urlWithMod', 'urlWithoutMod']],
  ['instance du viewer', ['instanceKey']],
  ['fit des molécules', ['structureFit', 'fitMoleculesOnChosen']],
  ['progression de chargement', ['loadProgress']],
  ['molette (zoom)', ['onWheel', "'wheel'"]],
  ['type de lipide (lab-lipid-groups / parts)', ['lab-lipid-groups', 'LIPID_TYPE_ORDER', 'lipidPartByBond',
    'defineLipidGroupsScheme']],
  ['plaques de cycles', ['nucleicRingPlates', 'addBufferRepresentation']],
  ['couleur de ruban', ['catColorParams', 'worldDeltaForScreen']],
];
for (const [label, needles] of FEATURES) {
  w(`\n  ### ${label}`);
  for (const n of needles) {
    const hits = [...FILES].filter(([, s]) => s.includes(n)).map(([p, s]) => `${p}×${cnt(s, n)}`);
    w(`    ${hits.length ? '[OK]' : '[!!]'} ${JSON.stringify(n)} → ${hits.join(', ') || 'ABSENT'}`);
  }
}

w('\n===== I. src/utils/*.js présents =====');
for (const f of readdirSync('src/utils')) w(`  ${f}  ${statSync(join('src/utils', f)).size} o`);
w(`  loadProgress.js existe : ${existsSync('src/utils/loadProgress.js')}`);

writeFileSync('_live_scan19.txt', O.join('\n'), 'utf8');
console.log('_live_scan19.txt written');
