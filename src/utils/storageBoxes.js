/* =========================================================================
   src/utils/storageBoxes.js — les RÈGLES des boîtes de stockage.

   Une boîte (type `plate-9x9box`) n'est pas une expérience : c'est un
   EMPLACEMENT. Ce module ne sait rien de React ni de Drive — il porte ce qui
   doit être décidé de la même façon par l'écran, par les tests et par le
   rangement des dossiers :

     1. plusieurs boîtes peuvent vivre dans le MÊME emplacement (« empilées ») :
        leur position dans la pile est lisible (2/3), et un déplacement les
        répartit UNE PAR EMPLACEMENT avant d'en empiler deux ;
     2. une boîte 1 × 1 représente un échantillon EN VRAC (un seul puits) ;
     3. les champs obligatoires d'une boîte — nom de l'échantillon, propriétaire,
        date — au niveau de la boîte ET de chaque puits rempli ;
     4. ce qui arrive aux boîtes quand un emplacement est SUPPRIMÉ : on peut les
        déplacer d'abord, ou les laisser « sans emplacement » (elles ne sont
        jamais supprimées avec le meuble).
   ========================================================================= */
import { boxDimsOf, wellIsFilled, wellPositionLabel, wellValueOf } from './boxLabel';

/** Le type qui fait d'un test une boîte de stockage. */
export const STORAGE_BOX_TYPE = 'plate-9x9box';

/** Les deux tailles de boîte proposées à la création. */
export const BOX_SIZE_PRESETS = [
  { id: 'box9', label: '9 × 9 box', short: '9×9', rows: 9, cols: 9 },
  { id: 'bulk1', label: '1 × 1 — bulk sample', short: '1×1', rows: 1, cols: 1 }
];

export const isStorageBox = (test) =>
  String((test && test.type) || '').trim() === STORAGE_BOX_TYPE;

/** Les boîtes rangées dans un emplacement donné. */
export const boxesOfStorage = (tests, storageId) =>
  (Array.isArray(tests) ? tests : [])
    .filter((t) => isStorageBox(t) && String(t.storageId || '') === String(storageId || ''));

/** L'emplacement d'une boîte (nombre), ou `null` quand elle n'en a pas. */
export const slotIndexOf = (box) => {
  const raw = box && box.storageIndex;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Toutes les boîtes d'un emplacement, dans un ordre STABLE (jamais aléatoire). */
export const boxesInSlot = (tests, storageId, slotIndex) =>
  boxesOfStorage(tests, storageId)
    .filter((b) => slotIndexOf(b) === Number(slotIndex))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

/** Nombre d'emplacements d'un meuble (au moins 1). */
export const storageSlotCount = (storage) =>
  Math.max(1, Math.trunc(Number(storage && storage.rows) || 1) * Math.trunc(Number(storage && storage.cols) || 1));

/** « 2/3 » quand la boîte partage son emplacement, sinon ''. */
export const slotStackLabel = (tests, box) => {
  if (!box) return '';
  const slot = slotIndexOf(box);
  if (slot === null) return '';
  const stack = boxesInSlot(tests, box.storageId, slot);
  if (stack.length < 2) return '';
  const i = stack.findIndex((b) => b.id === box.id);
  return i < 0 ? '' : `${i + 1}/${stack.length}`;
};

/** Occupation d'un meuble : boîtes, emplacements occupés, emplacements libres. */
export const storageOccupancy = (storage, tests) => {
  const slots = storageSlotCount(storage);
  const boxes = boxesOfStorage(tests, storage && storage.id);
  const used = new Set();
  boxes.forEach((b) => {
    const i = slotIndexOf(b);
    if (i !== null && i < slots) used.add(i);
  });
  return { slots, boxes: boxes.length, used: used.size, free: slots - used.size };
};

/** L'emplacement qui reçoit la prochaine boîte : le MOINS rempli (un meuble se
 *  remplit donc un emplacement à la fois avant d'empiler quoi que ce soit). */
export const nextSlotIndex = (tests, storageId, totalSlots) => {
  const slots = Math.max(1, Math.trunc(Number(totalSlots) || 1));
  const loads = new Array(slots).fill(0);
  boxesOfStorage(tests, storageId).forEach((b) => {
    const i = slotIndexOf(b);
    if (i !== null && i < slots) loads[i] += 1;
  });
  let best = 0;
  for (let i = 1; i < slots; i += 1) if (loads[i] < loads[best]) best = i;
  return best;
};

/** Le même dataset, avec UNE boîte déplacée (un emplacement déjà occupé est
 *  accepté : c'est l'empilement). */
export const moveBoxToSlot = (tests, boxId, storageId, slotIndex) =>
  (Array.isArray(tests) ? tests : []).map((t) =>
    t.id === boxId ? { ...t, storageId, storageIndex: slotIndex } : t);

/** Toutes les boîtes d'un meuble reçoivent un AUTRE meuble (avant suppression) :
 *  une par emplacement d'abord, empilées seulement ensuite. */
export const assignBoxesToStorage = (tests, fromStorageId, targetStorageId, totalSlots) => {
  const list = Array.isArray(tests) ? tests : [];
  const moving = boxesOfStorage(list, fromStorageId)
    .slice()
    .sort((a, b) => (slotIndexOf(a) ?? 0) - (slotIndexOf(b) ?? 0) || String(a.id).localeCompare(String(b.id)));
  if (!moving.length) return list;
  const movingIds = new Set(moving.map((b) => b.id));
  const slots = Math.max(1, Math.trunc(Number(totalSlots) || 1));
  const loads = new Array(slots).fill(0);
  list.forEach((t) => {
    if (!isStorageBox(t) || String(t.storageId || '') !== String(targetStorageId || '') || movingIds.has(t.id)) return;
    const i = slotIndexOf(t);
    if (i !== null && i < slots) loads[i] += 1;
  });
  const placement = new Map();
  moving.forEach((box) => {
    let best = 0;
    for (let i = 1; i < slots; i += 1) if (loads[i] < loads[best]) best = i;
    loads[best] += 1;
    placement.set(box.id, best);
  });
  return list.map((t) => (placement.has(t.id)
    ? { ...t, storageId: targetStorageId, storageIndex: placement.get(t.id) }
    : t));
};

/** Les boîtes d'un meuble restent dans le dataset, mais SANS emplacement. */
export const unassignBoxesOfStorage = (tests, storageId) =>
  (Array.isArray(tests) ? tests : []).map((t) =>
    isStorageBox(t) && String(t.storageId || '') === String(storageId || '')
      ? { ...t, storageId: '', storageIndex: null }
      : t);

/** La liste des meubles, sans celui qu'on supprime. */
export const removeStorage = (storages, storageId) =>
  (Array.isArray(storages) ? storages : []).filter((s) => s.id !== storageId);


/* ── Les champs OBLIGATOIRES d'une boîte ──────────────────────────────────
   Nom de l'échantillon, propriétaire et date : sur la BOÎTE (une boîte 1 × 1
   EST un échantillon en vrac) et sur chaque PUITS rempli. Les clés sont celles
   du modèle : `name`, `boxOwner`, `date` ; pour un puits : `compound` (nom de
   l'échantillon), `sampleOwner`, `date`. */
export const BOX_REQUIRED_FIELDS = [
  { key: 'name', label: 'Sample name' },
  { key: 'boxOwner', label: 'Owner' },
  { key: 'date', label: 'Date' }
];

export const WELL_REQUIRED_FIELDS = [
  { key: 'compound', label: 'Sample name' },
  { key: 'sampleOwner', label: 'Owner' },
  { key: 'date', label: 'Date' }
];

const blank = (v) => String(v === null || v === undefined ? '' : v).trim() === '';

/** Les clés obligatoires manquantes au niveau de la BOÎTE. */
export const boxMissingRequired = (box) =>
  BOX_REQUIRED_FIELDS.filter((f) => blank(box && box[f.key])).map((f) => f.key);

/** Les clés obligatoires manquantes dans UN puits (objet déjà analysé). */
export const wellMissingRequired = (well) =>
  WELL_REQUIRED_FIELDS.filter((f) => blank(well && well[f.key])).map((f) => f.key);

/** Tout ce qui manque dans une boîte : la boîte elle-même + chaque puits rempli.
 *  @returns {Array<{scope:'box'|'well', field:string, label:string, pos?:string, message:string}>} */
export const requiredBoxIssues = (box) => {
  const issues = [];
  BOX_REQUIRED_FIELDS.forEach((f) => {
    if (!blank(box && box[f.key])) return;
    issues.push({
      scope: 'box', field: f.key, label: f.label,
      message: `${f.label} is required on the box`
    });
  });
  const grid = (box && box.grid) || [];
  const { rows, cols } = boxDimsOf(box);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const well = wellValueOf(grid, r, c);
      if (!wellIsFilled(well)) continue;
      const pos = wellPositionLabel(r, c);
      WELL_REQUIRED_FIELDS.forEach((f) => {
        if (!blank(well[f.key])) return;
        issues.push({
          scope: 'well', field: f.key, label: f.label, pos,
          message: `${f.label} is required in well ${pos}`
        });
      });
    }
  }
  return issues;
};

export const boxIsComplete = (box) => requiredBoxIssues(box).length === 0;

/** Une phrase courte pour l'écran : « 3 required fields missing: Owner, well A1 Date +1 ». */
export const describeBoxIssues = (issues, max = 3) => {
  const list = Array.isArray(issues) ? issues : [];
  if (!list.length) return '';
  const parts = list.slice(0, max).map((i) => (i.scope === 'well' ? `well ${i.pos} ${i.label}` : i.label));
  const more = list.length > parts.length ? ` +${list.length - parts.length}` : '';
  return `${list.length} required field${list.length > 1 ? 's' : ''} missing: ${parts.join(', ')}${more}`;
};

/** L'état de complétude de tout un meuble (les boîtes incomplètes sont listées
 *  pour être MONTRÉES, jamais masquées). */
export const storageCompleteness = (tests, storageId) => {
  const boxes = boxesOfStorage(tests, storageId);
  const incomplete = boxes
    .map((box) => ({ box, issues: requiredBoxIssues(box) }))
    .filter((r) => r.issues.length > 0);
  return { total: boxes.length, complete: boxes.length - incomplete.length, incomplete };
};

/** Les dimensions d'une taille du formulaire. */
export const presetById = (id) => BOX_SIZE_PRESETS.find((p) => p.id === id) || BOX_SIZE_PRESETS[0];

/** L'identifiant de taille d'une boîte existante (1 × 1 = échantillon en vrac). */
export const presetIdOfBox = (box) => {
  const { rows, cols } = boxDimsOf(box);
  return rows === 1 && cols === 1 ? 'bulk1' : 'box9';
};

/** « 1 × 1 (bulk sample) » — la taille se lit comme sur la page de la boîte. */
export const boxSizeLabel = (box) => {
  const { rows, cols } = boxDimsOf(box);
  return `${rows} × ${cols}${rows === 1 && cols === 1 ? ' (bulk sample)' : ''}`;
};

