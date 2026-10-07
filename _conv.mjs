import { readFileSync, writeFileSync } from 'node:fs';
const s = readFileSync('_diag_helix_after.txt', 'utf8');
writeFileSync('_diag_after2.txt', s, 'utf8');
console.log('chars', s.length);
