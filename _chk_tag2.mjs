/* SONDE — le tag de fermeture injecté est-il un VRAI `</script>` ? */
import { readFileSync } from 'node:fs';
const SEQ_BARRE = '<' + '\\' + '/script>';
const SEQ_VRAI = '<' + '/script>';
for (const f of ['_chk_app_out.html', 'dist/index.html', '_ui_bg_live_test.cjs', '_chk_live_err.cjs']) {
  let s = '';
  try { s = readFileSync(f, 'utf8'); } catch { console.log(`${f} — absent`); continue; }
  console.log(`${f}  vrai=${s.includes(SEQ_VRAI)}  barre=${s.includes(SEQ_BARRE)}  octets=${s.length}`);
  const idx = s.indexOf('probe.js');
  if (idx >= 0) console.log('   contexte: ' + JSON.stringify(s.slice(idx - 30, idx + 60)));
}
