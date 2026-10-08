/* Vérifie qu'aucun mot d'interface n'est resté COLLÉ faute d'espace (le défaut
   « inventoryunavailable »). Fichier TEMPORAIRE. */
import { readFileSync } from 'node:fs';

const files = [
  'src/utils/workspaceResync.js',
  'src/components/WorkspaceResyncPanel.jsx',
  'src/components/AppModules/settingsModule.jsx',
  'src/App.jsx',
  '_workspace_resync_ui_test.mjs'
];

const glued = [];
const words = [];
for (const f of files) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    /* Un mot anglais collé à l'autre : minuscule suivie d'une majuscule, ou deux
       mots que l'anglais ne colle pas. On ne juge que les lignes qui parlent de
       l'inventaire indisponible. */
    if (/inventory/i.test(line)) {
      words.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      if (/inventoryunavailable|Inventoryunavailable|inventoryUnavailable/i.test(line)) glued.push(`${f}:${i + 1}`);
    }
  });
}

console.log(`lignes citant « inventory » : ${words.length}`);
console.log(words.filter((l) => /unavailable/i.test(l)).join('\n'));
console.log(`\nmots collés ($ {'inventoryunavailable'} ou variantes) : ${glued.length ? glued.join(', ') : 'AUCUN'}`);
