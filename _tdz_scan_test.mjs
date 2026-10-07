/* =========================================================================
   _tdz_scan_test.mjs — LA GARDE CONTRE « Cannot access 'x' before initialization ».

   Trois incidents de production, tous la même faute :
     · 21/09/2026 la page docking → « Cannot access 'En' before initialization »
       (extraMols, cité dans le tableau de dépendances d'un useEffect déclaré
       plus bas) ;
     · 05/10/2026 (this session) → « Cannot access 'Er' before initialization »
       (calcMdTemp / calcMdHot / calcMdCold, même faute, dans
       NMRMoleculeViewer.jsx: l'effet 💾 cite les trois états de température,
       qui étaient déclarés ~50 lignes plus bas) — TOUTE page ouvrant le viewer
       jetait, donc l'expérience ouverte quelle qu'elle soit ;
     · le viewer lui-même (pymolScript), corrigé de la même façon.

   Ce qui rend la faute invisible : un tableau de dépendances est PLUS QU'UNE
   MÉTA-DONNÉE, il est LU PENDANT LE RENDU. Citer un `const` déclaré plus bas
   n'est donc pas une lecture « plus tard dans un callback » : le binding est
   encore dans sa ZONE MORTE (TDZ) et React jette au premier rendu. Aucun
   outil du dépôt ne le voyait :
     · oxlint a bien la règle `no-use-before-define`, mais elle ne signale RIEN,
       même sur `const a = b; const b = 1;` (vérifié) ;
     · `_viewer_render_smoke_test.mjs` l'attrape quand on y pense (il monte le
       viewer) mais il ne regarde que les cibles qu'il monte, jamais le reste
       du dépôt ;
     · les suites statiques (lecture de source) ne peuvent pas juger l'ORDRE
       d'exécution.
   D'où cette suite : elle PARSE vraiment tout `src/**` (oxc via
   rolldown/parseAst — déjà une dépendance du dépôt, utilisée par
   _docking_scatter_card_test.mjs par exemple) et fait l'analyse de portée :

     · binding   : `const` / `let` / `class` (var et function sont hissés : ils
                   ne jettent pas, donc hors sujet) ;
     · référence : tout Identifier qui n'est pas un NOM (clé non calculée,
                   propriété d'un membre, étiquette, nom d'import/export) ;
     · résolution: la référence est rattachée au binding le plus proche qui la
                   contient ; si la déclaration vient APRÈS la référence :
                     – MÊME PASSAGE (même fonction englobante la plus proche :
                       corps de composant, corps de fonction, module) →
                       TDZ CERTAINE : ce code, quand il passe là, jette ;
                     – fonction imbriquée définie avant → RISQUE seulement
                       (elle ne jette que si elle est appelée avant la
                       déclaration) : signalé, non bloquant.

   Ce que la suite exige (et qu'elle a déjà prouvé : elle a signalé les trois
   états de température de la révision 83d8dcb, et zéro sur l'arbre corrigé) :
     1. les témoins POSITIFS jettent vraiment → la sonde est branchée (un
        scanner qui ne signale rien passerait sinon pour un vert) ;
     2. les témoins NÉGATIFS ne signalent rien (typeof, export nommé,
        déclaration après la lecture, fonction imbriquée appelée plus tard) ;
     3. ZÉRO TDZ CERTAINE dans tout `src/**`, et suffisamment de fichiers
        analysés pour qu'un walk cassé ne puisse pas faire un faux vert.

   Elle ne dit rien, et ne doit RIEN dire, des BUNDLES minifiés : dans un
   bundle, le minifieur réutilise les mêmes noms courts dans des portées
   voisines, et les faux positifs y sont la règle (mesuré : le même chunk
   `auto-*.js` donne 8 alertes avant ET après la correction). La porte se pose
   sur le SOURCE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAst } from 'rolldown/parseAst';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

/* ── l'analyseur ─────────────────────────────────────────────────────────
   Un `const` / `let` / `class` lu AVANT sa déclaration, dans le MÊME passage
   (même corps de fonction, ou module) → TDZ certaine. */
const TDZ_KINDS = new Set(['const', 'let', 'class']);
const SKIP_KEYS = new Set(['type', 'start', 'end', 'range', 'loc', 'parent', 'raw', 'value']);
const ID = (n) => !!n && n.type === 'Identifier';
const nodeAt = (n) => !!n && typeof n === 'object' && typeof n.type === 'string';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'public', 'scripts', '_ngl_src',
  '_render_smoke', '_render_parking', '_approval_bc_render',
]);
function listFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) listFiles(join(dir, e.name), out); }
    else if (/\.(js|jsx)$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

function scanSource(file, code) {
  let program;
  try {
    program = parseAst(code, { lang: /\.jsx$/.test(file) ? 'jsx' : 'js', range: true });
  } catch (e1) {
    try { program = parseAst(code, { lang: 'jsx', range: true }); }
    catch { return { parseError: String((e1 && e1.message) || e1) }; }
  }

  const lines = code.split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') starts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (off >= starts[mid]) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  /* Portées. `funcId` = la fonction la plus proche (le programme en est une,
     pour l'ordre d'exécution du module) : deux références ne sont comparables
     que si elles partagent ce `funcId` — sinon la lecture peut avoir lieu
     après coup (callback, méthode…). Les corps de CLASSE ont leur propre
     `funcId` : une propriété de classe est évaluée à l'instanciation, pas à la
     ligne de la classe (donc « risque », jamais « certaine »). */
  const scopes = [];
  const mkScope = (kind, parent, funcId) => {
    const s = { id: scopes.length, kind, parent, funcId, bindings: new Map() };
    scopes.push(s);
    return s;
  };
  const bind = (scope, idNode, kind, start) => {
    if (!ID(idNode)) return;
    if (!scope.bindings.has(idNode.name)) {
      scope.bindings.set(idNode.name, { kind, start, scopeId: scope.id, name: idNode.name });
    }
  };
  const refs = [];
  const refSeen = new Set();
  const addRef = (node, scope, safe) => {
    if (!ID(node)) return;
    const key = `${node.start}:${node.name}`;
    if (refSeen.has(key)) return;
    refSeen.add(key);
    refs.push({ name: node.name, start: node.start, scopeId: scope.id, safe });
  };

  /* Le parcours GÉNÉRIQUE ne doit jamais voir un NOM (clé non calculée,
     propriété d'un membre, étiquette, nom d'import/export) : ces nœuds-là sont
     traités un par un ci-dessous. C'est ce qui distingue une lecture d'un nom. */
  function children(node) {
    const out = [];
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (nodeAt(c)) out.push(c); }
      else if (nodeAt(v)) out.push(v);
    }
    return out;
  }

  function visitPattern(node, scope, kind, declStart) {
    if (!nodeAt(node)) return;
    switch (node.type) {
      case 'Identifier': bind(scope, node, kind, declStart); return;
      case 'ObjectPattern':
        for (const p of node.properties) {
          if (p.type === 'RestElement') { visitPattern(p.argument, scope, kind, declStart); continue; }
          if (p.computed) visitExpr(p.key, scope);
          visitPattern(p.value, scope, kind, declStart);
        }
        return;
      case 'ArrayPattern':
        for (const el of node.elements) visitPattern(el, scope, kind, declStart);
        return;
      case 'AssignmentPattern':                     // `const { a = b } = x`
        visitPattern(node.left, scope, kind, declStart);
        visitExpr(node.right, scope);
        return;
      case 'RestElement': visitPattern(node.argument, scope, kind, declStart); return;
      default: visitExpr(node, scope); return;
    }
  }

  function visitFunction(node, scope) {
    const fnScope = mkScope('function', scope, -1);
    fnScope.funcId = fnScope.id;
    if (node.type === 'FunctionExpression' && node.id) bind(fnScope, node.id, 'function', node.start);
    for (const p of node.params) visitPattern(p, fnScope, 'param', node.start);
    if (node.body && node.body.type === 'BlockStatement') {
      const b = mkScope('block', fnScope, fnScope.funcId);
      for (const st of node.body.body) visitStmt(st, b);
    } else if (node.body) visitExpr(node.body, fnScope);   // flèche à corps-expression
  }

  function visitClass(node, scope) {
    if (node.superClass) visitExpr(node.superClass, scope);
    for (const el of (node.body && node.body.body) || []) {
      if (el.computed) visitExpr(el.key, scope);
      if (el.type === 'PropertyDefinition') { if (el.value) visitExpr(el.value, scope); }
      else if (el.value && nodeAt(el.value)) visitFunction(el.value, scope);
    }
  }

  function visitExpr(node, scope) {
    if (!nodeAt(node)) return;
    switch (node.type) {
      case 'Identifier': addRef(node, scope, false); return;
      case 'MemberExpression': case 'OptionalMemberExpression':
        visitExpr(node.object, scope);
        if (node.computed) visitExpr(node.property, scope);      // `a.b` : `b` n'est pas un nom
        return;
      case 'ChainExpression': visitExpr(node.expression, scope); return;
      case 'UnaryExpression': {
        const safe = node.operator === 'typeof';                 // typeof ne jette PAS en TDZ
        const from = refs.length;
        visitExpr(node.argument, scope);
        if (safe) for (let i = from; i < refs.length; i += 1) refs[i].safe = true;
        return;
      }
      case 'Property': {                                         // littéral objet
        if (node.computed) visitExpr(node.key, scope);
        if (node.shorthand) addRef(node.value, scope, false);     // { x } : `x` est lu
        else visitExpr(node.value, scope);
        return;
      }
      case 'FunctionExpression': case 'ArrowFunctionExpression': visitFunction(node, scope); return;
      case 'ClassExpression': {
        const inner = mkScope('class', scope, -1);
        inner.funcId = inner.id;
        if (node.id) bind(inner, node.id, 'class', node.start);
        visitClass(node, inner);
        return;
      }
      case 'JSXElement': case 'JSXFragment': {
        if (node.openingElement) {
          visitJsxName(node.openingElement.name, scope);
          for (const a of node.openingElement.attributes || []) visitJsxAttr(a, scope);
        }
        for (const c of node.children || []) visitExpr(c, scope);
        return;
      }
      case 'JSXExpressionContainer': visitExpr(node.expression, scope); return;
      case 'JSXSpreadChild': visitExpr(node.expression, scope); return;
      case 'TemplateLiteral': for (const e of node.expressions) visitExpr(e, scope); return;
      case 'MetaProperty': return;
      case 'ObjectPattern': case 'ArrayPattern': case 'AssignmentPattern': case 'RestElement':
        // affectation (pas déclaration) : les côtés gauches sont des LECTURES
        visitPattern(node, scope, 'let', -1);
        return;
      default:
        for (const child of children(node)) visitExpr(child, scope);
    }
  }

  function visitJsxName(name, scope) {
    if (!nodeAt(name)) return;
    if (name.type === 'JSXMemberExpression') { visitJsxName(name.object, scope); return; }
    if (name.type === 'JSXIdentifier') {
      addRef({ start: name.start, name: name.name, type: 'Identifier' }, scope, true);
    }
  }

  function visitJsxAttr(a, scope) {
    if (a.type === 'JSXSpreadAttribute') { visitExpr(a.argument, scope); return; }
    if (a.value && a.value.type === 'JSXExpressionContainer') visitExpr(a.value.expression, scope);
  }

  function visitStmt(node, scope) {
    if (!nodeAt(node)) return;
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          visitPattern(d.id, scope, node.kind, d.start);
          if (d.init) visitExpr(d.init, scope);
        }
        return;
      case 'FunctionDeclaration':
        bind(scope, node.id, 'function', node.start);   // hissée : jamais en TDZ
        visitFunction(node, scope);
        return;
      case 'ClassDeclaration': {
        bind(scope, node.id, 'class', node.start);
        const inner = mkScope('class', scope, -1);
        inner.funcId = inner.id;
        if (node.id) bind(inner, node.id, 'class', node.start);
        visitClass(node, inner);
        return;
      }
      case 'BlockStatement': {
        const b = mkScope('block', scope, scope.funcId);
        for (const st of node.body) visitStmt(st, b);
        return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const b = mkScope('block', scope, scope.funcId);
        if (node.type === 'ForStatement') {
          if (node.init) (node.init.type === 'VariableDeclaration' ? visitStmt(node.init, b) : visitExpr(node.init, b));
          if (node.test) visitExpr(node.test, b);
          if (node.update) visitExpr(node.update, b);
        } else {
          if (node.left.type === 'VariableDeclaration') visitStmt(node.left, b);
          else visitPattern(node.left, b, 'let', -1);
          visitExpr(node.right, b);
        }
        visitStmt(node.body, b);
        return;
      }
      case 'SwitchStatement': {
        const b = mkScope('block', scope, scope.funcId);
        visitExpr(node.discriminant, b);
        for (const c of node.cases) {
          if (c.test) visitExpr(c.test, b);
          for (const st of c.consequent) visitStmt(st, b);
        }
        return;
      }
      case 'CatchClause': {
        const b = mkScope('block', scope, scope.funcId);
        if (node.param) visitPattern(node.param, b, 'let', node.param.start);
        if (node.body) visitStmt(node.body, b);
        return;
      }
      case 'LabeledStatement': visitStmt(node.body, scope); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'ImportDeclaration':
        for (const s of node.specifiers) bind(scope, s.local, 'import', s.start);
        return;
      case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration':
        if (node.declaration) visitStmt(node.declaration, scope);
        return;   // `export { a }` : lecture légale même si `a` est en TDZ
      case 'ExportAllDeclaration': return;
      case 'ExpressionStatement': visitExpr(node.expression, scope); return;
      default:
        for (const child of children(node)) {
          if (child.type === 'BlockStatement' || /Statement$/.test(child.type)) visitStmt(child, scope);
          else visitExpr(child, scope);
        }
    }
  }

  const programScope = mkScope('program', null, 0);
  for (const st of program.body) visitStmt(st, programScope);

  /* ── résolution ───────────────────────────────────────────────────────── */
  const certain = [];
  const risky = [];
  for (const ref of refs) {
    if (ref.safe) continue;
    let s = scopes[ref.scopeId];
    let found = null;
    while (s) { const b = s.bindings.get(ref.name); if (b) { found = b; break; } s = s.parent; }
    if (!found || !TDZ_KINDS.has(found.kind)) continue;
    if (found.start <= ref.start) continue;                 // déclaré avant : rien à dire
    const samePass = scopes[ref.scopeId].funcId === scopes[found.scopeId].funcId;
    const row = `${file}:${lineOf(ref.start)} — ${ref.name}`
      + ` (déclaré ligne ${lineOf(found.start)}: ${(lines[lineOf(found.start) - 1] || '').trim().slice(0, 70)})`
      + `  ←  ${(lines[lineOf(ref.start) - 1] || '').trim().slice(0, 70)}`;
    (samePass ? certain : risky).push(row);
  }
  return { certain, risky, refCount: refs.length };
}

/* ═══ 1 · TÉMOINS ═══════════════════════════════════════════════════════════
   Une sonde qui ne signale jamais rien passerait pour un vert : avant de
   juger le dépôt, on lui donne les cas qu'elle DOIT voir (et ceux qu'elle ne
   doit pas voir). Les cas négatifs comptent autant : ce sont eux qui
   garantissent que la porte posée sur `src/` ne bloquera pas sur du code
   légitime. */
const CONTROLS = [
  '// A · le cas de l\'incident : un const cité dans une dep-array, déclaré plus bas',
  'function CompA() {',
  '  useEffect(() => { tick(hot); }, [hot, cold]);',
  '  const [hot, setHot] = useState(0);',
  '  const [cold, setCold] = useState(0);',
  '}',
  '',
  '// B · au niveau du module',
  'const B1 = B2;',
  'const B2 = 1;',
  '',
  '// C · typeof ne jette pas en TDZ',
  'const C1 = typeof C2 === "string";',
  'const C2 = "x";',
  '',
  '// D · `export { D }` est une lecture légale même si D est en TDZ',
  'export { D2 };',
  'const D2 = 1;',
  '',
  '// E · fonction imbriquée définie avant la déclaration : RISQUE, pas certitude',
  'function CompE() {',
  '  const read = () => EV;',
  '  const [EV, setEV] = useState(0);',
  '  return read;',
  '}',
  '',
  '// F · l\'ordre correct (déclaré avant d\'être cité)',
  'function CompF() {',
  '  const [ok, setOk] = useState(0);',
  '  useEffect(() => {}, [ok]);',
  '}',
  '',
  '// G · un NOM n\'est pas une lecture : clé d\'objet et propriété de membre',
  'const obj = { hot: 1 };',
  'const value = obj.hot;',
  'const { hot: alias } = obj;',
].join('\n');

const dir = mkdtempSync(join(tmpdir(), 'tdz-'));
const controlFile = join(dir, 'controls.jsx');
writeFileSync(controlFile, CONTROLS, 'utf8');
const control = scanSource(controlFile, CONTROLS);
ok(!control.parseError, `les témoins doivent être analysables (${control.parseError || 'ok'})`);

const certainNames = control.certain.map((r) => r.split(' — ')[1].split(' ')[0]);
const riskyNames = control.risky.map((r) => r.split(' — ')[1].split(' ')[0]);
const certainSet = new Set(certainNames);

/* 1a · les TDZ certaines des témoins (le nom signalé est celui de la LECTURE) */
['hot', 'cold', 'B2'].forEach((name) => ok(
  certainSet.has(name),
  `le témoin « ${name} » doit être signalé comme TDZ certaine (vu : ${certainNames.join(', ') || 'rien'})`,
));

/* 1b · les lectures LÉGITIMES ne doivent pas être signalées */
['C2', 'alias', 'ok', 'read', 'obj', 'value'].forEach((name) => ok(
  !certainSet.has(name) && !riskyNames.includes(name),
  `« ${name} » est une lecture légale : la sonde ne doit rien dire (certaines : ${certainNames.join(', ')} · risques : ${riskyNames.join(', ')})`,
));
ok(!certainNames.includes('hot') || certainNames.filter((n) => n === 'hot').length === 1,
  'un même binding n\'est signalé qu\'une fois');
ok(riskyNames.includes('EV'),
  `« EV » (fonction imbriquée définie AVANT sa déclaration) doit ressortir en RISQUE (vu : ${riskyNames.join(', ') || 'rien'})`);
ok(certainSet.size === 3 && control.refCount > 10,
  `les témoins exercent vraiment l'analyseur (certaines : ${certainNames.join(', ')} · refs: ${control.refCount})`);

/* ═══ 2 · LE DÉPÔT ══════════════════════════════════════════════════════════ */
const files = listFiles('src').sort();
ok(files.length >= 200, `src/ doit être analysé en entier (fichiers vus : ${files.length})`);
ok(files.some((f) => /NMRMoleculeViewer\.jsx$/.test(f)), 'src/components/NMRMoleculeViewer.jsx fait partie des fichiers analysés');

const parseErrors = [];
const certain = [];
let refTotal = 0;
for (const f of files) {
  const res = scanSource(f, readFileSync(f, 'utf8'));
  if (res.parseError) { parseErrors.push(`${f}: ${res.parseError}`); continue; }
  refTotal += res.refCount;
  certain.push(...res.certain);
}

/* Un fichier non analysé est un trou dans la porte : on le dit au lieu de
   compter un vert sur un périmètre incomplet. */
ok(parseErrors.length === 0, `tous les fichiers de src/ doivent être analysés —\n${parseErrors.join('\n')}`);
ok(refTotal > 100000, `l'analyse a bien lu les références du dépôt (${refTotal})`);
ok(certain.length === 0,
  `aucune « use before declaration » dans src/ — ces lectures-là jettent au rendu :\n${certain.join('\n')}\n`
  + '(déplacer la DÉCLARATION au-dessus de l\'effet qui la cite dans son tableau de dépendances — '
  + 'une dep-array est évaluée PENDANT le rendu, voir NMRMoleculeViewer.jsx)');

console.log(`_tdz_scan_test.mjs — ${passed} assertions OK  (${files.length} fichiers, ${refTotal} références)`);

