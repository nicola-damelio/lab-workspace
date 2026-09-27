/* Sonde jetable : les DEUX sections touchées par la fusion, HEAD contre l'arbre
   de travail, côte à côte. On imprime le corps de chacune (du titre jusqu'au
   `</section>` qui la ferme) et le compte de pastilles qu'elle porte — c'est
   là que se lit ce que la fusion a gardé et ce qu'elle a retiré. */
const fs = require('fs');
const cp = require('child_process');

const cur = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const head = cp.execSync('git show HEAD:src/components/NMRMoleculeViewer.jsx', { maxBuffer: 1e9 }).toString();

const sectionOf = (text, needle) => {
  const at = text.indexOf(needle);
  if (at < 0) return `(introuvable : ${needle})`;
  const start = text.lastIndexOf('<section', at);
  const end = text.indexOf('</section>', at) + '</section>'.length;
  return text.slice(start, end);
};

const report = (label, needle) => {
  const out = [`##### ${label} #####`];
  for (const [name, text] of [['HEAD', head], ['WORK', cur]]) {
    const body = sectionOf(text, needle);
    const inputs = (body.match(/type="color"/g) || []).length;
    const lines = body.split('\n');
    out.push(`----- ${name} : ${lines.length} lignes, ${inputs} pastilles -----`);
    out.push(body);
  }
  return out.join('\n');
};

const chunks = [
  report('AMINO ACIDS', 'Amino acids · '),
  '',
  report('LIPID TYPES', '>Lipid types'),
];
fs.writeFileSync('_sections_cmp.txt', chunks.join('\n'), 'utf8');
console.log('ok');
