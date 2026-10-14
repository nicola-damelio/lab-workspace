/* Extrait la FIN de la session Cline qui a « crashed » pour reprendre le fil.
   Usage: node _resume_extract.mjs <fichier.messages.json> [nbMessages] */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const n = Number(process.argv[3] || 8);
const raw = readFileSync(file, 'utf8');
let data;
try { data = JSON.parse(raw); } catch (err) { console.log('PARSE FAIL', err.message); process.exit(1); }

const list = Array.isArray(data) ? data : (Array.isArray(data.messages) ? data.messages : null);
const out = [];
out.push(`top-level: ${Array.isArray(data) ? 'array' : typeof data} — ${list ? list.length + ' messages' : 'keys: ' + Object.keys(data).join(',')}`);
if (list) {
  out.push(`first element keys: ${Object.keys(list[0] || {}).join(', ')}`);
  const slice = list.slice(-n);
  slice.forEach((m, i) => {
    const idx = list.length - slice.length + i;
    const role = m.role || m.type || (m.message && m.message.role) || '?';
    let text = '';
    const c = m.content ?? m.text ?? (m.message && m.message.content);
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      text = c.map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content || JSON.stringify(p).slice(0, 300))))).join('\n');
    } else if (c && typeof c === 'object') text = JSON.stringify(c).slice(0, 2000);
    if (Array.isArray(m.contentBlocks)) {
      text += '\n[blocks] ' + m.contentBlocks.map((b) => b.type || b.role || '?').join(',');
    }
    if (m.tool_calls || m.toolCalls) text += '\n[tool_calls] ' + JSON.stringify(m.tool_calls || m.toolCalls).slice(0, 800);
    out.push(`\n===== #${idx} role=${role} (${typeof text === 'string' ? text.length : 0} chars) =====\n${String(text).slice(0, 4000)}`);
  });
}
writeFileSync('_resume_tail.txt', out.join('\n'), 'utf8');
console.log('wrote _resume_tail.txt');
