/* _scan40.mjs — does ANYTHING in the live viewer rebuild rows/plates on a FRAME change? */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/components/NMRMoleculeViewer.jsx';
const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
let out = `viewer lines: ${lines.length}\n`;

const show = (re, title) => {
  out += `\n########## ${title} ##########\n`;
  lines.forEach((l, i) => {
    if (re.test(l)) out += `${i + 1}| ${l}\n`;
  });
};

// 1. any dep array mentioning a frame-ish variable
show(/^\s*}, \[[^\]]*\bframe/i, 'dep arrays containing "frame"');
// 2. any mention of refreshed / frame signals
show(/refreshed|frameChanged|signals\.frame/i, 'refreshed / frame signals');
// 3. dep arrays containing currentFrame
show(/\[[^\]]*currentFrame[^\]]*\]/, 'dep arrays containing currentFrame');
// 4. interior atoms / plate refresh vocabulary
show(/interior|plateRef|platesRef|rebuildPlate|refreshPlate|frameEpoch|frameKey/i,
  'interior / plate-refresh vocabulary');
// 5. rebuild entry points that a frame effect could call
show(/const (rebuildAll|rebuildRows|rebuildSection|applyCurrentStyleTo|rebuildSectionsOf|refreshRows)\b/,
  'rebuild entry points');
// 6. updateRepresentations / setParameters position
show(/updateRepresentations|position: true|setParameters\(\{\s*position/,
  'updateRepresentations / position updates');
writeFileSync('_live_scan40.txt', out);
console.log('_live_scan40.txt', lines.length);
