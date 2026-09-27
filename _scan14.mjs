import fs from 'fs';

const out = [];
const show = (file, re, cap = 40) => {
  out.push('');
  out.push(`########## ${file} ##########`);
  if (!fs.existsSync(file)) { out.push('(missing)'); return; }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((ln, i) => { if (re.test(ln)) hits.push(`${i + 1}| ${ln.slice(0, 170)}`); });
  hits.slice(0, cap).forEach((h) => out.push(h));
  if (hits.length > cap) out.push(`   ... ${hits.length - cap} more`);
};

show('_ngl_src/representation__structure-representation.ts', /^\s{2}(update|make|build|prepare|create|setParameters|attach)\s*\(/);
show('_ngl_src/representation__structure-representation.ts', /updateWhat|make\s*\(/, 25);
show('_ngl_src/representation__representation.ts', /make|queue|toBePrepared|this\.tasks/, 40);
show('_ngl_src/representation__buffer-representation.ts', /make|build|update|prepare/, 20);

fs.writeFileSync('_live_scan14.txt', out.join('\n'), 'utf8');
console.log('ok');
