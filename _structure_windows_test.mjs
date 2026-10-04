/* =========================================================================
   _structure_windows_test.mjs — LA MÊME ORGANISATION QUE LA PAGE NMR SUR LES
   PAGES MD ET DOCKING : la formule 2D dans « Sequence and structure », le
   viewer 3D dans SA sous-section repliable.

   Demandé mot pour mot : « You did not apply the same structure of the NMR page
   to the other pages of the viewer (MD and docking). use the same separation and
   organization of 2D formula and 3D viewer. and the same compressible windows
   that you used in NMR page. »

   La page NMR l'avait déjà (voir _nmr_nuclei_table_test.mjs). Ce qui doit
   maintenant être vrai de MD ET de Docking :

     • le sélecteur 2D ⇄ 3D a DISPARU : aucune page n'écrit plus un
       `structureMode` depuis un bouton, et plus aucun volet n'est masqué par un
       `display: none` / `aria-hidden` piloté par ce mode ;
     • la FORMULE 2D vit DANS la sous-section « Sequence and structure » — celle
       qui porte la peinture 🖌️ et sa bande de séquence —, qui est OUVERTE par
       défaut (c'est là que la formule se voit), et elle est écrite UNE SEULE fois
       (`formulaBlock`) : une carte par cas de figure, jamais deux à l'écran ;
     • le VIEWER 3D a SA PROPRE sous-section repliable (« 🧬 3D viewer ») :
       `defaultOpen={false}`, `openWhen` (une condition restée en mode 3D la
       rouvre toute seule : rien n'est perdu), `keepMounted` (replier ne le
       DÉMONTE pas : le dépliage ne relit pas la structure) et `onToggle` (la page
       est prévenue du repli / dépliage pour recaler le viewer sur la largeur) ;
     • plus de montage conditionnel du viewer : c'est la carte `keepMounted` qui
       le crée à sa première ouverture (`everOpened` dans ui.jsx) ;
     • les deux cartes sont DANS le même empilement (`flex flex-col`) : aucun
       grand blanc ne les sépare ;
     • sur MD, le 🔍 Focus et le ✖ Deselect sont passés dans l'en-tête de la
       carte 3D (« sans occuper une rangée »), et les commandes de fichiers du
       dossier de l'expérience (📂 Topologie / 📂 Trajectoire) vivent DANS la
       carte du viewer ;
     • ET DEPUIS CETTE SESSION : le 💡 « Click an atom in the formula (or in the
       3D viewer below) … » de la page MD a été RETIRÉ (la rangée formule + 📓
       coûtait deux lignes), et les DEUX 📂 du dossier de l'expérience ne font
       plus une rangée À EUX au-dessus du viewer : ils sont passés au viewer
       (prop `fileRowExtra`) pour tenir SUR LA LIGNE de 📂 PDB file(s) et
       📂 Trajectory (§1 General) ;
     • sur Docking, le champ « Receptor topology (PDB ID / URL) » — qui
       n'apparaissait qu'en mode 3D — vit lui aussi dans la carte du viewer, et le
       rappel « No structure to display yet » de l'ancien volet 2D reste dit ;
     • la peinture 🖌️, ses bandes et le résolveur de numéros n'ont pas bougé.

   Les pages sont du JSX : leurs sites de rendu sont vérifiés sur le TEXTE,
   comme _nmr_nuclei_table_test.mjs et _residue_numbering_panels_test.mjs ;
   l'état replié/déplié lui-même est celui de ui.jsx, vérifié ici aussi.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MD = read('src/components/MDSections.jsx');
const DOCK = read('src/components/DockingSections.jsx');
const SEC = read('src/components/NMRSections.jsx');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');
const UI = read('src/components/ui.jsx');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};
const count = (src, needle) => src.split(needle).length - 1;
const at = (src, needle, what) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `${what}\n  introuvable : ${needle}`);
  passed += 1;
  return i;
};
/** La tranche d'une carte : de son ouverture à son `</CollapsibleSection>`. */
const cardOf = (src, start) => src.slice(start, src.indexOf('</CollapsibleSection>', start));

/* ════════════ 1. LE SÉLECTEUR 2D ⇄ 3D A DISPARU (MD ET DOCKING) ════════════ */
gone(MD, "updateActiveTest({ structureMode: '2d' })", '[MD] aucun bouton n’écrit plus le mode 2D');
gone(MD, "updateActiveTest({ structureMode: '3d' })", '[MD] …ni le mode 3D');
gone(MD, '>2D Formula</button>', '[MD] le bouton « 2D Formula » a disparu');
gone(MD, '>3D Viewer + Trajectory</button>', '[MD] …et le bouton « 3D Viewer + Trajectory » aussi');
gone(MD, 'display: structureMode', '[MD] plus aucun volet masqué par le mode 2D ⇄ 3D');
gone(MD, 'aria-hidden={structureMode', '[MD] …ni caché aux lecteurs d’écran par ce mode');
gone(MD, 'hasOpened3D', '[MD] plus de montage piloté par ce mode (la carte s’en charge)');

gone(DOCK, "updateActiveTest({ structureMode: '2d' })", '[Docking] aucun bouton n’écrit plus le mode 2D');
gone(DOCK, "updateActiveTest({ structureMode: '3d' })", '[Docking] …ni le mode 3D');
gone(DOCK, '>2D Formula</button>', '[Docking] le bouton « 2D Formula » a disparu');
gone(DOCK, '>3D Viewer</button>', '[Docking] …et le bouton « 3D Viewer » aussi');
gone(DOCK, 'display: structureMode', '[Docking] plus aucun volet masqué par le mode 2D ⇄ 3D');
gone(DOCK, 'hasOpened3D', '[Docking] plus de montage piloté par ce mode (la carte s’en charge)');

/* ════════════ 2. LA FORMULE 2D EST DANS « SEQUENCE AND STRUCTURE » ══════════ */
/* MD : la formule est écrite UNE fois et rendue par les DEUX cartes qui portent
   ce titre (protéine / petite molécule d’un côté, acide nucléique de l’autre) —
   EXACTEMENT UNE se rend selon le type de molécule. */
has(MD, 'const formulaBlock = (', '[MD] la formule 2D a UNE définition (aucune copie à faire diverger)');
const mdFormula = at(MD, 'const formulaBlock = (', '[MD] sa définition commence ici');
const mdFormulaEnd = MD.indexOf('\n  );', mdFormula);
ok(mdFormulaEnd > mdFormula, '[MD] …et se termine par un bloc JSX complet');
const mdFormulaBody = MD.slice(mdFormula, mdFormulaEnd);
has(mdFormulaBody, '<OrganicViewer smiles={activeTest.smiles || activeTest.ligandSmiles}',
  '[MD] un SMILES est dessiné par OrganicViewer (comme l’ancien volet « 2D Formula »)');
has(mdFormulaBody, '<StructureSVGView', '[MD] une séquence / un sucre / un lipide par StructureSVGView');
has(mdFormulaBody, '📓 Formula → Notebook', '[MD] …et le 📓 de la formule, qui agit sur elle');
/* ⚠ LE 💡 « Click an atom in the formula (or in the 3D viewer below) to highlight
   its cell in the atom table. » A ÉTÉ RETIRÉ (demande de cette session, mot pour
   mot : « in the viewer remove the sentence “Click an atom in the 3D viewer to
   highlight its cell in the atom table.” so that we save a line ») : trop longue
   pour tenir à côté du 📓, elle faisait coûter DEUX lignes à la rangée. Rien
   d'autre ne bouge : piquer un atome (formule 2D ou vue 3D) souligne toujours sa
   cellule de tableau. */
gone(MD, '<p className="text-xs text-slate-400">💡 Click an atom in the formula',
  '[MD] le 💡 de la formule a été RETIRÉ (une ligne de gagnée)');
has(mdFormulaBody, 'flex justify-end', '[MD] …le 📓 reste seul dans sa rangée, à droite comme avant');

eq(count(MD, 'title="Sequence and structure"'), 2,
  '[MD] deux cartes « Sequence and structure » (protéine / acide nucléique)');
eq(count(MD, '<CollapsibleSection title="Sequence and structure" icon="🖌️" defaultOpen>'), 2,
  '[MD] …toutes deux OUVERTES par défaut : c’est là que la formule se voit');
eq(count(MD, '{formulaBlock}'), 2, '[MD] chacune affiche la formule (protéine comme acide nucléique)');
const mdSSFirst = MD.indexOf('<CollapsibleSection title="Sequence and structure"');
const mdSSSecond = MD.indexOf('<CollapsibleSection title="Sequence and structure"', mdSSFirst + 1);
has(cardOf(MD, mdSSFirst), '{formulaBlock}', '[MD] la formule est DANS la 1re carte, pas dans un volet à part');
has(cardOf(MD, mdSSSecond), '{formulaBlock}', '[MD] …et DANS la 2de, de la même façon');
eq(count(MD, '<SequencePaintStrip'), 2, '[MD] les deux bandes peintes sont toujours là, en UN exemplaire chacune');
ok(cardOf(MD, mdSSFirst).indexOf('<SequencePaintStrip') > 0
  && cardOf(MD, mdSSSecond).indexOf('<SequencePaintStrip') > 0,
  '[MD] …chacune dans SA carte, avec la formule');
has(MD, '{!isNucleic && (show2DFormula || showProteinStrip) && (',
  '[MD] la carte « non-acide-nucléique » se rend avec la formule OU la peinture');
has(MD, '{isNucleic && (show2DFormula || showNucleicStrip) && (',
  '[MD] …et celle des acides nucléiques de la même façon');
has(MD, 'const show2DFormula = d.moleculeType', '[MD] la formule a SA condition (SMILES ou structure)');
has(MD, 'const showProteinStrip = d.moleculeType', '[MD] la peinture 🖌️ a la sienne');
has(MD, 'const showNucleicStrip = isNucleic', '[MD] …et celle des formes A/B/Z aussi');

/* Docking : une seule carte, elle porte la formule ET la peinture de la
   protéine, et elle dit le rappel de l’ancien volet quand rien n’est dessinable. */
has(DOCK, 'const formulaBlock = (', '[Docking] la formule 2D a UNE définition');
const dkFormula = at(DOCK, 'const formulaBlock = (', '[Docking] sa définition commence ici');
const dkFormulaBody = DOCK.slice(dkFormula, DOCK.indexOf('\n  );', dkFormula));
has(dkFormulaBody, '<StructureSVGView', '[Docking] la formule 2D y est dessinée');
has(dkFormulaBody, 'No structure to display yet',
  '[Docking] …et le rappel de l’ancien volet 2D reste dit (aucun repère ne disparaît)');
has(dkFormulaBody, 'Enter the receptor sequence above',
  '[Docking] …en renvoyant à la case de séquence, qui est AU-DESSUS (« below » ne l’était plus)');
eq(count(DOCK, 'title="Sequence and structure"'), 1, '[Docking] UNE carte « Sequence and structure »');
has(DOCK, '<CollapsibleSection title="Sequence and structure" icon="🖌️" defaultOpen>',
  '[Docking] …OUVERTE par défaut (c’est là que la formule se voit)');
const dkSS = DOCK.indexOf('<CollapsibleSection title="Sequence and structure"');
has(cardOf(DOCK, dkSS), '{formulaBlock}', '[Docking] la formule est DANS la carte, avec la peinture');
has(cardOf(DOCK, dkSS), '<SequencePaintStrip', '[Docking] …dont la bande peinte n’a pas bougé');
eq(count(DOCK, '<SequencePaintStrip'), 1, '[Docking] une seule bande, comme avant');
has(DOCK, 'const showFormulaBlock = show2DFormula || d.isPolymer;',
  '[Docking] la carte se rend même sans formule (un récepteur encore vide garde son repère)');

/* ════════════ 3. LE VIEWER 3D, SA CARTE REPLIABLE, ZÉRO BLANC AVANT ════════ */
const mdFlex = at(MD, '<div className="flex flex-col">', '[MD] les deux cartes sont dans UN empilement');
const mdSS1 = at(MD, '<CollapsibleSection title="Sequence and structure"', '[MD] la carte de la formule');
const md3D = at(MD, 'title="3D viewer"', '[MD] le viewer 3D a SA sous-section repliable');
ok(mdFlex < mdSS1 && mdSS1 < md3D, '[MD] …après « Sequence and structure », sans blanc entre les deux');
const md3Dcard = cardOf(MD, MD.lastIndexOf('<CollapsibleSection', md3D));
has(md3Dcard, 'defaultOpen={false}', '[MD] le viewer reste replié par défaut (comme sur la page NMR)');
has(md3Dcard, "openWhen={structureMode === '3d'}",
  '[MD] une condition restée en mode 3D la rouvre toute seule (rien n’est perdu)');
has(md3Dcard, 'keepMounted', '[MD] replier ne DÉMONTE pas le viewer (il relirait la structure)');
has(md3Dcard, 'onToggle={setViewerOpen}', '[MD] …et la page est prévenue du repli / dépliage');
has(md3Dcard, '🔍 Focus', '[MD] le 🔍 Focus vit dans l’en-tête de la carte 3D');
has(md3Dcard, '✖ Deselect', '[MD] …avec le ✖ Deselect');
has(md3Dcard, 'onClick={() => updateActiveTest({ selectedAtomKeys: [] })}',
  '[MD] …qui déselectionne comme avant');
has(md3Dcard, 'fileRowExtra={folderFilePickers}', '[MD] les deux 📂 du dossier de l’expérience partent AU VIEWER');
has(md3Dcard, '<NMRMoleculeViewer', '[MD] …et le viewer est dans la même carte');
has(MD, 'const [viewerOpen, setViewerOpen] = useState(false);', '[MD] `viewerOpen` ne pilote plus le montage');
has(MD, '}, [viewerOpen]);', '[MD] …il ne sert qu’à recaler le viewer sur la largeur réelle');

/* ════════════ 2ter. LES DEUX 📂 DU DOSSIER SUR LA LIGNE DES FICHIERS ═════════ */
/* Demande, mot pour mot : « the "topology from Drive folder" and "trajectory from
   drive folder" buttons should be in the same line as "PDB file" and "trajectory"
   buttons ». Les deux boutons ne font donc plus une rangée À EUX au-dessus du
   viewer : ils sont définis UNE fois (`folderFilePickers`) et passés au viewer, qui
   les rend DANS sa rangée §1 General — celle de 📂 PDB file(s) et de 📂 Trajectory.
   Rien n'est perdu : la phrase « Choosing a file here opens it AND declares it… »
   est passée dans leurs infobulles. */
has(MD, 'const folderFilePickers = (', '[MD] les deux 📂 du dossier ont UNE définition');
has(MD, 'label="📂 Topology from Drive folder"', '[MD] …la topologie du dossier');
has(MD, 'label="📂 Trajectory from Drive folder"', '[MD] …et la trajectoire du dossier');
has(MD, 'Nothing is uploaded again.', '[MD] …leurs infobulles disent ce que la phrase disait (rien n’est perdu)');
gone(MD, '<div className="flex flex-wrap items-start gap-2 mb-2">',
  '[MD] plus de rangée à eux deux (elle coûtait une ligne au-dessus du viewer)');
has(VIEW, 'fileRowExtra = null,', '[viewer] la rangée §1 General accepte les commandes de la PAGE');
has(VIEW, '{fileRowExtra}', '[viewer] …et elle les rend dans la rangée des fichiers');
{
  /* L'ORDRE DE LA RANGÉE (la demande de cette session, mot pour mot : « in the
     following order: PDB files, URL, Load, Trajectory, download pdb, clear,
     Create drive folder, Pdb from folder, trajectory from folder. Style from
     folder should not be there. »). Les DEUX fichiers du poste d'abord, puis ce
     qu'on fait de l'écran (⬇ PDB · 🗑 Clear), puis les commandes DU DOSSIER :
     le geste qui le CRÉE, et les 📂 de la page — qui FERMENT donc la rangée. */
  const iPdb = VIEW.indexOf('⬇ PDB{trajStatus');
  const iClear = VIEW.indexOf('onClick={handleClearViewer}');
  const iCreate = VIEW.indexOf('<DriveExperimentFolderCreator ctx={driveNaming} />');
  const iExtra = VIEW.indexOf('{fileRowExtra}');
  const iTraj = VIEW.lastIndexOf('📂 Trajectory', iPdb);
  ok(iTraj > 0 && iTraj < iPdb && iPdb < iClear && iClear < iCreate && iCreate < iExtra,
    '[viewer] …sur la ligne des fichiers, dans l’ordre : 📂 PDB file(s) · 📂 Trajectory · ⬇ PDB · 🗑 Clear · 📁 Create drive folder · les 📂 de la page');
  ok(VIEW.indexOf('label="📂 Style from folder"') === -1,
    '[viewer] …et plus de 📂 Style from folder : le style du dossier est lu par le rappel automatique');
}
eq(count(SEC, 'fileRowExtra'), 0, '[NMR] la page NMR n’en passe pas : le défaut `null` ne rend rien');
eq(count(DOCK, 'fileRowExtra'), 0, '[Docking] …la page Docking non plus');

const dkFlex = at(DOCK, '<div className="flex flex-col">', '[Docking] les deux cartes sont dans UN empilement');
const dk3D = at(DOCK, 'title="3D viewer"', '[Docking] le viewer 3D a SA sous-section repliable');
ok(dkFlex < dkSS && dkSS < dk3D, '[Docking] …après « Sequence and structure », sans blanc entre les deux');
const dk3Dcard = cardOf(DOCK, DOCK.lastIndexOf('<CollapsibleSection', dk3D));
has(dk3Dcard, 'defaultOpen={false}', '[Docking] le viewer reste replié par défaut');
has(dk3Dcard, "openWhen={structureMode === '3d'}",
  '[Docking] les structures de cluster (ou une condition en mode 3D) l’ouvrent toutes seules');
has(dk3Dcard, 'keepMounted', '[Docking] replier ne DÉMONTE pas le viewer');
has(dk3Dcard, 'onToggle={setViewerOpen}', '[Docking] …et la page est prévenue du repli / dépliage');
has(dk3Dcard, 'Receptor topology (PDB ID / URL)',
  '[Docking] le champ « Receptor topology » vit dans la carte du viewer (il n’y apparaissait qu’en mode 3D)');
has(dk3Dcard, '<NMRMoleculeViewer', '[Docking] …et le viewer est dans la même carte');
has(DOCK, 'const [viewerOpen, setViewerOpen] = useState(false);', '[Docking] `viewerOpen` ne pilote plus le montage');
has(DOCK, '}, [viewerOpen]);', '[Docking] …il ne sert qu’à recaler le viewer sur la largeur réelle');

/* ════════════ 4. LES TROIS PAGES PARLENT LE MÊME LANGAGE ═══════════════════ */
for (const [name, src] of [['NMR', SEC], ['MD', MD], ['Docking', DOCK]]) {
  has(src, 'title="3D viewer"', `[${name}] le viewer a sa carte « 3D viewer »`);
  has(src, 'keepMounted', `[${name}] …repliée sans être démontée`);
  has(src, 'openWhen={', `[${name}] …et rouverte par sa propre condition`);
  eq(count(src, 'title="3D viewer"'), 1, `[${name}] …en UN SEUL exemplaire`);
}
ok(count(MD, 'title="Sequence and structure"') === count(DOCK, 'title="Sequence and structure"') + 1,
  'la page MD ne montre jamais deux fois la même carte : ses deux cas de figure s’excluent');

/* ════════════ 5. ui.jsx : keepMounted / onToggle (le geste lui-même) ═══════ */
has(UI, 'keepMounted = false, onToggle', 'CollapsibleSection accepte keepMounted / onToggle');
has(UI, 'const [everOpened, setEverOpened] = useState(isOpen);',
  'une sous-section ne monte son contenu qu’après sa PREMIÈRE ouverture');
has(UI, 'if (next) setEverOpened(true);', '…ouverture qui est retenue');
has(UI, "style={{ display: isOpen ? 'block' : 'none' }}",
  'repliée, elle garde son contenu MONTÉ mais masqué (aucune relecture au dépliage)');
has(UI, 'if (onToggle) onToggle(next);', 'la page est prévenue de chaque repli / dépliage');
has(UI, ': (isOpen && <div className="p-3">{children}</div>)}',
  'les autres sections gardent exactement leur comportement (monté / démonté)');

/* ════════════ 6. RIEN D’AUTRE N’A BOUGÉ ════════════════════════════════════ */
has(MD, 'const residueNoOf = residueNumberResolver(activeTest);', '[MD] le résolveur de numéros est toujours là');
eq(count(MD, 'residueNo={residueNoOf}'), 2, '[MD] …les deux bandes le reçoivent');
eq(count(MD, 'sheetOf={(i) => sheetMarkAt(sheetPairs, i + 1)}'), 1, '[MD] le feuillet déclaré marque toujours la bande');
has(MD, "imposedSecondaryStructure={activeTest.secondaryStructure || ''}",
  '[MD] la structure peinte part toujours vers le viewer');
has(DOCK, "imposedSecondaryStructure={activeTest.secondaryStructure || ''}",
  '[Docking] …et sur la page Docking aussi');
has(DOCK, '<select value={structIdx}', '[Docking] le choix de la structure de cluster est intact');
has(DOCK, '☁️ Drive', '[Docking] …avec son lien Drive');
has(DOCK, "subsection: 'Docking'", '[Docking] le contexte de nommage du viewer est intact');

console.log(`_structure_windows_test.mjs — ${passed} assertions OK (la formule 2D dans « Sequence and structure », le viewer 3D repliable — sur les pages MD et Docking)`);





