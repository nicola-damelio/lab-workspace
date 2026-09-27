// TEMPORARY: print the summary + plate/frame lines of _wipcheck.txt
import fs from 'node:fs'
const L = fs.readFileSync('_wipcheck.txt', 'utf8').split('\n')
const out = []
L.forEach((l, i) => {
  if (/cp850 TextDecoder|0xC3 ->|0xA9 ->|^=== |differing lines/.test(l)) out.push((i + 1) + ': ' + l)
})
// the plate/frame listings themselves, but only the header + first 60 lines each
let inBlock = false, shown = 0
L.forEach((l, i) => {
  if (/^=== .*(plate\/frame)/.test(l)) { inBlock = true; shown = 0; out.push(''); out.push((i + 1) + ': ' + l); return }
  if (inBlock) {
    if (shown++ < 80) out.push((i + 1) + ': ' + l)
    if (shown === 80) out.push('   …')
  }
})
fs.writeFileSync('_wipcheck_view.txt', out.join('\n'), 'utf8')
console.log('lines ' + out.length)
