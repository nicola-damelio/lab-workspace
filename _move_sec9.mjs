// TEMPORARY probe: move the section-9 block after the last assertion of section 8.
import { readFileSync, writeFileSync } from 'node:fs'
const p = '_viewer_rings_gradient_test.mjs'
const a = readFileSync(p, 'utf8').split('\n')
const start = a.findIndex((l) => l.includes('9. LES PLAQUES SUIVENT LES IMAGES'))
const end = a.findIndex((l) => l.includes('__sec, undefined'))
const bilan = a.findIndex((l) => l.includes('Bilan'))
if (start < 0 || end < 0 || bilan < 0) throw new Error(`markers: ${start} ${end} ${bilan}`)
if (!(start < end && end < bilan)) throw new Error(`order: ${start} ${end} ${bilan}`)
const block = a.slice(start, end + 1)
const out = a.slice(0, start).concat(a.slice(end + 1, bilan), block, [''], a.slice(bilan))
writeFileSync(p, out.join('\n'), 'utf8')
writeFileSync('_t_moved.txt', `start=${start + 1} end=${end + 1} bilan=${bilan + 1} blockLines=${block.length}\n` + out.slice(bilan, bilan + 4).join('\n'), 'utf8')
console.log('done')

