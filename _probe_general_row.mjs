/* Sonde temporaire : rejoue « General → ribbon » / « General → hide » sur le VRAI
   buildSectionReps et imprime les représentations qui partent à NGL. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const testPath = fileURLToPath(new URL('./_viewer_general_row_test.mjs', import.meta.url));
const src = readFileSync(testPath, 'utf8').replace(/\r\n/g, '\n');
const cut = src.indexOf('// 2a.');
const head = src.slice(0, cut);

const PROBE = `
const gen2 = (t, kind, sub) => t[kind][sub] || {};
const dump = (label, t) => {
  console.log('=== ' + label);
  scene(t).forEach((r) => console.log('    ', r.type.padEnd(10), String(r.params.sele)));
};
dump('S1 — défaut (General cartoon, backbone follow, sidechain follow)',
  tree(['cartoon', 'sstruc'], ['cartoon', 'sstruc', true], ['licorice', 'element', true]));

const ribbon = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
console.log('--- état après « General → ribbon » :',
  'general=' + gen2(ribbon, 'protein', 'general').style + '/' + gen2(ribbon, 'protein', 'general').follow,
  'backbone=' + gen2(ribbon, 'protein', 'backbone').style + '/' + gen2(ribbon, 'protein', 'backbone').follow,
  'sidechain=' + gen2(ribbon, 'protein', 'sidechain').style + '/' + gen2(ribbon, 'protein', 'sidechain').follow);
dump('S2 — General → ribbon',
  tree([gen2(ribbon, 'protein', 'general').style, 'sstruc', false],
       [gen2(ribbon, 'protein', 'backbone').style, 'sstruc', gen2(ribbon, 'protein', 'backbone').follow],
       [gen2(ribbon, 'protein', 'sidechain').style, 'element', gen2(ribbon, 'protein', 'sidechain').follow]));

const hid = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
console.log('--- état après « General → hide » :',
  'general=' + gen2(hid, 'protein', 'general').style,
  'backbone=' + gen2(hid, 'protein', 'backbone').style + '/' + gen2(hid, 'protein', 'backbone').follow,
  'sidechain=' + gen2(hid, 'protein', 'sidechain').style + '/' + gen2(hid, 'protein', 'sidechain').follow);
dump('S3 — General → hide',
  tree([gen2(hid, 'protein', 'general').style, 'sstruc', false],
       [gen2(hid, 'protein', 'backbone').style, 'sstruc', gen2(hid, 'protein', 'backbone').follow],
       [gen2(hid, 'protein', 'sidechain').style, 'element', gen2(hid, 'protein', 'sidechain').follow]));

dump('S4 — General → ribbon, puis « Backbone → tube » à la main',
  tree(['ribbon', 'sstruc', false], ['tube', 'sstruc', false], ['hide', 'element', false]));
`;

const out = fileURLToPath(new URL('./_probe_generated.mjs', import.meta.url));
writeFileSync(out, head + PROBE, 'utf8');
execFileSync(process.execPath, [out], { stdio: 'inherit' });
