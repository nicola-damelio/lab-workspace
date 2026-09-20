/* Indice dei simboli: dichiarazioni di primo/secondo livello + bannieres di sezione. */
import { readFileSync } from 'fs';

const RE_DECL = /^ {0,6}(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function|class|return)\b/;
const RE_BANNER = /^ {0,6}(?:.*=====|\s*\/\*\s*=)/;

for (const file of process.argv.slice(2)) {
  console.log(`\n########## ${file} ##########`);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.replace(/\t/g, '  ');
    if (RE_BANNER.test(t) && /=====/.test(t)) {
      console.log(`${String(i + 1).padStart(6)} | § ${t.trim().replace(/\s+/g, ' ').slice(0, 110)}`);
    } else if (RE_DECL.test(t) && t.trim().length > 6) {
      console.log(`${String(i + 1).padStart(6)} |   ${t.trim().replace(/\s+/g, ' ').slice(0, 130)}`);
    }
  });
  console.log(`TOTAL LINES ${lines.length}`);
}
