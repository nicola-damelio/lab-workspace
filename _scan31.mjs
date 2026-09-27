/* _scan31.mjs — the ENCLOSING function of each plate call site, and the frame path. */
import { readFileSync, writeFileSync } from 'node:fs';

const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const L = VIEW.split('\n');
let out = '';

const owner = (line) => {
  for (let i = line - 1; i >= 0; i -= 1) {
    if (/^\s{0,4}(const|function|useEffect|useCallback|useMemo)\b/.test(L[i])) return i + 1;
  }
  return 0;
};
const show = (line, before, after, label) => {
  const o = owner(line);
  out += `\n===== ${label}: site ${line} · owner ${o} =====\n`;
  out += L.slice(o - 1, o + 3).map((l, i) => `${o + i}| ${l}`).join('\n') + '\n';
  out += `----- around ${line} -----\n`;
  out += L.slice(line - 1 - before, line + after).map((l, i) => `${line - before + i}| ${l}`).join('\n') + '\n';
  // the first dependency array after the site (the effect that owns it)
  const deps = [];
  for (let i = line; i < Math.min(line + 260, L.length); i += 1) {
    if (/^\s{0,4}\}, \[/.test(L[i]) || /^\s{0,4}\], \[/.test(L[i])) { deps.push(`${i + 1}| ${L[i]}`); }
    if (deps.length >= 3) break;
  }
  out += `----- dep arrays below -----\n${deps.join('\n')}\n`;
};

show(9356, 6, 20, 'A buildSectionReps/addPlates');
show(9674, 20, 22, 'B catalog effect');
show(11646, 14, 20, 'C PyMOL path');
show(6118, 4, 22, 'D setFrameSafe');
show(10658, 12, 14, 'E play/step');
show(10686, 4, 24, 'F handleFrameChange');
show(11761, 12, 6, 'G the sectionCatalog rebuild effect');

// Every effect whose dependency array mentions styleSignature, with its header.
out += '\n===== effects depending on styleSignature =====\n';
L.forEach((l, i) => {
  if (/^\s{0,4}\}, \[.*styleSignature/.test(l)) {
    const o = owner(i + 1);
    out += `${o}| ${L[o - 1].trim()}  …  ${i + 1}| ${l.trim()}\n`;
  }
});
// Any effect whose deps mention a frame (currentFrame / frame / trajectory).
out += '\n===== effects depending on a FRAME =====\n';
L.forEach((l, i) => {
  if (/^\s{0,4}\}, \[/.test(l) && /frame/i.test(l)) {
    const o = owner(i + 1);
    out += `${o}| ${L[o - 1].trim()}  …  ${i + 1}| ${l.trim()}\n`;
  }
});
writeFileSync('_live_scan31.txt', out);
console.log('_live_scan31.txt written');
