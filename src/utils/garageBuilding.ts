// Building tint project logic — pure functions, no storage, no pricing.
// The quote here is measured scope (sqft + which panes still need checking)
// captured as immutable versions. Invoices, payments and installation keep
// running through the existing Garage car flow until a building backend is
// reviewed; nothing in this file invents a building rate.
//
// Units: pane and room sizes are inches; areas are square feet.
import type { TintSeries } from '../types';
import type {
  BuildingFloor, BuildingPane, BuildingProject, BuildingQuoteVersion, BuildingRoom, BuildingWall, BuildingWindow,
} from '../types/garageBuilding';

// The real Garage tint series (same labels as tintPricing's TINT_SERIES).
export const BUILDING_FILMS: { key: TintSeries; label: string }[] = [
  { key: 'royal', label: 'Royal' },
  { key: 'unique', label: 'Unique' },
  { key: 'majestic', label: 'Majestic' },
  { key: 'classic', label: 'Classic' },
  { key: 'lite', label: 'Lite' },
  { key: 'eco', label: 'Eco' },
];

export const BUILDING_LIMITS = {
  maxPanes: 24,
  maxGrid: 4,
  maxPaneInches: 2400,
  maxRoomInches: 12000,
  maxVerifiedSqft: 10000,
  maxText: 200,
  maxNote: 80,
} as const;

const WALLS: BuildingWall[] = ['N', 'E', 'S', 'W'];
const KINDS: BuildingWindow['kind'][] = ['window', 'sliding', 'custom'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Malaysian IC number shape — never allowed as the customer reference.
const IC_RE = /^\d{6}-?\d{2}-?\d{4}$/;
const PANE_KEYS = ['width', 'height', 'measured', 'shape', 'verifiedArea', 'photoReference', 'note'] as const;
const PROJECT_KEYS = new Set(['schema', 'id', 'ownerId', 'customerId', 'customerName', 'phone', 'title', 'address',
  'floors', 'rooms', 'windows', 'versions', 'revision', 'createdAt', 'updatedAt']);

export function newBuildingId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${raw.slice(0, 24)}`;
}

const clone = <T>(v: T): T => structuredClone(v);
const isPosFinite = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function createBuildingProject(ownerId: string): BuildingProject {
  if (!ID_RE.test(ownerId ?? '')) throw new Error('A signed-in Garage user is required to start a building project.');
  const now = new Date().toISOString();
  return {
    schema: 1, id: newBuildingId('bld'), ownerId,
    customerName: '', phone: '', title: '', address: '',
    floors: [{ id: newBuildingId('fl'), name: 'L1' }, { id: newBuildingId('fl'), name: 'L2' }],
    rooms: [], windows: [], versions: [], revision: 0, createdAt: now, updatedAt: now,
  };
}

// ── Area ────────────────────────────────────────────────────────────────
// A custom-shaped pane counts its verified area once one is entered;
// until then it falls back to its bounding rectangle (and is flagged).
export function paneArea(p: BuildingPane): number {
  if (p.shape === 'custom') return isPosFinite(p.verifiedArea, BUILDING_LIMITS.maxVerifiedSqft) ? p.verifiedArea as number : 0;
  return (p.width * p.height) / 144;
}

export function windowArea(w: BuildingWindow): number {
  return w.panes.reduce((sum, p) => sum + paneArea(p), 0);
}

// Tall glass is stored once on its base room, so it's counted once.
export function projectArea(doc: Pick<BuildingProject, 'windows'>): number {
  return doc.windows.reduce((sum, w) => sum + windowArea(w), 0);
}

export function measurementIssues(p: BuildingPane): string[] {
  const issues: string[] = [];
  if (!isPosFinite(p.width, BUILDING_LIMITS.maxPaneInches) || !isPosFinite(p.height, BUILDING_LIMITS.maxPaneInches)) issues.push('Missing size');
  if (p.measured !== true) issues.push('Measurements not checked');
  if (p.shape === 'custom' && !isPosFinite(p.verifiedArea, BUILDING_LIMITS.maxVerifiedSqft)) issues.push('Custom shape needs a verified area');
  if (p.shape === 'custom' && !p.photoReference?.trim()) issues.push('Photo reference missing');
  return issues;
}

function uncheckedCount(windows: BuildingWindow[]): number {
  return windows.reduce((n, w) => n + w.panes.filter(p => measurementIssues(p).length > 0).length, 0);
}

// ── Validation ──────────────────────────────────────────────────────────
function textOk(v: unknown, max: number = BUILDING_LIMITS.maxText) { return typeof v === 'string' && v.length <= max; }
function optText(v: unknown, max: number = BUILDING_LIMITS.maxText) { return v === undefined || textOk(v, max); }

function validateRooms(rooms: unknown, floorIds: Set<string>, where: string, errors: string[]): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(rooms)) { errors.push(`${where}: rooms must be a list`); return ids; }
  for (const r of rooms as BuildingRoom[]) {
    const tag = `${where} room ${String(r?.id)}`;
    if (!r || !ID_RE.test(r.id)) { errors.push(`${tag}: invalid id`); continue; }
    if (ids.has(r.id)) errors.push(`${tag}: duplicate id`);
    ids.add(r.id);
    if (!floorIds.has(r.floorId)) errors.push(`${tag}: unknown floor`);
    if (!textOk(r.name, 120)) errors.push(`${tag}: invalid name`);
    if (!isPosFinite(r.width, BUILDING_LIMITS.maxRoomInches) || !isPosFinite(r.depth, BUILDING_LIMITS.maxRoomInches)) errors.push(`${tag}: width and depth must be positive numbers`);
    if (!Number.isFinite(r.x) || !Number.isFinite(r.z)) errors.push(`${tag}: position must be a number`);
  }
  return ids;
}

function validateWindows(windows: unknown, rooms: BuildingRoom[], floors: BuildingFloor[], where: string, errors: string[]) {
  if (!Array.isArray(windows)) { errors.push(`${where}: windows must be a list`); return; }
  const roomById = new Map(rooms.map(r => [r.id, r]));
  const floorIndex = new Map(floors.map((f, i) => [f.id, i]));
  const windowIds = new Set<string>();
  const paneIds = new Set<string>();
  const films = new Set<string>(BUILDING_FILMS.map(f => f.key));
  for (const w of windows as BuildingWindow[]) {
    const tag = `${where} window ${String(w?.id)}`;
    if (!w || !ID_RE.test(w.id)) { errors.push(`${tag}: invalid id`); continue; }
    if (windowIds.has(w.id)) errors.push(`${tag}: duplicate id`);
    windowIds.add(w.id);
    const room = roomById.get(w.roomId);
    if (!room) errors.push(`${tag}: unknown room`);
    if (!textOk(w.label, 60)) errors.push(`${tag}: invalid label`);
    if (!KINDS.includes(w.kind)) errors.push(`${tag}: invalid kind`);
    if (!WALLS.includes(w.wall)) errors.push(`${tag}: invalid wall`);
    if (typeof w.position !== 'number' || !(w.position >= 0 && w.position <= 1)) errors.push(`${tag}: position must be between 0 and 1`);
    if (!films.has(w.film)) errors.push(`${tag}: unknown film`);
    if (!Array.isArray(w.panes) || w.panes.length < 1 || w.panes.length > BUILDING_LIMITS.maxPanes) {
      errors.push(`${tag}: needs 1–${BUILDING_LIMITS.maxPanes} panes`); continue;
    }
    if (w.span !== undefined) {
      const s = w.span;
      const okGrid = Number.isInteger(s?.rows) && Number.isInteger(s?.cols) && s.rows >= 1 && s.cols >= 1 && s.rows <= BUILDING_LIMITS.maxGrid && s.cols <= BUILDING_LIMITS.maxGrid;
      if (!okGrid) errors.push(`${tag}: tall glass grid must be 1–${BUILDING_LIMITS.maxGrid} rows and columns`);
      else if (w.panes.length !== s.rows * s.cols) errors.push(`${tag}: tall glass needs exactly rows × columns panes`);
      const to = floorIndex.get(s?.toFloorId);
      const from = room ? floorIndex.get(room.floorId) : undefined;
      if (to === undefined || from === undefined || to <= from) errors.push(`${tag}: tall glass must reach a higher floor`);
      if (typeof s?.bottom !== 'number' || !Number.isFinite(s.bottom) || s.bottom < 0) errors.push(`${tag}: tall glass bottom must be zero or more`);
      if (okGrid) {
        const cells = new Set<string>();
        for (const p of w.panes) {
          if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col) || (p.row as number) >= s.rows || (p.col as number) >= s.cols || (p.row as number) < 0 || (p.col as number) < 0) {
            errors.push(`${tag}: pane ${String(p?.id)} is outside the grid`); continue;
          }
          const cell = `${p.row}:${p.col}`;
          if (cells.has(cell)) errors.push(`${tag}: two panes in one grid cell`);
          cells.add(cell);
        }
      }
    }
    for (const p of w.panes) {
      const ptag = `${tag} pane ${String(p?.id)}`;
      if (!p || !ID_RE.test(p.id)) { errors.push(`${ptag}: invalid id`); continue; }
      if (paneIds.has(p.id)) errors.push(`${ptag}: duplicate id`);
      paneIds.add(p.id);
      if (!isPosFinite(p.width, BUILDING_LIMITS.maxPaneInches) || !isPosFinite(p.height, BUILDING_LIMITS.maxPaneInches)) errors.push(`${ptag}: width and height must be positive numbers`);
      if (typeof p.measured !== 'boolean') errors.push(`${ptag}: measured must be true or false`);
      if (p.shape !== 'rect' && p.shape !== 'custom') errors.push(`${ptag}: invalid shape`);
      if (p.verifiedArea !== undefined && (p.shape !== 'custom' || !isPosFinite(p.verifiedArea, BUILDING_LIMITS.maxVerifiedSqft))) errors.push(`${ptag}: verified area is only for custom panes and must be positive`);
      if (!optText(p.photoReference, 120) || !optText(p.note, 120)) errors.push(`${ptag}: note too long`);
    }
  }
}

// Structural check for saving a draft. Customer, phone and address may be
// blank; ids, references, sizes and versions must be sound.
export function validateBuildingProject(doc: BuildingProject): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object') return ['Project is missing'];
  for (const key of Object.keys(doc)) if (!PROJECT_KEYS.has(key)) errors.push(`Unexpected field: ${key}`);
  if (doc.schema !== 1) errors.push('Unsupported project schema');
  if (!ID_RE.test(doc.id ?? '')) errors.push('Invalid project id');
  if (!ID_RE.test(doc.ownerId ?? '')) errors.push('Invalid owner');
  if (doc.customerId !== undefined && (!ID_RE.test(doc.customerId) || IC_RE.test(doc.customerId))) errors.push('Customer reference must be a Garage customer id, not an IC number');
  for (const k of ['customerName', 'phone', 'title', 'address'] as const) if (!textOk(doc[k])) errors.push(`Invalid ${k}`);
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push('Invalid revision');
  if (!textOk(doc.createdAt, 40) || !textOk(doc.updatedAt, 40)) errors.push('Invalid timestamps');

  const floorIds = new Set<string>();
  if (!Array.isArray(doc.floors) || doc.floors.length < 1 || doc.floors.length > 20) errors.push('Needs 1–20 floors');
  else for (const f of doc.floors) {
    if (!f || !ID_RE.test(f.id) || floorIds.has(f.id)) errors.push(`Invalid floor ${String(f?.id)}`);
    else floorIds.add(f.id);
    if (!textOk(f?.name, 40)) errors.push(`Invalid floor name ${String(f?.id)}`);
  }
  validateRooms(doc.rooms, floorIds, 'Project', errors);
  if (Array.isArray(doc.rooms)) validateWindows(doc.windows, doc.rooms, doc.floors ?? [], 'Project', errors);

  if (!Array.isArray(doc.versions)) errors.push('Versions must be a list');
  else doc.versions.forEach((v, i) => validateVersion(v, i + 1, doc.floors ?? [], floorIds, errors));
  return errors;
}

function validateVersion(v: BuildingQuoteVersion, expectedNumber: number, floors: BuildingFloor[], floorIds: Set<string>, errors: string[]) {
  const where = `Version ${String(v?.number)}`;
  if (!v || !ID_RE.test(v.id)) { errors.push(`${where}: invalid id`); return; }
  if (v.number !== expectedNumber) errors.push(`${where}: versions must be numbered 1, 2, 3…`);
  if (!textOk(v.createdAt, 40) || !textOk(v.note, BUILDING_LIMITS.maxNote)) errors.push(`${where}: invalid date or note`);
  if (typeof v.sqft !== 'number' || !Number.isFinite(v.sqft) || v.sqft < 0) errors.push(`${where}: invalid sqft`);
  if (!Number.isInteger(v.unchecked) || v.unchecked < 0) errors.push(`${where}: invalid unchecked count`);
  if (!textOk(v.customerName) || !textOk(v.address)) errors.push(`${where}: invalid customer`);
  // Snapshots keep their own rooms; floors are checked against the current
  // list since floors are never removed by these helpers.
  validateRooms(v.rooms, floorIds, where, errors);
  if (Array.isArray(v.rooms)) validateWindows(v.windows, v.rooms, floors, where, errors);
  if (Array.isArray(v.windows) && v.windows.length === 0) errors.push(`${where}: has no windows`);
}

function assertValid(doc: BuildingProject) {
  const errors = validateBuildingProject(doc);
  if (errors.length) throw new Error(errors[0]);
  return doc;
}

function findWindow(doc: BuildingProject, windowId: string): BuildingWindow {
  const w = doc.windows.find(x => x.id === windowId);
  if (!w) throw new Error('Window not found');
  return w;
}

// ── Edits (all pure: return a new document) ────────────────────────────
// Changing a size, shape or verified area unchecks the pane unless the
// patch itself says measured: true (the UI's confirmed checkbox).
export function updateBuildingPane(doc: BuildingProject, windowId: string, paneId: string, patch: Partial<BuildingPane>, wholeSet = false): BuildingProject {
  const next = clone(doc);
  const win = findWindow(next, windowId);
  const target = win.panes.find(p => p.id === paneId);
  if (!target) throw new Error('Pane not found');
  const clean: Partial<BuildingPane> = {};
  for (const k of PANE_KEYS) if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  const sizeKeys = ['width', 'height'] as const;
  const targets = wholeSet ? win.panes : [target];
  if (wholeSet && targets.some(p => p.shape === 'custom') && sizeKeys.some(k => k in clean)) {
    throw new Error('Custom glass needs its own verified area. Edit those panes individually.');
  }
  for (const pane of targets) {
    const before = { width: pane.width, height: pane.height, shape: pane.shape, verifiedArea: pane.verifiedArea };
    // Only the chosen pane takes shape / area / photo / note; the whole set shares sizes and the checked flag.
    const own = pane === target ? clean : { ...(('width' in clean) ? { width: clean.width } : {}), ...(('height' in clean) ? { height: clean.height } : {}), ...(('measured' in clean) ? { measured: clean.measured } : {}) };
    Object.assign(pane, own);
    if (pane.shape === 'rect') delete pane.verifiedArea;
    const changed = before.width !== pane.width || before.height !== pane.height || before.shape !== pane.shape || before.verifiedArea !== pane.verifiedArea;
    if (changed && clean.measured !== true) pane.measured = false;
  }
  return assertValid(next);
}

// Copy a window to a new opening: film, kind, span and each pane's own
// size are kept; ids are fresh and every pane needs checking again.
export function duplicateBuildingWindow(doc: BuildingProject, windowId: string, targetRoomId: string, wall: BuildingWall): BuildingProject {
  const next = clone(doc);
  const src = findWindow(next, windowId);
  const room = next.rooms.find(r => r.id === targetRoomId);
  if (!room) throw new Error('Room not found');
  if (src.span) {
    const srcRoom = next.rooms.find(r => r.id === src.roomId);
    if (srcRoom?.floorId !== room.floorId) throw new Error('Tall glass copies must stay on the same base floor.');
  }
  const copy: BuildingWindow = {
    ...clone(src), id: newBuildingId('win'), roomId: room.id, wall,
    label: src.label ? `${src.label} copy`.slice(0, 60) : '',
    panes: src.panes.map(p => {
      const pane: BuildingPane = { ...p, id: newBuildingId('pn'), measured: false };
      delete pane.verifiedArea;
      delete pane.photoReference;
      return pane;
    }),
  };
  next.windows.push(copy);
  return assertValid(next);
}

export function removeBuildingRoom(doc: BuildingProject, roomId: string): BuildingProject {
  if (!doc.rooms.some(r => r.id === roomId)) throw new Error('Room not found');
  const next = clone(doc);
  next.rooms = next.rooms.filter(r => r.id !== roomId);
  next.windows = next.windows.filter(w => w.roomId !== roomId);
  return next;
}

export function removeBuildingWindow(doc: BuildingProject, windowId: string): BuildingProject {
  findWindow(doc, windowId);
  const next = clone(doc);
  next.windows = next.windows.filter(w => w.id !== windowId);
  return next;
}

// Change the pane count (ordinary window) or the grid (tall glass).
// Surviving panes keep their id, size and checked flag; new panes take the
// given size, are plain rectangles and start unchecked.
export function resizeBuildingPanels(doc: BuildingProject, windowId: string, countOrGrid: number | { rows: number; cols: number }, width: number, height: number): BuildingProject {
  if (!isPosFinite(width, BUILDING_LIMITS.maxPaneInches) || !isPosFinite(height, BUILDING_LIMITS.maxPaneInches)) throw new Error('Width and height must be positive numbers.');
  const next = clone(doc);
  const win = findWindow(next, windowId);
  const fresh = (extra: Partial<BuildingPane> = {}): BuildingPane => ({ id: newBuildingId('pn'), width, height, measured: false, shape: win.kind === 'custom' ? 'custom' : 'rect', ...extra });
  if (typeof countOrGrid === 'number') {
    if (win.span) throw new Error('Tall glass is resized by rows and columns.');
    if (!Number.isInteger(countOrGrid) || countOrGrid < 1 || countOrGrid > BUILDING_LIMITS.maxPanes) throw new Error(`Panels must be 1–${BUILDING_LIMITS.maxPanes}.`);
    const kept = win.panes.slice(0, countOrGrid);
    while (kept.length < countOrGrid) kept.push(fresh());
    win.panes = kept;
  } else {
    const { rows, cols } = countOrGrid;
    if (!win.span) throw new Error('Only tall glass has a grid.');
    if (![rows, cols].every(n => Number.isInteger(n) && n >= 1 && n <= BUILDING_LIMITS.maxGrid)) throw new Error(`Rows and columns must be 1–${BUILDING_LIMITS.maxGrid}.`);
    const panes: BuildingPane[] = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      panes.push(win.panes.find(p => p.row === row && p.col === col) ?? fresh({ row, col }));
    }
    win.panes = panes;
    win.span = { ...win.span, rows, cols };
  }
  return assertValid(next);
}

// Freeze the current measured scope as the next quote version. No prices.
// Unchecked panes are allowed — the version records how many.
export function saveBuildingVersion(doc: BuildingProject, note: string): BuildingProject {
  assertValid(doc);
  if (doc.windows.length === 0) throw new Error('Add at least one window before saving a quote version.');
  const next = clone(doc);
  const version: BuildingQuoteVersion = {
    id: newBuildingId('ver'),
    number: next.versions.length + 1,
    createdAt: new Date().toISOString(),
    note: String(note ?? '').trim().slice(0, BUILDING_LIMITS.maxNote),
    sqft: round2(projectArea(next)),
    unchecked: uncheckedCount(next.windows),
    rooms: clone(next.rooms),
    windows: clone(next.windows),
    customerName: next.customerName,
    address: next.address,
  };
  next.versions.push(version);
  return assertValid(next);
}

// ── Permissions ────────────────────────────────────────────────────────
// Garage managers (director / shareholder / garage head) can edit any
// building project; a Garage salesman only their own. Either way the
// account must have Garage business access.
export interface BuildingActor { id: string; role: string; businessAccess?: string }

export function hasGarageAccess(user: BuildingActor | null | undefined): boolean {
  return !!user && (user.businessAccess === 'garage' || user.businessAccess === 'both');
}

export function isBuildingManager(user: BuildingActor | null | undefined): boolean {
  return hasGarageAccess(user) && ['director', 'shareholder', 'garage_head'].includes(user!.role);
}

export function canEditBuildingProject(project: Pick<BuildingProject, 'ownerId'>, user: BuildingActor | null | undefined): boolean {
  if (!user || !hasGarageAccess(user)) return false;
  if (isBuildingManager(user)) return true;
  return user.role === 'garage_salesman' && project.ownerId === user.id;
}
