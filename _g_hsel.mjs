/* Scratch probe (throw-away): which NGL selection syntax isolates HYDROGEN?
   The viewer needs ONE clause to hide every hydrogen of every molecule. */
import { writeFileSync } from 'node:fs';

let mod = null;
for (const t of ['ngl', 'ngl/dist/ngl.esm.js', 'ngl/dist/ngl.js']) {
  try { mod = await import(t); break; } catch (e) { /* next */ }
}
const NGL = (mod && mod.Selection) ? mod : (mod && mod.default ? mod.default : mod);
const out = [];
out.push(`module=${mod ? 'ok' : 'NONE'} · hasSelection=${typeof (NGL && NGL.Selection)}`);

const base = { atomname: 'HB2', resname: 'LEU', resno: 1, chainname: 'A', chainid: 0, index: 0, sstruc: '', altloc: '' };
const atomH = { ...base, element: 'H' };
const atomC = { ...base, element: 'C', atomname: 'CB' };
if (NGL && NGL.Selection) {
  const cands = ['element H', 'not element H', 'hydrogen', 'not hydrogen', '_H', 'not _H',
    'atomname H', 'not .H', 'elem H', 'element=H'];
  for (const s of cands) {
    try {
      const sel = new NGL.Selection(s);
      let onH = 'n/a';
      let onC = 'n/a';
      try { onH = sel.test(atomH); } catch (e) { onH = `test-threw:${e.message}`; }
      try { onC = sel.test(atomC); } catch (e) { onC = `test-threw:${e.message}`; }
      out.push(`${JSON.stringify(s)} → parsed · H=${onH} · C=${onC}`);
    } catch (e) {
      out.push(`${JSON.stringify(s)} → THREW ${e.message}`);
    }
  }
}
writeFileSync('_g_hsel.txt', out.join('\n') + '\n', 'utf8');
console.log(`probe written (${out.length} lines)`);
