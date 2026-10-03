const fs = require('fs');
const out = [];
const dump = (file, from, to) => {
  out.push('===== ' + file + ' [' + from + '-' + to + '] =====');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = from - 1; i < Math.min(to, lines.length); i += 1) out.push(String(i + 1).padStart(5) + '| ' + lines[i]);
  out.push('');
};
dump('src/utils/sequenceCharge.js', 100, 190);
dump('src/utils/modifications.js', 1, 200);
dump('_run_all.cjs', 1, 60);
fs.writeFileSync('_probe_seq3.txt', out.join('\n'), 'utf8');
console.log('ok');
