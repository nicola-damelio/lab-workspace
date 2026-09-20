/* Outil de travail : grep fiable (écrit le résultat en JSON, à lire avec
   read_files — la console déforme le texte). Usage :
     node _grep.cjs <fichier> "<regex>" [maxHits] [contextLines]              */
const fs = require('fs');
const [, , file, pattern, maxArg, ctxArg] = process.argv;
// Sans arguments (le lanceur de tests appelle tout _*.cjs) : simple rappel, code 0.
if (!file || !pattern) {
  console.log('_grep.cjs — usage: node _grep.cjs <fichier> "<regex>" [maxHits] [contextLines]');
  process.exit(0);
}
const max = Number(maxArg || 80);
const ctx = Number(ctxArg || 0);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const re = new RegExp(pattern);
const hits = [];
lines.forEach((l, i) => {
  if (re.test(l) && hits.length < max) {
    const block = [];
    for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k += 1) {
      block.push(`${k + 1}| ${lines[k]}`);
    }
    hits.push({ line: i + 1, text: l, block });
  }
});
fs.writeFileSync('_grep_out.json', JSON.stringify({ file, pattern, total: hits.length, hits }, null, 1));
console.log(`_grep.cjs: ${hits.length} hits -> _grep_out.json`);
