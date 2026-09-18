/* Lecture seule : que contient CE fichier .meta.json ? (argv[2]) */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const meta = JSON.parse(readFileSync(file, 'utf8'));
const cd = meta.canvasData || {};
const out = [];
out.push(`${'='.repeat(78)}\n${file}`);
out.push(`  label     : ${meta.label}   imageName: ${meta.imageName || ''}   savedAt: ${meta.savedAt || ''}`);
out.push(`  grid      : ${cd.gridCols}x${cd.gridRows}  canvas ${cd.canvasW}x${cd.canvasH}  objects: ${(cd.objects || []).length}`);
out.push(`  arrows: ${(cd.arrows || []).length}  shapes: ${(cd.shapes || []).length}  globalCaption: ${JSON.stringify((cd.globalCaption || '').slice(0, 160))}`);
(cd.objects || []).forEach((o, i) => {
  const src = String(o.imgSrc || '');
  const kind = !src ? 'NONE'
    : src.startsWith('data:image/svg') ? 'svg'
      : src.startsWith('data:image/png') ? 'png'
        : src.startsWith('data:image/jpeg') ? 'jpg' : src.slice(0, 20);
  out.push(`  [${i}] cell(${o.x},${o.y}) ${o.w}x${o.h} letter=${o.letter || '-'} img=${kind} chars=${src.length}`);
  if (o.caption) out.push(`      caption: ${String(o.caption).replace(/\s+/g, ' ').slice(0, 220)}`);
  if (o.texts) out.push(`      texts: ${JSON.stringify(o.texts).slice(0, 200)}`);
  const svgTitle = (decodeURIComponent(src.slice(0, 4000).replace(/\+/g, ' ')).match(/data-figure-origin="([^"]*)"/) || [])[1];
  if (svgTitle) out.push(`      origin: ${svgTitle.slice(0, 160)}`);
  const alt = (src.match(/<text[^>]*>([^<]{3,60})</) || [])[1];
  if (alt && kind === 'svg') out.push(`      first svg text: ${alt}`);
});
out.push(`  canvasData keys: ${Object.keys(cd).join(', ')}`);
out.push(`  other meta keys: ${Object.keys(meta).join(', ')}`);
if (meta.canvasData && meta.canvasData.objects) {
  const letters = meta.canvasData.objects.map((o) => o.letter || '?').join('');
  out.push(`  LETTERS: ${letters}`);
}
console.log(out.join('\n'));
