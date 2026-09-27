import fs from 'fs';

const out = [];
const rd = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/);

const V = 'src/components/NMRMoleculeViewer.jsx';
const v = rd(V);
out.push(`=== ${V} — ${v.length} lines ===`);
out.push('--- /plate/i ---');
v.forEach((l, i) => { if (/plate/i.test(l)) out.push(`${i + 1}: ${l.trim()}`); });
out.push('--- /toActualFrame|keptFrames|stride|ringOpacity|sectionOpacity/ ---');
v.forEach((l, i) => { if (/toActualFrame\(|keptFrames|strideRef/.test(l)) out.push(`${i + 1}: ${l.trim()}`); });

// every src file mentioning nucleicRingPlates → dump the whole file
const hits = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) {
      const t = fs.readFileSync(p, 'utf8');
      if (t.includes('nucleicRingPlates')) hits.push(p);
    }
  }
};
walk('src');
out.push('=== files mentioning nucleicRingPlates ===');
hits.forEach((p) => {
  out.push(`--- FILE ${p} ---`);
  rd(p).forEach((l, i) => out.push(`${i + 1}: ${l}`));
});

fs.writeFileSync('_t_plates2.txt', out.join('\n'));
console.log('written _t_plates2.txt', out.length, 'lines, util files:', hits.join(', '));
