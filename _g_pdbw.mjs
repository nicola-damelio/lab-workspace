/* Scratch probe (throw-away): does NGL's PdbWriter write TRANSFORMED coordinates,
   and can an AtomProxy's x/y/z be written (for a temporary « bake the poses »
   before exporting)? Pure node, no DOM: NGL parses a PDB text. */
import { writeFileSync } from 'node:fs';

let mod = null;
for (const t of ['ngl', 'ngl/dist/ngl.esm.js', 'ngl/dist/ngl.js']) {
  try { mod = await import(t); break; } catch (e) { /* next */ }
}
const NGL = (mod && mod.Selection) ? mod : (mod && mod.default ? mod.default : mod);
const out = [];
out.push(`module=${mod ? 'ok' : 'NONE'}`);

const PDB = [
  'ATOM      1  N   ALA A   1       1.000   2.000   3.000  1.00  0.00           N',
  'ATOM      2  H   ALA A   1       1.500   2.000   3.000  1.00  0.00           H',
  'ATOM      3  CA  ALA A   1       2.000   2.000   3.000  1.00  0.00           C',
  'END',
].join('\n');

try {
  const parser = new NGL.PdbParser(new NGL.Streamer('probe.pdb'));
  const structure = await parser.parse(PDB);
  out.push(`atoms=${structure.atomCount}`);
  const ap = structure.getAtomProxy(0);
  out.push(`atom0 ${ap.atomname}/${ap.element} x=${ap.x} y=${ap.y} z=${ap.z}`);
  out.push(`has position getter: ${typeof ap.position} · position=${ap.position ? `${ap.position.x},${ap.position.y},${ap.position.z}` : '-'}`);
  const writer = new NGL.PdbWriter(structure);
  const before = writer.getData();
  out.push('--- writer output (first 3 lines) ---');
  before.split('\n').slice(0, 3).forEach((l) => out.push(l));
  // Can we write an atom's coordinates?
  let setterOk = 'no';
  try { ap.x = 9.5; setterOk = String(ap.x); } catch (e) { setterOk = `threw:${e.message}`; }
  out.push(`set ap.x=9.5 → read back ${setterOk}`);
  const after = new NGL.PdbWriter(structure).getData();
  out.push(`writer after set: ${after.split('\n')[0]}`);
  // eachAtom + element test: what a hydrogen filter could walk
  let hCount = 0;
  let total = 0;
  structure.eachAtom((a) => { total += 1; if (String(a.element).toUpperCase() === 'H') hCount += 1; });
  out.push(`eachAtom total=${total} H=${hCount}`);
} catch (e) {
  out.push(`probe failed: ${e && e.message}`);
}
writeFileSync('_g_pdbw.txt', out.join('\n') + '\n', 'utf8');
console.log(`pdb probe written (${out.length} lines)`);
