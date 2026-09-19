/* =========================================================================
   _recover_canvas_files.mjs — sonde LECTURE SEULE : quel fichier `.meta.json`
   porte VRAIMENT une composition de canvas ?

   Un `.meta.json` est écrit à côté de chaque image (voir buildFigureMeta) :
     • un CANVAS y met sa composition (`canvasData` → panneaux, lettres, légendes) ;
     • une CAPTURE y met seulement son origine (`src` : test, instance, graphe) —
       ses pixels sont un graphe aplati, il n'y a AUCUNE composition à rouvrir.
   Seul le premier se réimporte par « 📥 Restore a canvas file » ; le second est
   refusé (à raison). Cette sonde dit, fichier par fichier, lequel est lequel —
   pour ne pas chercher une composition dans un fichier qui n'en a jamais eu.

   Usage (aucun argument : les emplacements habituels) :
     node _recover_canvas_files.mjs
     node _recover_canvas_files.mjs "C:/chemin/vers/Canvas.jpg.meta.json" …
   ========================================================================= */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window / canvas minimaux (comme les autres sondes) ────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '' }
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };
globalThis.Image = class Image {
  constructor() { this.width = 40; this.height = 30; this.naturalWidth = 40; this.naturalHeight = 30; }
  set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
  get src() { return this._src; }
};
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {}, fillRect() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255) })
    }),
    toDataURL: () => 'data:image/jpeg;base64,dGh1bWI='
  })
};

const LIB = await import('./src/utils/figuresLibrary.js');

const DOWNLOADS = join(process.env.USERPROFILE || '.', 'Downloads');
const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
    ...(existsSync('Restored_canvases')
      ? readdirSync('Restored_canvases').filter((n) => n.endsWith('.meta.json')).map((n) => join('Restored_canvases', n))
      : []),
    ...(existsSync(DOWNLOADS)
      ? readdirSync(DOWNLOADS).filter((n) => n.endsWith('.meta.json')).map((n) => join(DOWNLOADS, n))
      : [])
  ];

const pixelsOf = (s) => {
  const v = String(s || '');
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(v);
  if (m) return `${m[1]} ${v.length} chars`;
  if (/^https?:/i.test(v)) return `link ${v.slice(0, 40)}…`;
  return v ? `${v.length} chars` : '—';
};

let withComposition = 0;
let captures = 0;
for (const file of candidates) {
  if (!existsSync(file)) { console.log(`\n== ${file}\n   (absent)`); continue; }
  let meta = null;
  try { meta = LIB.parseFigureMeta(readFileSync(file, 'utf8')); } catch { meta = null; }
  const cd = LIB.canvasDataOfFigureMeta(meta);
  console.log(`\n${'='.repeat(78)}\n${file}`);
  if (!meta) { console.log('   ILLISIBLE (ce n’est pas un JSON de sidecar)'); continue; }
  console.log(`   label="${meta.label}" savedAt=${meta.savedAt} image=${meta.imageName || '—'}`);
  if (!cd) {
    captures += 1;
    console.log(`   ✖ AUCUNE COMPOSITION — sidecar de CAPTURE (src.elementLabel="${(meta.src && meta.src.elementLabel) || '—'}", elementKey="${(meta.src && meta.src.elementKey) || '—'}")`);
    console.log('     → rien à rouvrir dans l’Image Builder : c’est un graphe aplati, pas une toile.');
    continue;
  }
  withComposition += 1;
  const objs = cd.objects || [];
  console.log(`   ✔ COMPOSITION : canvas ${cd.canvasW}×${cd.canvasH}, grille ${cd.gridCols}×${cd.gridRows}, canvasKey=${cd.canvasKey || '(aucune)'}`);
  console.log(`     ${objs.length} panneau(x), ${(cd.arrows || []).length} flèche(s), ${(cd.shapes || []).length} forme(s)`);
  objs.forEach((o, i) => {
    const ims = Array.isArray(o.images) ? o.images.length : 0;
    console.log(`     [${i}] ${o.letter || '?'} cell(${o.x},${o.y}) ${o.w}×${o.h} images=${ims} img=${pixelsOf(o.imgSrc)}`
      + `${o.caption ? ` caption="${String(o.caption).slice(0, 60)}"` : ''}`
      + `${o.texts && o.texts.length ? ` texts=${o.texts.length}` : ''}`);
  });
  const res = await LIB.restoreCanvasFromFigureMeta({
    text: readFileSync(file, 'utf8'),
    fileName: file.split(/[\\/]/).pop(),
    scope: 'project',
    projectId: 'probe_project'
  });
  console.log(`   → « 📥 Restore a canvas file » : ${res.ok ? 'ACCEPTÉ' : 'REFUSÉ'}`
    + `${res.ok ? ` (${res.created ? 'nouvelle entrée' : 'mise à jour'}, allégé=${res.lightened}, ${Math.round(res.bytes / 1024)} Ko dans le magasin, persisté=${res.persisted})` : ` — ${res.error}`}`);
}
console.log(`\n${'='.repeat(78)}\n${candidates.length} fichier(s) : ${withComposition} avec composition, ${captures} sans.`);
