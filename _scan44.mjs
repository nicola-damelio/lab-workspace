// READ-ONLY probe #44: is the ring-plate (MeshBuffer) rebuild wired to the
// interior-atom FRAME change in the live viewer?
// Writes ASCII-ish output to _live_scan44.txt (never stdout).
import fs from 'node:fs'

const V = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/)
const out = []
const say = (...a) => out.push(a.join(' '))
const at = (i) => String(i + 1).padStart(6) + '| ' + V[i]

// 1. NGL frame / refresh subscriptions in the viewer
say('########## 1. NGL signals subscribed by the viewer ##########')
const sigRe = /signals\.|refreshed|frameChanged|updateRepresentations|needsUpdate|buffer\.update|\.setFrame\b|requestRender\(\)/
V.forEach((l, i) => { if (sigRe.test(l)) say('  ' + at(i)) })

// 2. Who rebuilds the reps (plate sites) and how
say('')
say('########## 2. rebuild entry points ##########')
const rebRe = /bumpSectionEpoch|rebuildSectionsOf|buildMainReps\(|applyCurrentStyleTo\(|buildSectionReps\(|addPlates\(|addRingPlates\(|sectionEpoch/
V.forEach((l, i) => { if (rebRe.test(l)) say('  ' + at(i)) })

// 3. every useEffect dep array that mentions a frame
say('')
say('########## 3. dep arrays mentioning frame / currentFrame ##########')
V.forEach((l, i) => { if (/^\s*\}[,)]?\s*,?\s*\[/.test(l) && /frame/i.test(l)) say('  ' + at(i)) })

// 4. the effects that call buildMainReps / rebuildSectionsOf: show their deps
say('')
say('########## 4. effects that rebuild (context + dep array) ##########')
const marks = []
V.forEach((l, i) => { if (/buildMainReps\(\)|rebuildSectionsOf\(|bumpSectionEpoch\(\)/.test(l)) marks.push(i) })
for (const m of marks) {
  say('')
  say('--- call @' + (m + 1) + ' ---')
  for (let i = Math.max(0, m - 12); i <= Math.min(V.length - 1, m + 12); i++) say('  ' + at(i))
}

// 5. currentFrame in scope near the plate builder (does the builder read it?)
say('')
say('########## 5. currentFrame / frame lines inside 9300-9800 (plate builders) ##########')
for (let i = 9295; i < 9800 && i < V.length; i++) if (/frame|Frame/.test(V[i])) say('  ' + at(i))

// 6. how the plate MeshBuffer is created & whether it is recreated anywhere else
say('')
say('########## 6. MeshBuffer sites ##########')
V.forEach((l, i) => { if (/MeshBuffer/.test(l)) say('  ' + at(i)) })

// 7. sentence-level search for an explicit frame refresh of the plates
say('')
say('########## 7. does any comment claim a plate/frame refresh? ##########')
V.forEach((l, i) => { if (/plate|Plate/i.test(l) && /frame|Frame/i.test(l)) say('  ' + at(i)) })

fs.writeFileSync('_live_scan44.txt', out.join('\n'), 'utf8')
console.log('wrote _live_scan44.txt (' + out.length + ' lines)')
