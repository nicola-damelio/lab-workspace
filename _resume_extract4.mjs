/* Journal compact d'une PLAGE de messages d'une session Cline interrompue.
   Usage: node _resume_extract4.mjs <fichier.messages.json> <fromIndex> [toIndex] */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const from = Number(process.argv[3] || 0);
const to = Number(process.argv[4] || 1e9);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : data.messages;

const out = [];
for (let i = from; i < Math.min(to, list.length); i += 1) {
  const m = list[i];
  if (m.role !== 'assistant') continue;
  const parts = Array.isArray(m.content) ? m.content : (m.content && m.content.content) || [];
  const lines = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'thinking') lines.push('[think] ' + String(p.thinking || '').replace(/\s+/g, ' ').slice(0, 700));
    if (p.type === 'text') lines.push('[say] ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 400));
    if (p.type === 'tool_use') {
      const inp = p.input || {};
      const keys = Object.keys(inp).join(',');
      const fp = inp.path || inp.file_path || '';
      const cmds = Array.isArray(inp.commands) ? inp.commands.join(' ; ').slice(0, 200) : '';
      const oldT = typeof inp.old_text === 'string' ? inp.old_text.replace(/\s+/g, ' ').slice(0, 120) : '';
      const newT = typeof inp.new_text === 'string' ? inp.new_text.replace(/\s+/g, ' ').slice(0, 120) : '';
      lines.push(`[tool ${p.name}] ${fp} {${keys}} ${cmds}${oldT ? ' OLD:' + oldT : ''}${newT ? ' NEW:' + newT : ''}`);
    }
  }
  if (lines.length) out.push(`#${i} ${lines.join('\n    ')}`);
}
writeFileSync('_resume_range.txt', out.join('\n'), 'utf8');
console.log('wrote _resume_range.txt lines=' + out.length);
