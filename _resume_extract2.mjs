/* Extrait les derniers messages UTILISATEUR + les appels d'outils de la session
   Cline interrompue, pour reprendre le fil au bon endroit.
   Usage: node _resume_extract2.mjs <fichier.messages.json> [nbMessages] */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const n = Number(process.argv[3] || 40);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : data.messages;
const out = [];
out.push(`${list.length} messages`);

const textOf = (m) => {
  const c = m.content;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') {
    if (typeof c.text === 'string') return c.text;
    if (typeof c.value === 'string') return c.value;
    if (Array.isArray(c.content)) {
      return c.content.map((p) => (typeof p === 'string' ? p : (p.text || p.value || ''))).join('\n');
    }
    return JSON.stringify(c);
  }
  return '';
};

const slice = list.slice(-n);
slice.forEach((m, i) => {
  const idx = list.length - slice.length + i;
  if (m.role === 'user') {
    out.push(`\n##### USER #${idx} (ts ${m.ts || ''}) #####\n${textOf(m).slice(0, 2500)}`);
  } else {
    const blocks = Array.isArray(m.content && m.content.content) ? m.content.content : [];
    const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name + '(' + JSON.stringify(b.input).slice(0, 160) + ')');
    const thinks = blocks.filter((b) => b.type === 'thinking').map((b) => String(b.thinking).slice(0, 500));
    out.push(`\n--- ASSISTANT #${idx} ---${thinks.length ? '\n[thinking] ' + thinks.join('\n') : ''}${tools.length ? '\n[tools] ' + tools.join('\n[tools] ') : ''}`);
  }
});
writeFileSync('_resume_tail2.txt', out.join('\n'), 'utf8');
console.log('wrote _resume_tail2.txt');
