/* Grep the NGL bundle for every style writer and the quality path — to know
   whether NGL can wipe the canvas' inline background (the gradient killer). */
import fs from 'node:fs';

const text = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const out = [];
const dump = (label, re, span = 300) => {
  out.push(`\n########## ${label} ##########`);
  let m; let n = 0;
  while ((m = re.exec(text)) && n < 12) {
    const from = Math.max(0, m.index - span);
    const to = Math.min(text.length, m.index + m[0].length + span);
    out.push(`--- @${m.index} ---\n` + text.slice(from, to));
    n += 1;
  }
  if (!n) out.push('(none)');
};

dump('style.background / cssText / setAttribute(style', /style\.background(?!Color)[A-Za-z]*\s*=|style\.cssText|domElement\.style\./g, 200);
dump('setQuality', /\bsetQuality\s*\(/g, 500);
dump('domElement =', /domElement\s*=\s*/g, 250);
dump('new WebGLRenderer / createElement', /new [A-Za-z]*Renderer\s*\(|createElement\(\s*['"]canvas['"]\s*\)/g, 200);
dump('getStyle / setClearColor', /setClearColor\s*\(/g, 250);

fs.writeFileSync('_x_ngl2.txt', out.join('\n'), 'utf8');
console.log('bytes', fs.statSync('_x_ngl2.txt').size);
