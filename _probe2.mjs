// Sonde 2 : comment NGL reconnaît l'EAU, et comment Stage.loadFile traite un Blob.
import { readFileSync } from 'node:fs';
const s = readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const show = (tag, from, len) => {
  if (from < 0) { console.log(`--- ${tag}: NOT FOUND`); return; }
  console.log(`--- ${tag} @${from}\n${s.slice(from, from + len)}\n`);
};
show('HOH', s.indexOf('HOH'), 400);
show('WAT', s.indexOf('WAT'), 300);
show('water sele', s.indexOf('water:'), 300);
show('loadFile def', s.indexOf('loadFile('), 1400);
show('ext from name', s.indexOf('getExtension'), 400);
