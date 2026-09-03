const fs = require('fs');
const mapFile = 'node_modules/ngl/dist/ngl.js.map';
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const wanted = [
  'src/color/electrostatic-colormaker.ts',
  'src/color/partialcharge-colormaker.ts',
  'src/color/colormaker.ts',
  'src/surface/surface.ts',
  'src/surface/surface-utils.ts',
  'src/surface/molecular-surface.ts',
  'src/surface/marching-cubes.ts',
  'src/surface/volume.ts',
  'src/representation/molecularsurface-representation.ts',
  'src/representation/surface-representation.ts',
  'src/component/volume-component.ts',
  'src/component/surface-component.ts',
  'src/store/atom-store.ts',
];
for (let i = 0; i < map.sources.length; i++) {
  const n = map.sources[i];
  const base = n.replace(/.*\//, '');
  if (wanted.some((w) => n.indexOf(w) >= 0)) {
    const src = (map.sourcesContent || [])[i];
    fs.mkdirSync('_ngl_src', { recursive: true });
    fs.writeFileSync('_ngl_src/' + base, src || '');
    console.log('WROTE', '_ngl_src/' + base, 'len', (src || '').length);
  }
}


