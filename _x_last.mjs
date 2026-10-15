/* List the LAST user prompts of the most recent Cline task, to recover the
   exact wording of the requests of this session. Throwaway diagnostic. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
const dirs = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, at: fs.statSync(path.join(root, d.name)).mtimeMs }))
  .sort((a, b) => b.at - a.at);

const out = [];
for (const d of dirs.slice(0, 3)) {
  const dir = path.join(root, d.name);
  out.push(`===== TASK ${d.name} (${new Date(d.at).toISOString()}) =====`);
  out.push('files: ' + fs.readdirSync(dir).join(', '));
  for (const f of ['api_conversation_history.json', 'ui_messages.json']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    const msgs = Array.isArray(j) ? j : (j.messages || []);
    const users = [];
    for (const m of msgs) {
      const role = m.role || m.type || '';
      if (!/user|human/i.test(role)) continue;
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map((c) => (typeof c === 'string' ? c : (c.text || c.content || ''))).join('\n');
      else if (typeof m.text === 'string') text = m.text;
      if (!text.trim()) continue;
      users.push(text);
    }
    out.push(`--- ${f}: ${msgs.length} messages, ${users.length} user msgs`);
    users.slice(-8).forEach((t, i) => {
      out.push(`###### USER[-${users.length - i}] ######`);
      out.push(t.slice(0, 6000));
    });
  }
}
fs.writeFileSync('_x_last.txt', out.join('\n'), 'utf8');
console.log('written', out.length, 'lines');
