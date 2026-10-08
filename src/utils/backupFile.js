/* =========================================================================
   src/utils/backupFile.js
   LA SAUVEGARDE D'UN DATASET — UN FICHIER, UN FORMAT, ET SA VALIDATION.

   Le défaut réparé : la sauvegarde hebdomadaire écrivait un fichier **HTML**
   dont tout le contenu vivait dans un `<script id="saved-data-blob">` — un
   format qui obligeait à extraire la charge par une expression régulière, et
   qui ne disait RIEN de lui-même : ni la version du format, ni ce qu'il portait.
   Une restauration ne pouvait donc pas VÉRIFIER ce qu'elle lisait : un fichier
   tronqué, édité à la main ou écrit par une version plus récente se relisait
   comme un fichier valide, et l'import s'ouvrait sur une copie amputée sans un
   mot.

   Ce que ce module pose :

     • le fichier écrit est du **JSON structuré** — `format`, `schema`, `savedAt`,
       `datasetId` (D'OÙ VIENT la sauvegarde), titre, sous-titre, `compressed`,
       les **COMPTES** de ce qu'elle porte, le **RÉSUMÉ** qui la NOMME (une liste
       courte : « CD », « BG04_ », « 1YCR »…), et la charge (`payload`, compressée
       comme avant) : un fichier qui dit ce qu'il est et ce qu'il contient — sans
       rien décompresser, l'en-tête se lit à l'œil nu ;
     • la RESTAURATION VALIDE AVANT D'AGIR : le format, la version du schéma, la
       lisibilité de la charge, et la CONCORDANCE entre les comptes déclarés et
       les comptes réels. Un écart est un refus MOTIVÉ — jamais l'importation
       silencieuse d'une copie amputée ;
     • l'ANCIEN HTML reste LISIBLE (les sauvegardes déjà écrites sur les Drive) :
       la charge y est extraite comme avant, mais il n'y a pas de comptes
       déclarés à comparer, puisqu'il n'en portait pas.

   Tout est PUR (aucun accès Drive, aucun stockage, aucune horloge implicite) :
   c'est ce qui permet de vérifier la validation hors navigateur
   (_backup_file_test.mjs) sur des fichiers réellement écrits, tronqués, ou
   édités.
   ========================================================================= */

import LZString from 'lz-string';
import { sanitizeSlug, datasetFolderSlug } from './driveNaming';
/* Le bloc `<script id="saved-data-blob">` de l'ANCIEN format : une seule source
   pour sa lecture (le module des papiers lit déjà les mêmes fichiers). */
import { BACKUP_BLOB_RE } from './referenceImport';

/** Le format écrit à partir de maintenant (JSON), et sa VERSION : un fichier
 *  qui annonce une version inconnue est refusé, jamais « lu quand même ». */
export const BACKUP_FORMAT = 'lab-workspace-backup';
export const BACKUP_SCHEMA = 1;
export const SUPPORTED_SCHEMAS = [1];
/** L'ancien format (déjà écrit sur les Drive) : relu, plus jamais écrit. */
export const BACKUP_LEGACY_FORMAT = 'lab-workspace-backup-legacy-html';
export const BACKUP_LEGACY_SCHEMA = 0;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const sizeOf = (v) => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v === undefined || v === null || v === '' ? 0 : 1;
};

/* ── CE QU'UNE SAUVEGARDE DIT PORTER ─────────────────────────────────────────
   Une liste courte et VRAIE : les collections qu'un utilisateur cherche quand
   il restaure (« mes expériences sont-elles dans ce fichier ? »). Chaque entrée
   porte son nom ET son unité, pour que la phrase soit lisible — et, pour le
   RÉSUMÉ (voir `backupSummaryOf`) — `fields` dit OÙ lire le nom d'un élément,
   le premier champ non vide faisant foi (un protocole porte un `title`, une
   expérience et un meuble un `name`). Une collection en forme de CARTE est
   nommée par ses CLÉS — ses entrées y sont rangées par nom de composé, donc
   `fields` y est vide. */
export const BACKUP_COUNT_KEYS = [
  { key: 'tests', label: 'Expériences', unit: 'expérience', fields: ['name', 'id'] },
  { key: 'projects', label: 'Projets', unit: 'projet', fields: ['name', 'id'] },
  { key: 'datasetProtocols', label: 'Protocoles', unit: 'protocole', fields: ['title', 'name', 'id'] },
  { key: 'storages', label: 'Stockage', unit: 'emplacement', fields: ['name', 'id'] },
  { key: 'molecules', label: 'Molécules', unit: 'molécule', fields: ['name', 'label', 'id'] },
  { key: 'calculationEntries', label: 'Calculs', unit: 'calcul', fields: [] },
  { key: 'compoundMeta', label: 'Fiches composés', unit: 'fiche', fields: [] },
  { key: 'nmrExperiments', label: 'Expériences RMN', unit: 'expérience', fields: ['name', 'id'] }
];

/** Les comptes d'un état de dataset (`{ tests: 12, projects: 3, … }`). PUR. */
export const backupCountsOf = (state) => {
  const src = state && typeof state === 'object' ? state : {};
  const counts = {};
  BACKUP_COUNT_KEYS.forEach(({ key }) => { counts[key] = sizeOf(src[key]); });
  return counts;
};

/** « 12 expériences, 3 projets » — ce qu'un compte-rendu peut dire. PUR. */
export const describeBackupCounts = (counts, { max = 4 } = {}) => {
  const src = counts && typeof counts === 'object' ? counts : {};
  const parts = BACKUP_COUNT_KEYS
    .map(({ key, unit }) => ({ key, unit, n: Number(src[key]) || 0 }))
    .filter((e) => e.n > 0)
    .slice(0, max)
    .map((e) => `${e.n} ${e.unit}${e.n > 1 ? 's' : ''}`);
  if (!parts.length) return 'nothing to carry';
  return parts.join(', ');
};

/* ── CE QU'UNE SAUVEGARDE PORTE, EN CLAIR ────────────────────────────────────
   Les COMPTES disent COMBIEN ; les NOMS disent QUOI. « Mes expériences sont-
   elles dans ce fichier ? » ne se répond pas avec « 81 » : un en-tête qui NOMME
   (« CD », « BG04_ », « 1YCR ») se lit à l'œil nu, sans rien décompresser —
   c'est le même esprit que `counts`, appliqué aux noms.

   Deux propriétés, et elles tiennent tout le mécanisme :
     • le résumé est toujours tiré de la CHARGE (voir `buildBackupDocument`),
       jamais d'un appelant : il ne peut donc pas dire autre chose que ce que le
       fichier porte ;
     • ce n'est PAS un second contrôle. Ce qui décide d'un import, ce sont les
       comptes ; les noms servent à l'œil de qui ouvre le fichier. */
export const BACKUP_SUMMARY_MAX = 24;
export const BACKUP_SUMMARY_NAME_MAX = 120;
/** La seule limite de l'en-tête, dite telle quelle (les comptes, eux, sont
 *  complets : c'est la charge qui les porte EN ENTIER). */
export const BACKUP_SUMMARY_NOTE = `the counts above are the complete ones — each list stops at ${BACKUP_SUMMARY_MAX} names`;

/** Un nom tient sur UNE ligne : les retours et les espaces multiples sont
 *  ramenés à une espace, et un nom démesuré est coupé (le « … » le dit). PUR. */
const cleanName = (value) => {
  if (value === undefined || value === null || typeof value === 'object') return '';
  const flat = String(value).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > BACKUP_SUMMARY_NAME_MAX ? `${flat.slice(0, BACKUP_SUMMARY_NAME_MAX).trimEnd()}…` : flat;
};

/** Le nom d'un élément : une CHAÎNE est son propre nom (les bibliothèques
 *  acceptent un nom écrit à la main — voir utils/libraryCsv.js), un OBJET est lu
 *  par ses champs, le premier non vide des `fields` (un protocole porte un
 *  `title`, une expérience et un meuble un `name`). PUR : ne lève jamais. */
const nameOf = (item, fields = []) => {
  if (typeof item === 'string' || typeof item === 'number') return cleanName(item);
  if (!item || typeof item !== 'object') return '';
  for (let i = 0; i < fields.length; i += 1) {
    const found = cleanName(item[fields[i]]);
    if (found) return found;
  }
  return '';
};

/** Les noms d'une collection : les CLÉS d'une carte (`compoundMeta`,
 *  `calculationEntries` — l'app y range ses entrées PAR nom de composé, c'est
 *  ainsi qu'elle les relit), sinon les noms des éléments d'une liste. Sans
 *  doublon (« test31 » deux fois n'apprend rien) et pas plus de
 *  `BACKUP_SUMMARY_MAX` : le reste est dans la charge, pas dans l'en-tête. PUR. */
const namesOf = (value, fields = []) => {
  const raw = Array.isArray(value)
    ? value.map((item) => nameOf(item, fields))
    : (value && typeof value === 'object' ? Object.keys(value) : [nameOf(value, fields)]);
  const names = [];
  raw.forEach((name) => {
    if (!name || names.includes(name) || names.length >= BACKUP_SUMMARY_MAX) return;
    names.push(name);
  });
  return names;
};

/** LE RÉSUMÉ d'un état — ce qu'une sauvegarde porte, NOMMÉ. Une collection vide
 *  n'y figure pas, comme un compte nul ne figure pas dans la phrase des comptes.
 *  La `note` ferme la liste et dit sa seule limite. PUR. */
export const backupSummaryOf = (state) => {
  const src = state && typeof state === 'object' ? state : {};
  const summary = {};
  BACKUP_COUNT_KEYS.forEach(({ key, fields }) => {
    const names = namesOf(src[key], fields);
    if (names.length) summary[key] = names;
  });
  return { ...summary, note: BACKUP_SUMMARY_NOTE };
};

/** La charge compressée d'un état (le format rangé sur le Drive n'a pas
 *  changé). PUR. */
export const encodeBackupPayload = (state, compressed = true) => {
  const json = JSON.stringify(state === undefined ? null : state);
  return compressed === false ? json : LZString.compressToUTF16(json);
};

/** L'état relu d'une charge ; `null` si elle n'est pas lisible (le refus le
 *  dira). PUR : aucune exception ne sort d'ici. */
export const decodeBackupState = (payload, compressed = true) => {
  const raw = text(payload);
  if (!raw) return null;
  const json = compressed === false ? raw : (LZString.decompressFromUTF16(raw) || '');
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
};

/* ── L'ÉCRITURE ──────────────────────────────────────────────────────────────
   `buildBackupDocument` fabrique LE document ; `backupDocumentText` le rend
   lisible tel quel (un humain qui ouvre le fichier doit voir ce qu'il contient
   sans rien décompresser). */

/** Le document de sauvegarde, complet et auto-descriptif. PUR.
 *  Les comptes sont ceux de l'état s'ils ne sont pas donnés — donc jamais
 *  absents : un fichier sans comptes ne pourrait pas être validé à la relecture.
 *  Le RÉSUMÉ (les noms) est lui aussi toujours celui de la charge : il ne peut
 *  donc jamais annoncer autre chose que ce que le fichier porte. */
export const buildBackupDocument = ({
  payload = '', title = '', subtitle = '', datasetId = '', savedAt = 0,
  counts = null, compressed = true
} = {}) => {
  /* L'état est décodé UNE fois : les comptes ET les noms disent ce que la charge
     porte vraiment — jamais ce qu'un appelant annonce à sa place. */
  const state = decodeBackupState(payload, compressed !== false);
  return {
    format: BACKUP_FORMAT,
    schema: BACKUP_SCHEMA,
    savedAt: Number(savedAt) || 0,
    datasetId: text(datasetId),
    title: text(title) || 'Untitled Dataset',
    subtitle: text(subtitle),
    compressed: compressed !== false,
    counts: counts && typeof counts === 'object' ? counts : backupCountsOf(state),
    summary: backupSummaryOf(state),
    payload: String(payload || '')
  };
};

/** Le texte du fichier (JSON indenté : lisible à l'œil nu). PUR. */
export const backupDocumentText = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

/** Le nom du fichier — MÊME règle pour la sauvegarde hebdomadaire et pour
 *  l'enregistrement manuel, donc deux datasets de même titre ne se recouvrent
 *  jamais (le fragment d'identifiant tranche). PUR. */
export const backupFileName = ({ title = '', datasetId = '', dateStr = '', kind = 'backup' } = {}) => {
  const slug = sanitizeSlug(text(title)) || 'dataset';
  const idTag = String(datasetId || '').replace(/[^a-z0-9]/gi, '').slice(-6) || 'ds';
  const date = text(dateStr) || new Date().toISOString().slice(0, 10);
  return `${slug}_${idTag}_${text(kind) || 'backup'}_${date}.json`;
};

/** Le dossier de sauvegarde du dataset — la place canonique, jamais un second
 *  dossier au nom du dataset à la racine. PUR. */
export const backupFolderOf = (title) => `${datasetFolderSlug(text(title))}/backups`;

/* ── LA VALIDATION ───────────────────────────────────────────────────────────
   Ce qui est vérifié, dans cet ordre : le document existe, il est de CE format,
   sa VERSION est connue, sa charge est là et se décode, et ses COMPTES déclarés
   concordent avec ce qu'elle porte réellement. */
export const validateBackupDocument = (doc) => {
  const problems = [];
  const d = doc && typeof doc === 'object' ? doc : null;
  if (!d) {
    return { ok: false, problems: ['this file does not contain a backup document'], mismatched: [], state: null, actual: null, declared: null };
  }
  if (text(d.format) !== BACKUP_FORMAT) problems.push(`this is not a Lab Workspace backup (format “${text(d.format) || 'absent'}”)`);
  const schema = Number(d.schema) || 0;
  if (!SUPPORTED_SCHEMAS.includes(schema)) {
    problems.push(schema > BACKUP_SCHEMA
      ? `this backup was written by a NEWER version of the app (schema ${schema}; this one reads ${BACKUP_SCHEMA})`
      : `this backup announces an unknown format version (schema ${Number(d.schema) || 'absent'})`);
  }
  if (typeof d.payload !== 'string' || !d.payload) problems.push('the backup carries no payload');
  const state = problems.length ? null : decodeBackupState(d.payload, d.compressed !== false);
  if (!problems.length && !state) problems.push('the payload could not be decoded (the file is truncated or has been edited)');
  const actual = state ? backupCountsOf(state) : null;
  const declared = d.counts && typeof d.counts === 'object' ? d.counts : null;
  /* La concordance ne se vérifie QUE si le fichier DÉCLARE des comptes : un
     ancien fichier HTML n'en portait pas, il n'y a donc rien à comparer — le
     lui reprocher serait un faux refus. */
  const mismatched = [];
  if (actual && declared) {
    Object.keys(declared).forEach((k) => {
      const dN = Number(declared[k]) || 0;
      const aN = Number(actual[k]) || 0;
      if (dN !== aN) mismatched.push({ key: k, declared: dN, actual: aN });
    });
  }
  return { ok: problems.length === 0 && mismatched.length === 0, problems, mismatched, state, actual, declared };
};

/** La phrase d'un REFUS : elle dit POURQUOI, jamais « échec » tout court. PUR. */
export const backupVerdictText = ({ problems = [], mismatched = [] } = {}) => {
  const parts = [];
  (Array.isArray(mismatched) ? mismatched : []).forEach((m) => {
    const unit = (BACKUP_COUNT_KEYS.find((k) => k.key === m.key) || {}).unit || m.key;
    parts.push(`it DECLARES ${m.declared} ${unit}${m.declared > 1 ? 's' : ''} but actually carries ${m.actual}`);
  });
  if (parts.length) {
    return `This backup does not match its own contents — ${parts.join('; ')}. `
      + 'Nothing was imported: the file is truncated or has been edited. Pick another backup (the older ones are still on the Drive).';
  }
  const first = (Array.isArray(problems) ? problems : [])[0];
  if (!first) return '';
  return `This file was not imported: ${first}.`;
};

/* ── LA LECTURE : JSON (le format d'aujourd'hui) ou HTML (les fichiers déjà
      écrits). Un seul point d'entrée, un seul verdict — c'est ce qui garantit
      que les DEUX formats passent par la MÊME validation et la MÊME adoption. */
export const parseBackupText = (rawText) => {
  const body = text(rawText);
  if (!body) {
    const problems = ['the file is empty'];
    return { ok: false, kind: '', doc: null, state: null, counts: null, problems, mismatched: [], reason: backupVerdictText({ problems }) };
  }

  /* ① LE FORMAT D'AUJOURD'HUI : un document JSON auto-descriptif. */
  if (body.trimStart().startsWith('{')) {
    let doc = null;
    try {
      doc = JSON.parse(body);
    } catch {
      const problems = ['the text is not valid JSON (the file has been edited or truncated)'];
      return { ok: false, kind: 'json', doc: null, state: null, counts: null, problems, mismatched: [], reason: backupVerdictText({ problems }) };
    }
    const v = validateBackupDocument(doc);
    return {
      ok: v.ok, kind: 'json', doc, state: v.state, counts: v.actual, declared: v.declared,
      problems: v.problems, mismatched: v.mismatched,
      reason: v.ok ? '' : backupVerdictText(v)
    };
  }

  /* ② LES FICHIERS DÉJÀ ÉCRITS : l'ancien HTML, dont la charge vit dans
     `<script id="saved-data-blob">`. Relu exactement comme avant — mais il ne
     déclarait pas de comptes, donc il n'y a rien à lui comparer. */
  const refuse = (msg) => {
    const problems = [msg];
    return { ok: false, kind: 'html', doc: null, state: null, counts: null, problems, mismatched: [], reason: backupVerdictText({ problems }) };
  };
  const match = body.match(BACKUP_BLOB_RE);
  if (!match) return refuse('no dataset data was found in this file (it is neither a backup document nor an older HTML backup)');

  let blob = null;
  try { blob = JSON.parse(match[1]); } catch {
    return refuse('the backup block of this HTML file could not be read (it has been edited or truncated)');
  }
  const state = decodeBackupState(blob && blob.payload, !(blob && blob.isCompressed === false));
  if (!state) return refuse('the payload of this HTML backup could not be decoded (it has been edited or truncated)');

  return {
    ok: true, kind: 'html', state, counts: backupCountsOf(state), declared: null, problems: [], mismatched: [], reason: '',
    doc: {
      format: BACKUP_LEGACY_FORMAT,
      schema: BACKUP_LEGACY_SCHEMA,
      savedAt: Number(blob && blob.savedAt) || 0,
      datasetId: text(blob && blob.datasetId),
      title: text(blob && blob.title) || 'Untitled Dataset',
      subtitle: text(blob && blob.subtitle),
      compressed: !(blob && blob.isCompressed === false),
      counts: null,
      /* La charge brute est rendue AUSSI : l'appelant en mesure la taille pour
         l'avertissement « limite du nuage », exactement comme avant. */
      payload: text(blob && blob.payload)
    }
  };
};
