/* Sonde jetable : que disent les garde-fous de « trace » et des jeux de styles ? */
const { readFileSync, readdirSync } = require('node:fs');
const files = readdirSync('.').filter((f) => /^_.*\.(mjs|cjs)$/.test(f));
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/\btrace\b/.test(l) || /STYLES\./.test(l) || /STYLES =/.test(l)) {
      console.log(`${f}:${i + 1}: ${l.trim().slice(0, 220)}`);
    }
  });
}
