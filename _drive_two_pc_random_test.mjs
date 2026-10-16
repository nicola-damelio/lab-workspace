/* =========================================================================
   _drive_two_pc_random_test.mjs — FASE 0, POINT (b) et (TEST) : DES SCÉNARIOS
   TIRÉS AU SORT (GRAINE FIXE) SUR DEUX POSTES, ET LA MESURE DES DÉFAUTS.

   MODES
     • `node _drive_two_pc_random_test.mjs`                  → BASELINE (exit 0) :
       imprime la MATRICE « facteur → symptôme » avec ses comptes ;
     • `node _drive_two_pc_random_test.mjs --strict`         → exit 1 dès qu'un
       scénario viole un invariant (c'est ce que la FASE 1 exigera) ;
     • `--seeds=N` (défaut 20), `--seed0=N`, `--factor=nom` pour n'exécuter
       qu'un facteur.

   MÉTHODE (exigée par la FASE 0) : d'abord un RUN DE CONTRÔLE (un seul poste,
   aucun retard de cohérence, aucune erreur — il DOIT ne rien trouver), puis UN
   FACTEUR À LA FOIS : retard de cohérence (0 / 1 s / 10 s), erreurs réseau,
   second poste, onglet fermé à mi-chemin, renommages lents. Chaque cellule est
   mesurée sur les mêmes graines.

   CE QUI EST MESURÉ, à quiescence (tous les postes ont vidé et publié) :
     • I1 jumeaux          : deux dossiers VIVANTS du même parent et du même nom ;
     • I4 arbre ⇄ plan      : dossiers du plan absents du Drive, dossiers du Drive
                             hors du plan ;
     • I5 restes de renommage : dossiers du NOM PRÉCÉDENT encore vivants ;
     • I6 idempotence       : republier le même modèle n'écrit rien ;
     • I2/I3 la copie du Drive relue par l'AUTRE poste porte-t-elle les mêmes
       expériences — et en a-t-elle perdu sans suppression enregistrée ?
   ========================================================================= */
import { createHarness, createAutosaveReplica } from './_harness/two-pc.mjs';
import { makeRng } from './_harness/fake-drive.mjs';

process.on('unhandledRejection', (err) => {
  console.error('\n✖ REJET NON RATTRAPÉ :');
  console.error(String((err && err.stack) || err).split('\n').slice(0, 5).join('\n'));
  process.exit(3);
});

const ARGS = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const STRICT = process.argv.includes('--strict');
const SEEDS = Number(ARGS.get('seeds') || 20);
const SEED0 = Number(ARGS.get('seed0') || 1);
const ONLY = ARGS.get('factor') || '';
const DATASET = { datasetName: 'RAND DATASET', datasetId: 'ds_rand' };

const exp = ({ id, name, project = 'Proj', instance = 'i1', html = '' }) => ({
  id, name, projectNames: [project], instanceName: instance, date: '2026-01-01',
  sections: [{ title: 'Data', html: html || `<p>${id}</p>` }]
});
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ── UN POSTE : SON MODÈLE (ce que son écran porte) + SON AUTOSAVE ─────────
   Le modèle est la seule source : les expériences, leurs noms, le lien au
   projet. C'est exactement la charge qu'App.jsx sauvegarde (App.jsx:4100). */
const createSite = ({ pc, index, seed, tag, autosave = {} }) => {
  const rng = makeRng(seed * 131 + index * 17 + 1);
  const site = {
    tag, pc, rng, ops: 0, everCreated: [], deleted: [],
    model: { datasetTitle: DATASET.datasetName, subtitle: '', projects: [{ id: 'p1', name: 'Proj' }], tests: [] }
  };
  site.data = () => clone(site.model);
  site.auto = createAutosaveReplica({
    pc, datasetId: DATASET.datasetId, delayMs: 5, ...autosave,
    payloadFn: () => {
      const d = clone(site.model);
      d.datasetTitle = DATASET.datasetName;
      return d;
    }
  });
  /* Un geste du poste : le modèle change, l'autosave repart (App.jsx). */
  const touch = () => { site.ops += 1; site.auto.schedule(); };
  site.addExperiment = () => {
    /* LE NOM PAR DÉFAUT EST CELUI DE L'APP : `tests.length + 1` (App.jsx:1145,
       appelé par testsModule.jsx:259 et projectDetailModule.jsx:1816). */
    const num = site.model.tests.length + 1;
    const t = exp({ id: `${tag}${site.everCreated.length + 1}`, name: `Test ${num}` });
    site.model.tests.push(t);
    site.everCreated.push(t.id);
    touch();
    return t;
  };
  site.renameExperiment = (id, name) => {
    const t = site.model.tests.find((x) => x.id === id);
    if (!t) return false;
    t.name = name;
    touch();
    return true;
  };
  /* ⚠ LE GESTE DE L'APP QUAND ON QUITTE LE CHAMP DU NOM
     (`activeTestModule.jsx:545-591` : `onFocus` retient le nom d'AVANT,
     `onBlur` appelle `renameDriveFilesFor({ field:'test', oldValue, newValue,
     project })`). Le harnais, sans ce geste, ne teste QUE la republication du
     nom — c'est la différence qui explique « aucune cartouche “Prov” restée sur
     le Drive réel » (prove manuali del 16/10/2026). Rend ce que l'appel Drive
     répond (ou `{ error }`). */
  site.leaveNameField = (oldValue, newValue, project = 'Proj') =>
    pc.do((M) => M.upload.renameDriveFilesFor({ field: 'test', oldValue, newValue, project }))
      .catch((err) => ({ error: String((err && err.message) || err) }));
  /** RENOMMER COMME L'APP : la frappe écrit le modèle, la SORTIE DU CHAMP fait
   *  le geste Drive (l'ancien nom est celui d'AVANT le focus, pas le dernier
   *  nom partiel publié). */
  site.renameExperimentWithGesture = async (id, name) => {
    const t = site.model.tests.find((x) => x.id === id);
    if (!t) return false;
    const before = t.name;
    site.renameExperiment(id, name);          // la frappe (App.jsx:4071 → minuteur)
    await site.leaveNameField(before, name);  // la sortie du champ (le geste Drive)
    return true;
  };
  /** Le magasin LOCAL du poste (ce qui reste si l'onglet meurt avant l'écriture). */
  site.localExperiments = () => site.auto.localExperiments();
  /** LA RÉOUVERTURE DU POSTE : une session neuve repart de son magasin local,
   *  exactement comme la liste des datasets à l'ouverture (App.jsx:5809-5813). */
  site.reopen = () => {
    const found = site.auto.reopenSession();
    site.model = found.model
      ? { ...site.model, ...found.model }
      : { datasetTitle: DATASET.datasetName, subtitle: '', projects: [{ id: 'p1', name: 'Proj' }], tests: [] };
    return found;
  };
  site.moveExperiment = (id, project) => {
    const t = site.model.tests.find((x) => x.id === id);
    if (!t) return false;
    t.projectNames = [project];
    touch();
    return true;
  };
  site.deleteExperiment = (id) => {
    const before = site.model.tests.length;
    site.model.tests = site.model.tests.filter((x) => x.id !== id);
    if (site.model.tests.length === before) return false;
    site.deleted.push(id);
    touch();
    return true;
  };
  /* « Un poste qu'on ouvre » : il ADOPTE ce que le Drive porte (la copie du
     dataset), comme le fait l'app à l'ouverture quand Firestore ne répond pas. */
  site.adoptFromDrive = async () => {
    const rec = await pc.do((M) => M.workspace.readDatasetCopy(DATASET.datasetId)).catch(() => null);
    if (!rec || !rec.payload) return null;
    try {
      const parsed = JSON.parse(rec.payload);
      if (parsed && Array.isArray(parsed.tests)) {
        site.model = { ...site.model, ...parsed };
        return parsed;
      }
    } catch { /* copie illisible : le poste garde sa mémoire */ }
    return null;
  };
  site.publishNow = () => pc.do((M) => M.structure.publishDatasetStructure({
    datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data: site.data()
  })).catch((err) => ({
    /* App.jsx attrape cet échec (`.catch((err) => setDriveMirrorMsg(…))`,
       App.jsx:4155) : le poste continue de vivre. Le scénario fait pareil, sinon
       un Drive qui tousse arrêterait le test au lieu de le mesurer. */
    ok: false, reason: 'threw', error: String((err && err.message) || err), report: null
  }));
  return site;
};

/* ── UN SCÉNARIO TIRÉ AU SORT ───────────────────────────────────────────── */
const runScenario = async ({ seed, factor }) => {
  const lag = factor.coherenceMs || 0;
  const h = await createHarness({
    ...DATASET, seed,
    drive: { coherenceMs: lag, errorRate: factor.errorRate || 0, errorStatuses: [429, 500] }
  });
  /* LA FENÊTRE D'AVANT L'ÉCRITURE (question 4) : le test FERME lui-même l'attente
     qui précède l'écriture locale (`hooksBeforeWrite`) — aucune course d'horloge.
     Le portail n'est ARMÉ que pour la sauvegarde de la fermeture. */
  let openGate = null;
  let armed = false;
  const gate = new Promise((resolve) => { openGate = resolve; });
  const autosave = factor.earlyClose
    ? { hooksBeforeWrite: [() => (armed ? gate : Promise.resolve())] }
    : {};
  const A = createSite({ h, pc: h.pcs[0], index: 0, seed, tag: 'a', autosave });
  const B = factor.secondPc ? createSite({ h, pc: h.pcs[1], index: 1, seed, tag: 'b', autosave }) : null;
  const sites = B ? [A, B] : [A];
  const rng = makeRng(seed * 977 + 7);
  const pick = () => sites[Math.floor(rng() * sites.length)];
  const steps = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < steps; i += 1) {
    const s = pick();
    const tests = s.model.tests;
    const choice = rng();
    if (choice < 0.3 || !tests.length) { s.addExperiment(); } else {
      const t = tests[Math.floor(rng() * tests.length)];
      if (choice < 0.6) {
        const next = `${t.name}_${Math.floor(rng() * 9) + 1}`;
        if (factor.slowRename) {
          /* RENOMMAGE LENT : l'autosave part AUSSI sur les noms intermédiaires. */
          s.renameExperiment(t.id, next.slice(0, Math.max(2, next.length - 2)));
          await s.auto.flush();
        }
        s.staleNames = [...(s.staleNames || []), t.name];
        /* DEUX MANIÈRES DE RENOMMER, MESURÉES SÉPARÉMENT : le modèle seul (ce que
           le harnais faisait jusqu'ici) ou le modèle + LA SORTIE DU CHAMP (ce que
           l'app fait vraiment — `activeTestModule.jsx:545-591`). Sans la seconde,
           on mesure la republication du nom, pas le geste de l'utilisateur. */
        if (factor.fieldGesture) await s.renameExperimentWithGesture(t.id, next);
        else s.renameExperiment(t.id, next);
      } else if (choice < 0.75) {
        s.moveExperiment(t.id, rng() < 0.5 ? 'Proj' : 'Autre');
      } else if (choice < 0.9) {
        s.deleteExperiment(t.id);
      } else if (B) {
        /* Le poste se ROUVRE : il adopte ce que le Drive porte (sa mémoire peut
           être en retard sur l'autre poste — c'est le cas réel). */
        await s.adoptFromDrive();
      }
    }
    if (lag) h.drive.advance(lag);     // le temps passe : la recherche rattrape
  }
  /* ONGLET FERMÉ À MI-CHEMIN : une sauvegarde attendue ne partira jamais. */
  if (factor.tabKilled) {
    const s = pick();
    s.addExperiment();
    s.auto.killWithoutFlush();
  }
  /* ── LA FERMETURE PRÉCOCE (question 4) : l'onglet meurt PENDANT les attentes
     d'avant l'écriture (App.jsx:4110 la relecture de la copie partagée, 4116 la
     compression). RIEN n'a encore été écrit : ni magasin local, ni copie du
     dataset, ni arbre. On mesure ce qui reste, puis ce que la RÉOUVERTURE
     retrouve (une session neuve repart de son magasin local, App.jsx:5809). */
  if (factor.earlyClose) {
    const s = sites[0];
    armed = true;                                   // la prochaine écriture ATTEND
    const created = s.addExperiment();
    await new Promise((r) => setTimeout(r, 25));    // le minuteur (5 ms) est passé : la sauvegarde est parquée
    s.auto.killDuringSave();                        // la page est détruite pendant l'attente
    if (openGate) openGate();                       // l'attente se dénoue (trop tard)
    await new Promise((r) => setTimeout(r, 25));
    const reopened = s.reopen();                    // onglet rouvert
    const earlyClose = {
      id: created.id,
      name: created.name,
      diedIn: s.auto.report.diedIn || '',
      localIds: reopened.ids,
      localNames: reopened.names,
      storeEntries: s.auto.readLocalStore().length,
      copyIds: null
    };
    return measure(h, sites, { earlyClose });
  }
  /* ── A GARDE DES MODIFICATIONS NON PUBLIÉES PENDANT QUE B ÉCRIT (question 4) :
     le minuteur de A est annulé (rien de A n'est parti), B publie et pousse SA
     copie, puis A repart et publie la sienne : un seul fichier de copie, donc
     « l'ultimo che scrive vince » — et l'arbre de A ne connaît pas l'expérience
     de B. */
  if (factor.staleFirstPc) {
    const [a, b] = sites;
    a.addExperiment();
    a.addExperiment();
    a.auto.killWithoutFlush();       // le minuteur de A meurt : rien n'est parti
    b.addExperiment();
    await b.auto.flush();            // B écrit : magasin local + copie + arbre
    await b.publishNow();
  }
  /* FIN D'USAGE NORMALE : chaque poste repart, vide, publie — puis on regarde. */
  for (const s of sites) {
    s.auto.schedule();
    await new Promise((r) => setTimeout(r, 25));
    await s.auto.flush();
    await s.publishNow();
  }
  return measure(h, sites);
};

/* ── LES FACTEURS, UN À LA FOIS (le contrôle d'abord) ───────────────────── */
const FACTORS = [
  { id: 'controle', title: 'CONTRÔLE — 1 poste, aucun retard, aucune erreur', coherenceMs: 0, secondPc: false },
  { id: 'controle-2pc', title: 'CONTRÔLE — 2 postes, aucun retard, aucune erreur', coherenceMs: 0, secondPc: true },
  { id: 'lag-1s', title: 'Retard de cohérence 1 s (2 postes)', coherenceMs: 1000, secondPc: true },
  { id: 'lag-10s', title: 'Retard de cohérence 10 s (2 postes)', coherenceMs: 10000, secondPc: true },
  { id: 'reseau', title: 'Erreurs Drive 1 sur 5 (2 postes)', coherenceMs: 0, secondPc: true, errorRate: 0.2 },
  { id: 'onglet-ferme', title: 'Onglet fermé à mi-chemin (2 postes)', coherenceMs: 0, secondPc: true, tabKilled: true },
  { id: 'renommage-lent', title: 'Renommages lents (2 postes)', coherenceMs: 1000, secondPc: true, slowRename: true },
  /* ⚠ LE MÊME RENOMMAGE, MAIS AVEC LE GESTE DE L'APP (la sortie du champ) : la
     comparaison avec la ligne précédente dit si les restes de renommage viennent
     du modèle seul (ce que le harnais faisait) ou du geste réel. */
  { id: 'renommage-champ', title: 'Renommages lents + SORTIE DU CHAMP (2 postes)', coherenceMs: 1000, secondPc: true, slowRename: true, fieldGesture: true },
  /* QUESTION 4 — l'onglet meurt PENDANT les attentes d'avant l'écriture. */
  { id: 'chiusura-precoce', title: 'Scheda chiusa PRIMA dell’autosave (1 poste, attese reali)', coherenceMs: 0, secondPc: false, earlyClose: true },
  /* QUESTION 4 — un poste avec des modifications non envoyées pendant que l'autre écrit. */
  { id: 'a-non-inviato-b-salva', title: 'A ha modifiche non inviate, B salva (2 posti)', coherenceMs: 0, secondPc: true, staleFirstPc: true }
];

/* La matrice est exécutée APRÈS la définition de `measure` (plus bas) : elle en
   dépend, et un `const` utilisé avant sa définition lèverait. */
const main = async () => {
const rows = [];
for (const factor of FACTORS) {
  if (ONLY && factor.id !== ONLY) continue;
  const acc = { seeds: 0, twins: 0, missing: 0, extra: 0, lost: 0, lostLocal: 0, copyUnreadable: 0, divergence: 0, notIdempotent: 0, stale: 0, bad: 0, examples: [], earlyClose: [] };
  for (let i = 0; i < SEEDS; i += 1) {
    const seed = SEED0 + i;
    const m = await runScenario({ seed, factor });
    acc.seeds += 1;
    if (m.twins) acc.twins += 1;
    if (m.missing) acc.missing += 1;
    if (m.extra) acc.extra += 1;
    if (m.lost) acc.lost += 1;
    if (m.lostLocal) acc.lostLocal += 1;
    if (m.copyUnreadable) acc.copyUnreadable += 1;
    if (m.divergence) acc.divergence += 1;
    if (m.stale) acc.stale += 1;
    if (!m.idempotent) acc.notIdempotent += 1;
    if (m.earlyClose && acc.earlyClose.length < 3) acc.earlyClose.push({ seed, ...m.earlyClose });
    if (m.debug) acc.debug = [...(acc.debug || []), m.debug];
    const dirty = m.twins || m.missing || m.lost || m.lostLocal || m.divergence || m.stale || !m.idempotent;
    if (dirty) {
      acc.bad += 1;
      if (acc.examples.length < 2) acc.examples.push(`graine ${seed} → ${JSON.stringify({ jumeaux: m.twins, absents: m.missing, horsPlan: m.extra, perdus: m.lost, divergence: m.divergence, reste: m.stale, idempotent: m.idempotent, ex: m.extraExamples, exAbsents: m.missingExamples, report: m.againReport })}`);
    }
  }
  rows.push({ factor, acc });
}

console.log(`\n═══ MATRICE FACTEUR → SYMPTÔME (${SEEDS} graines par facteur, graines ${SEED0}…${SEED0 + SEEDS - 1}) ═══`);
if (process.env.SYNC_DEBUG) {
  for (const { factor, acc } of rows) {
    (acc.debug || []).forEach((d) => {
      console.log(`\n▸▸ ${factor.id} — plan (${d.planned.length}) vs Drive (${d.live.length})`);
      console.log(`   absents  : ${JSON.stringify(d.missing)}`);
      console.log(`   hors plan: ${JSON.stringify(d.extra)}`);
      console.log(`   drive    : ${JSON.stringify(d.live)}`);
    });
  }
}
console.log('facteur                        | jumeaux | absents | hors plan | perdus | copia illegg. | persi in locale | divergence 2 postes | reste de renommage | non idempotent | scénarios sales');
for (const { factor, acc } of rows) {
  console.log(`${factor.id.padEnd(30)} | ${String(acc.twins).padStart(7)} | ${String(acc.missing).padStart(7)} | ${String(acc.extra).padStart(9)} | ${String(acc.lost).padStart(6)} | ${String(acc.copyUnreadable).padStart(13)} | ${String(acc.lostLocal).padStart(15)} | ${String(acc.divergence).padStart(19)} | ${String(acc.stale).padStart(18)} | ${String(acc.notIdempotent).padStart(14)} | ${acc.bad}/${acc.seeds}`);
}
for (const { factor, acc } of rows) {
  console.log(`\n▸ ${factor.title}`);
  if (!acc.examples.length) console.log('   aucun scénario sale');
  acc.examples.forEach((e) => console.log(`   · ${e}`));
}
const control = rows.find((r) => r.factor.id === 'controle');
if (control && control.acc.bad > 0) {
  console.log('\n⚠ LE RUN DE CONTRÔLE (1 poste, aucun retard, aucune erreur) TROUVE DÉJÀ DES DÉFAUTS :');
  console.log('   ils ne viennent donc PAS d’une course entre postes ni d’un Drive capricieux, mais du CHEMIN DE PUBLICATION lui-même');
  console.log('   (dossier vide au nouveau nom, « absents » dans le plan, copie du dataset écrasée). C’est un RÉSULTAT, pas une panne du harnais.');
  console.log('   Le scénario minimal est dans _drive_sync_repro_test.mjs, section « R » : quatre gestes, aucun aléa.');
}
/* ── QUESTION 4 : LE PIRE CAS — LA SCHEDA CHIUSA PRIMA DELL'AUTOSAVE ──────── */
const early = rows.find((r) => r.factor.id === 'chiusura-precoce');
if (early) {
  console.log('\n▸ CHIUSURA PRECOCE (scheda chiusa DURANTE le attese d’avant l’écriture)');
  console.log(`   esperienze perdute ANCHE nel magazzino LOCALE : ${early.acc.lostLocal}/${early.acc.seeds}`);
  early.acc.earlyClose.forEach((e) => console.log(`   · graine ${e.seed} : « ${e.name} » (${e.id}) — morte pendant « ${e.diedIn} », magazzino locale : ${JSON.stringify(e.localNames)}, copia Drive : ${JSON.stringify(e.copyIds)}`));
  console.log('   lettura : se la perdita è n/n, la chiusura entro 1,5 s NON è riparata da `pagehide`');
  console.log('   (le attese d’avant l’écriture — App.jsx:4110/4116 — non si concludono in una pagina distrutta),');
  console.log('   quindi la « persistenza delle modifiche non inviate » (punto G della FASE 1) ha una prova.');
}
/* ── IL GESTO DEL CAMPO CAMBIA IL RISULTATO? (il punto 2 da declassare) ───── */
const slowRow = rows.find((r) => r.factor.id === 'renommage-lent');
const gestRow = rows.find((r) => r.factor.id === 'renommage-champ');
if (slowRow && gestRow) {
  console.log('\n▸ RENOMMAGE : « modello solo » ⟷ « modello + sortie du champ » (il gesto dell’app)');
  console.log(`   reste de renommage : ${slowRow.acc.stale}/${slowRow.acc.seeds} (modello solo) — ${gestRow.acc.stale}/${gestRow.acc.seeds} (gesto reale)`);
  console.log(`   jumeaux : ${slowRow.acc.twins}/${slowRow.acc.seeds} — ${gestRow.acc.twins}/${gestRow.acc.seeds}`);
}
const dirtyNonControl = rows.filter((r) => r.factor.id !== 'controle' && r.acc.bad > 0).length;
/* Le dénominateur ne compte que les facteurs RÉELLEMENT exécutés (et seulement
   s'ils contiennent le run de contrôle) — un `--factor=…` seul ne doit pas
   annoncer « 1/0 ». */
const ranFactors = rows.length - (rows.some((r) => r.factor.id === 'controle') ? 1 : 0);
console.log(`\nMODE : ${STRICT ? 'STRICT' : 'BASELINE'} — facteurs sales (hors contrôle) : ${dirtyNonControl}/${ranFactors}`);
process.exit(STRICT && dirtyNonControl ? 1 : 0);
};

const measure = async (h, sites, extra = {}) => {
  const DRIVE = h.drive;
  const model = sites[0].model;
  const plan = h.mods.structure.datasetMirrorPlan({
    datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data: model
  });
  /* On compare DANS LE MÊME ESPACE : l'arbre SOUS `projects/` — c'est là que
     vivent les expériences (les dossiers fixes du dataset, eux, ne dépendent pas
     du modèle et ne disent rien du défaut). */
  const planned = plan.folders
    .map((f) => [h.datasetFolderName, ...f.path].join('/'))
    .filter((p) => p.includes('/projects/') || p.endsWith('/projects'));
  const liveFolders = DRIVE.live()
    .filter((n) => n.mimeType === DRIVE.FOLDER_MIME && DRIVE.pathOf(n.id).includes('projects'))
    .map((n) => DRIVE.pathOf(n.id).slice(1).join('/'));
  const missing = planned.filter((p) => !liveFolders.includes(p));
  const extraFolders = liveFolders.filter((p) => !planned.includes(p));
  const twins = DRIVE.twins();

  /* Chaque poste POUSSE sa copie du dataset (ce que `pagehide` fait), puis les
     deux la relisent : c'est ce qu'un poste qui ouvre le dataset verrait. */
  for (const s of sites) await s.auto.pushCopy();

  /* Les deux postes RELISENT la copie du Drive : que voient-ils ? */
  const copies = [];
  for (const s of sites) {
    const rec = await s.pc.do((M) => M.workspace.readDatasetCopy(DATASET.datasetId)).catch(() => null);
    let ids = null;
    try { ids = rec && rec.payload ? (JSON.parse(rec.payload).tests || []).map((t) => t.id) : null; } catch { ids = 'unreadable'; }
    copies.push(ids);
  }
  /* I3 : ce qui a été créé et jamais supprimé doit être lisible quelque part.
     ⚠ LA COPIE EST UN SEUL FICHIER, ET LE HARNAIS DIT QUAND IL EST ILLISIBLE :
     compter « perdus » alors que le fichier n'a pas été lu (Drive muet, écriture
     refusée — le message « not connected » du faux Drive) serait un faux défaut.
     Le compte n'est donc fait QUE si la copie a été relue, et le cas est dit. */
  const unionIds = [...new Set(sites.flatMap((s) => s.everCreated))].filter((id) => !sites.some((s) => s.deleted.includes(id)));
  const copyReadable = Array.isArray(copies[0]);
  const onDrive = copyReadable ? copies[0] : [];
  const lost = copyReadable ? unionIds.filter((id) => !onDrive.includes(id)) : [];
  /* I7 (question 4) : ce même travail est-il dans le MAGASIN LOCAL du poste ?
     C'est la SEULE copie dont un poste dispose sans réseau : si elle manque aussi,
     l'expérience n'existe plus nulle part. */
  const localIds = extra.earlyClose && Array.isArray(extra.earlyClose.localIds) ? extra.earlyClose.localIds : null;
  const lostLocal = Array.isArray(localIds) ? unionIds.filter((id) => !localIds.includes(id)) : [];
  if (extra.earlyClose) extra.earlyClose.copyIds = Array.isArray(copies[0]) ? copies[0] : null;
  /* I2 : LES DEUX ÉCRANS portent-ils les mêmes expériences ? (Ce n'est pas la
     copie du Drive qui est comparée — la copie est un fichier unique, donc les
     deux postes y liraient forcément la même chose. C'est bien ce que CHAQUE
     POSTE A À L'ÉCRAN qui doit coïncider.) */
  const idsOf = (s) => s.model.tests.map((t) => t.id).sort().join(',');
  const divergence = sites.length > 1 ? idsOf(sites[0]) !== idsOf(sites[1]) : false;

  /* I5 : un dossier du NOM PRÉCÉDENT est-il resté vivant ? (le test note les
     anciens noms au moment du renommage) */
  const staleNames = sites.flatMap((s) => s.staleNames || []).filter(Boolean);
  const staleFolders = staleNames.filter((n) => DRIVE.foldersNamed(n, '__').length === 0
    ? liveFolders.some((p) => p.endsWith(`/${n}`)) : false);

  /* I6 : republier le même modèle ne doit RIEN changer à l'arbre : ni dossier
     nouveau, ni renommage, ni déplacement, ni mise à la corbeille. (Les FICHIERS
     peuvent être réécrits lorsque leur contenu porte une date : le JSON du
     dataset est daté à chaque publication — c'est dit, pas caché.) */
  const nodesBefore = DRIVE.nodes.size;
  const opsBefore = DRIVE.log.filter((e) => e.op === 'rename' || e.op === 'move' || e.op === 'trash' || e.op === 'create').length;
  const again = await sites[0].publishNow();
  const nodesAfter = DRIVE.nodes.size;
  const opsAfter = DRIVE.log.filter((e) => e.op === 'rename' || e.op === 'move' || e.op === 'trash' || e.op === 'create').length;
  const idempotent = !!(again && again.ok && nodesAfter === nodesBefore && opsAfter === opsBefore);

  return {
    twins: twins.length, missing: missing.length, extra: extraFolders.length,
    lost: lost.length, divergence, idempotent, stale: staleFolders.length,
    copyUnreadable: !copyReadable,
    lostLocal: lostLocal.length, earlyClose: extra.earlyClose || null,
    rewritten: again && again.report ? again.report.files : -1,
    againReport: (again && again.report) || null,
    idemDetail: { nodesBefore, nodesAfter, opsBefore, opsAfter },
    debug: process.env.SYNC_DEBUG ? { planned, live: liveFolders, missing, extra: extraFolders } : null,
    extraExamples: extraFolders.slice(0, 3), missingExamples: missing.slice(0, 3),
    twinExamples: twins.slice(0, 2).map((t) => t.path.join('/'))
  };
};

await main();
