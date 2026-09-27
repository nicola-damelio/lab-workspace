/* Sonde jetable 2 : mots-clés des derniers points (isolation cartoon, slab, parité) */
const { readFileSync, readdirSync } = require('node:fs');
const rx = /isol|slab|parit|parity|nucleicRingPlates|SELECTED_SECTION_PREFIX|selectedSection|cartoon.*selection|selection.*cartoon/i;
const files = readdirSync('.').filter((f) => /^_viewer.*\.(mjs|cjs)$/.test(f));
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (rx.test(l) && !/^\s*\*/.test(l)) console.log(`${f}:${i + 1}: ${l.trim().slice(0, 200)}`);
  });
}
