/* Lecture seule : que CONTIENT chaque canvas restauré ? (lettres, légendes,
   provenance des panneaux) — pour reconnaître la composition de l'utilisateur. */
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'Restored_canvases';
const out = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.meta.json'))) {
  const meta = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const cd = meta.canvasData || {};
  out.push(`\n${'='.repeat(78)}\n${f}\n  label     : ${meta.label}`);
  out.push(`  savedAt   : ${meta.savedAt || meta.at || ''}   addedAt: ${meta.addedAt || ''}`);
  out.push(`  grid      : ${cd.gridCols}x${cd.gridRows}  canvas ${cd.canvasW}x${cd.canvasH}  objects: ${(cd.objects || []).length}`);
  out.push(`  globalCaption: ${JSON.stringify((cd.globalCaption || '').slice(0, 120))}`);
  (cd.objects || []).forEach((o, i) => {
    const src = String(o.imgSrc || '');
    const kind = !src ? 'text/none'
      : src.startsWith('data:image/svg') ? 'svg'
        : src.startsWith('data:image/png') ? 'png'
          : src.startsWith('data:image/jpeg') ? 'jpg' : src.slice(0, 24);
    const origin = (src.match(/data-figure-origin%3D%22([^%]*(?:%[^0-9A-F]|.){0,140})/) || [])[1] || '';
    const decodedOrigin = origin ? decodeURIComponent(origin.replace(/%22$/, '')).slice(0, 150) : '';
    out.push(`   [${i}] cell(${o.x},${o.y}) ${o.w}x${o.h}  letter=${o.letter || '-'}  img=${kind} len=${src.length}`);
    if (decodedOrigin) out.push(`        origin: ${decodedOrigin}`);
    if (o.caption) out.push(`        caption: ${String(o.caption).replace(/\s+/g, ' ').slice(0, 200)}`);
    if (o.shape) out.push(`        shape: ${JSON.stringify(o.shape).slice(0, 120)}`);
    if (o.text) out.push(`        text: ${String(o.text).replace(/\s+/g, ' ').slice(0, 160)}`);
  });
  const others = Object.keys(cd).filter((k) => !['objects'].includes(k));
  out.push(`  canvasData keys: ${others.join(', ')}`);
  out.push(`  meta keys: ${Object.keys(meta).join(', ')}`);
}
console.log(out.join('\n'));
