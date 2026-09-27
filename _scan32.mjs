/* _scan32.mjs — the effect that OWNS the catalog plate site (9674) and the PyMOL one. */
import { readFileSync, writeFileSync } from 'node:fs';

const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const L = VIEW.split('\n');
let out = '';

// The nearest enclosing `useEffect(() => {` above a line, plus its dependency array.
const enclosingEffect = (line) => {
  for (let i = line - 1; i >= 0; i -= 1) {
    if (/^\s{0,2}useEffect\(\(\) => \{/.test(L[i])) {
      let depth = 0;
      for (let j = i; j < L.length; j += 1) {
        for (const ch of L[j]) {
          if (ch === '{') depth += 1; else if (ch === '}') depth -= 1;
        }
        if (depth === 0) {
          return { header: i + 1, deps: j + 1, text: `${i + 1}| ${L[i].trim()}\n${j + 1}| ${L[j].trim()}` };
        }
      }
    }
  }
  return null;
};
// …and the nearest enclosing local helper declaration.
const enclosingHelper = (line) => {
  for (let i = line - 1; i >= 0; i -= 1) {
    if (/^\s{2,4}(const [A-Za-z0-9_]+ = \(|const [A-Za-z0-9_]+ = useCallback\()/.test(L[i])) return `${i + 1}| ${L[i].trim()}`;
  }
  return '(none)';
};

for (const site of [9356, 9674, 11646]) {
  out += `\n===== site ${site} =====\nhelper: ${enclosingHelper(site)}\n`;
  const e = enclosingEffect(site);
  out += `effect: ${e ? e.text : '(none)'}\n`;
}

const dump = (from, to, label) => {
  out += `\n===== ${label} ${from}-${to} =====\n`;
  out += L.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n') + '\n';
};
dump(9630, 9680, 'catalog plate helper');
dump(11630, 11660, 'PyMOL plate site');
dump(6110, 6145, 'setFrameSafe');
dump(10645, 10700, 'play + handleFrameChange');

// Every `signals.` subscription and every mention of a buffer refresh, for the record.
out += '\n===== signals / refresh vocabulary =====\n';
L.forEach((l, i) => {
  if (/signals|refreshed|rebuild.*frame|frame.*rebuild/i.test(l)) out += `${i + 1}| ${l.trim()}\n`;
});
writeFileSync('_live_scan32.txt', out);
console.log('_live_scan32.txt written');
