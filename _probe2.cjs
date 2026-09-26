/* Probe 2: FLIP_SIDED / setParameters-unknown-key behaviour + test harness availability. */
const fs = require('fs');
const path = require('path');
const root = 'c:/Users/nicol/lab-workspace';
const out = [];

const dist = path.join(root, 'node_modules/ngl/dist/ngl.js');
const s = fs.readFileSync(dist, 'utf8');

const ctx = (needle, before = 200, after = 200, max = 8) => {
  let i = -1, c = 0;
  while ((i = s.indexOf(needle, i + 1)) >= 0) {
    c += 1;
    if (c <= max) out.push(`--- ${needle} @${i} :: ${s.slice(Math.max(0, i - before), i + after).replace(/\n/g, '\\n')}`);
  }
  out.push(`### ${needle} count=${c}`);
};

ctx('FLIP_SIDED', 220, 120, 8);
ctx('flipSided', 220, 160, 8);
ctx('OPAQUE_BACK', 120, 200, 4);

/* Representation#setParameters : que fait NGL d'une clé inconnue (ex: `transparent`)? */
ctx('setParameters(e,t){const n=this.parameters', 60, 700, 2);
ctx('parameters[e]===void 0', 60, 700, 2);

/* Le harness de rendu : qu'est-ce qui est installé ? */
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
out.push('### deps: ' + JSON.stringify(pkg.dependencies));
out.push('### devDeps: ' + JSON.stringify(pkg.devDependencies));
out.push('### scripts: ' + JSON.stringify(pkg.scripts));
const mods = fs.readdirSync(path.join(root, 'node_modules')).filter((d) => /puppeteer|playwright|headless|gl$|jsdom|canvas|chromium/i.test(d));
out.push('### render-ish modules in node_modules: ' + JSON.stringify(mods));

fs.writeFileSync(path.join(root, '_probe2_out.txt'), out.join('\n'));
console.log('OK');
