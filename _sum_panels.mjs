/* Lecture seule : détail des PANNEAUX (images composites / refs de lib / textes). */
import { readFileSync, readdirSync } from 'node:fs';

const dir = process.argv[2] || 'Restored_canvases';
const files = process.argv[3] ? [process.argv[3]] : readdirSync(dir).filter((n) => n.endsWith('.meta.json'));
for (const f of files) {
  const path = process.argv[3] || `${dir}/${f}`;
  const m = JSON.parse(readFileSync(path, 'utf8'));
  const cd = m.canvasData || {};
  console.log(`\n${'='.repeat(70)}\n${f}  ·  label="${m.label}"  image=${m.imageName || ''}  saved=${m.savedAt}`);
  (cd.objects || []).forEach((o, i) => {
    console.log(` [${i}] ${o.letter || '-'} cell(${o.x},${o.y}) ${o.w}x${o.h} libId=${o.libId || '-'} scope=${o.libScope || '-'} proj=${o.libProjectId || '-'}`);
    console.log(`     imgSrc=${String(o.imgSrc || '').length} chars  imgThumb=${String(o.imgThumb || '').length}  imgFit=${o.imgFit || ''}  imgCols=${o.imgCols || ''}  imgPx=${o.imgPxW || ''}x${o.imgPxH || ''}`);
    console.log(`     src=${JSON.stringify(o.src || null).slice(0, 200)}`);
    const imgs = o.images || [];
    console.log(`     images=${imgs.length} ${JSON.stringify(imgs.slice(0, 3).map((x) => ({ k: Object.keys(x).join('|').slice(0, 60), u: String(x.url || x.imgSrc || '').slice(0, 50), l: x.libId || '' })))}`);
    const tx = o.texts || [];
    console.log(`     texts=${tx.length} ${JSON.stringify(tx.slice(0, 12).map((t) => t.text))}`);
    if (o.caption) console.log(`     caption=${String(o.caption).slice(0, 120)}`);
  });
  console.log(` arrows=${(cd.arrows || []).length} shapes=${(cd.shapes || []).length} letterStyle=${JSON.stringify(cd.letterStyle || {})}`);
}
