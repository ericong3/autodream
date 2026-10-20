// Building tint project storage. Local (this browser) is the default.
// Online (shared across authorised PCs) is opt-in with
// VITE_GARAGE_BUILDING_STORAGE=online once the server bridge in
// api/garage-building/ is deployed and its migrations applied
// (docs/garage-building-online.md). There is no silent fallback: if online
// mode fails, the error is thrown and the caller keeps the user's unsaved
// document in memory. Local projects are never copied online automatically.
//
// Online calls go to our own server, which verifies a Garage session
// cookie and derives the actor itself; the browser never sends an actor id
// and never holds a database key.
import type { BuildingProject } from '../types/garageBuilding';
import { canEditBuildingProject, validateBuildingProject, type BuildingActor } from '../utils/garageBuilding.ts';

export type BuildingStorageErrorCode = 'FORBIDDEN' | 'CONFLICT' | 'INVALID' | 'NOT_FOUND' | 'SETUP' | 'CLOUD' | 'AUTH' | 'RATE_LIMITED';

export class BuildingStorageError extends Error {
  code: BuildingStorageErrorCode;
  retryAfter?: number;
  constructor(code: BuildingStorageErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'BuildingStorageError';
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; credentials: 'same-origin'; cache: 'no-store' }) => Promise<{ status: number; json(): Promise<unknown> }>;
export interface OnlineSession { user: { id: string; name: string; username: string; role: string; businessAccess: string }; expiresAt: string }
export interface BuildingStorageDeps {
  env?: { VITE_GARAGE_BUILDING_STORAGE?: string; VITE_GARAGE_BUILDING_API?: string };
  store?: KeyValueStore | null;
  fetch?: FetchLike;
  now?: () => string;
}

const KEY_PREFIX = 'autodream.garageBuilding.v1.';
const DEFAULT_API = '/api/garage-building';

function readEnv(): NonNullable<BuildingStorageDeps['env']> {
  try { return ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {}; } catch { return {}; }
}

function requireActor(user: BuildingActor | null | undefined): BuildingActor {
  if (!user?.id) throw new BuildingStorageError('FORBIDDEN', 'Sign in to use building projects.');
  if (user.businessAccess !== 'garage' && user.businessAccess !== 'both') throw new BuildingStorageError('FORBIDDEN', 'This account has no Garage access.');
  return user;
}

function assertValid(project: BuildingProject) {
  const errors = validateBuildingProject(project);
  if (errors.length) throw new BuildingStorageError('INVALID', errors[0]);
}

// Saved versions are append-only: every stored version must come back
// byte-for-byte, in order, and only new ones may follow.
function assertVersionsAppendOnly(stored: BuildingProject, incoming: BuildingProject) {
  if (incoming.versions.length < stored.versions.length) throw new BuildingStorageError('INVALID', 'Saved quote versions cannot be removed.');
  stored.versions.forEach((v, i) => {
    if (JSON.stringify(v) !== JSON.stringify(incoming.versions[i])) throw new BuildingStorageError('INVALID', `Quote version ${v.number} is saved and cannot be changed.`);
  });
}

export function isBuildingSetupError(error: unknown): boolean {
  return error instanceof BuildingStorageError && error.code === 'SETUP';
}
export function isBuildingAuthError(error: unknown): boolean {
  return error instanceof BuildingStorageError && error.code === 'AUTH';
}

const STATUS_CODES: Record<number, BuildingStorageErrorCode> = { 400: 'INVALID', 401: 'AUTH', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'INVALID', 415: 'INVALID', 422: 'INVALID', 429: 'RATE_LIMITED', 503: 'SETUP' };
const FALLBACK_MESSAGES: Partial<Record<BuildingStorageErrorCode, string>> = {
  AUTH: 'Sign in to Garage online saving.',
  SETUP: 'Shared building saving is not set up on the server yet.',
  RATE_LIMITED: 'Too many sign-in attempts. Wait and try again.',
};

export function createBuildingStorage(deps: BuildingStorageDeps = {}) {
  const env = deps.env ?? readEnv();
  const mode: 'local' | 'online' = env.VITE_GARAGE_BUILDING_STORAGE === 'online' ? 'online' : 'local';
  const api = (env.VITE_GARAGE_BUILDING_API || DEFAULT_API).replace(/\/+$/, '');
  if (!api.startsWith('/') || api.startsWith('//') || api.includes('\\')) throw new BuildingStorageError('SETUP', 'Garage online saving must use this website.');
  const now = deps.now ?? (() => new Date().toISOString());

  // ── Local: one key per signed-in user. Nobody (managers included) can
  // enumerate another user's key on a shared device.
  function store(): KeyValueStore {
    const s = deps.store !== undefined ? deps.store : (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (!s) throw new BuildingStorageError('SETUP', 'This browser has no local storage for building projects.');
    return s;
  }
  function readOwn(actorId: string): Record<string, BuildingProject> {
    const raw = store().getItem(KEY_PREFIX + actorId);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new BuildingStorageError('INVALID', 'Saved building projects on this device are unreadable.');
    }
  }
  function writeOwn(actorId: string, all: Record<string, BuildingProject>) {
    store().setItem(KEY_PREFIX + actorId, JSON.stringify(all));
  }

  async function localSave(project: BuildingProject, user: BuildingActor): Promise<BuildingProject> {
    const all = readOwn(user.id);
    const stored = all[project.id];
    if (!stored) {
      if (project.revision !== 0) throw new BuildingStorageError('CONFLICT', 'This project is not on this device. Reload before saving.');
      if (project.ownerId !== user.id) throw new BuildingStorageError('FORBIDDEN', 'New projects must belong to you.');
    } else {
      if (stored.ownerId !== project.ownerId) throw new BuildingStorageError('FORBIDDEN', 'A project with this id already belongs to someone else.');
      if (!canEditBuildingProject(stored, user)) throw new BuildingStorageError('FORBIDDEN', 'You cannot edit this building project.');
      if (stored.revision !== project.revision) throw new BuildingStorageError('CONFLICT', 'This project changed since you opened it. Reload to see the latest.');
      assertVersionsAppendOnly(stored, project);
    }
    const ts = now();
    const saved: BuildingProject = { ...structuredClone(project), revision: project.revision + 1, createdAt: stored?.createdAt ?? ts, updatedAt: ts };
    all[saved.id] = saved;
    writeOwn(user.id, all);
    return structuredClone(saved);
  }

  // ── Online: our server bridge. Same-origin cookie + custom header; the
  // server repeats every check and the database repeats them again.
  async function request(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, expectedUser?: string): Promise<Record<string, unknown>> {
    const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!doFetch) throw new BuildingStorageError('SETUP', 'This browser cannot reach Garage online saving.');
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Garage-Building': '1' };
    if (expectedUser) headers['X-Garage-User'] = expectedUser;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new BuildingStorageError('CLOUD', 'Garage online saving is unreachable. Check the connection and try again.');
    }
    let data: Record<string, unknown> = {};
    try { const parsed = await res.json(); if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>; } catch { /* handled below */ }
    if (res.status >= 200 && res.status < 300) return data;
    const err = (data.error ?? {}) as { message?: unknown; retryAfter?: unknown };
    const code = STATUS_CODES[res.status] ?? 'CLOUD';
    const message = typeof err.message === 'string' && err.message ? err.message.slice(0, 300) : FALLBACK_MESSAGES[code] ?? 'Garage online saving failed. Try again.';
    throw new BuildingStorageError(code, message, typeof err.retryAfter === 'number' ? err.retryAfter : undefined);
  }
  function fromServer(value: unknown): BuildingProject {
    const p = value as BuildingProject | null;
    if (!p || typeof p !== 'object' || !Number.isInteger(p.revision) || validateBuildingProject(p).length) {
      throw new BuildingStorageError('CLOUD', 'Garage online saving returned an unexpected building project.');
    }
    return p;
  }

  return {
    mode,
    async list(user: BuildingActor): Promise<BuildingProject[]> {
      const actor = requireActor(user);
      if (mode === 'online') {
        const data = await request('/projects', 'GET', undefined, actor.id);
        if (!Array.isArray(data.projects)) throw new BuildingStorageError('CLOUD', 'Garage online saving returned an unexpected project list.');
        return data.projects.map(fromServer);
      }
      return Object.values(readOwn(actor.id))
        .map(p => { assertValid(p); return p; })
        .filter(p => canEditBuildingProject(p, actor))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(p => structuredClone(p));
    },
    async get(id: string, user: BuildingActor): Promise<BuildingProject | null> {
      const actor = requireActor(user);
      if (mode === 'online') {
        try {
          return fromServer((await request(`/projects?id=${encodeURIComponent(id)}`, 'GET', undefined, actor.id)).project);
        } catch (e) {
          if (e instanceof BuildingStorageError && e.code === 'NOT_FOUND') return null;
          throw e;
        }
      }
      const p = readOwn(actor.id)[id];
      if (!p) return null;
      assertValid(p);
      if (!canEditBuildingProject(p, actor)) throw new BuildingStorageError('FORBIDDEN', 'You cannot open this building project.');
      return structuredClone(p);
    },
    async save(project: BuildingProject, user: BuildingActor): Promise<BuildingProject> {
      const actor = requireActor(user);
      assertValid(project);
      if (!canEditBuildingProject(project, actor)) throw new BuildingStorageError('FORBIDDEN', 'You cannot edit this building project.');
      if (mode === 'online') return fromServer((await request('/projects', 'PUT', { project }, actor.id)).project);
      return localSave(project, actor);
    },
    // ── Garage online session (online mode only) ──
    async session(): Promise<OnlineSession | null> {
      if (mode !== 'online') return null;
      try {
        return toSession(await request('/session', 'GET'));
      } catch (e) {
        if (isBuildingAuthError(e)) return null;
        throw e;
      }
    },
    async signIn(username: string, password: string): Promise<OnlineSession> {
      if (mode !== 'online') throw new BuildingStorageError('SETUP', 'Online saving is not enabled.');
      return toSession(await request('/session', 'POST', { username, password }));
    },
    async signOut(): Promise<void> {
      if (mode !== 'online') return;
      await request('/session', 'DELETE');
    },
    async activate(username: string, code: string, password: string): Promise<void> {
      if (mode !== 'online') throw new BuildingStorageError('SETUP', 'Online saving is not enabled.');
      const data = await request('/activate', 'POST', { username, code, password });
      if (data.activated !== true) throw new BuildingStorageError('CLOUD', 'Password setup could not be confirmed. Try signing in or ask your manager.');
    },
  };
}

function toSession(data: Record<string, unknown>): OnlineSession {
  const user = data.user as OnlineSession['user'] | undefined;
  if (!user || typeof user.id !== 'string' || typeof data.expiresAt !== 'string') {
    throw new BuildingStorageError('CLOUD', 'Garage online saving returned an unexpected session.');
  }
  return { user, expiresAt: data.expiresAt };
}

// The app-wide instance. Tests build their own with createBuildingStorage.
const defaultStorage = createBuildingStorage();

export function buildingStorageMode(): 'local' | 'online' { return defaultStorage.mode; }
export function listBuildingProjects(user: BuildingActor): Promise<BuildingProject[]> { return defaultStorage.list(user); }
export function getBuildingProject(id: string, user: BuildingActor): Promise<BuildingProject | null> { return defaultStorage.get(id, user); }
export function saveBuildingProject(project: BuildingProject, user: BuildingActor): Promise<BuildingProject> { return defaultStorage.save(project, user); }
export function getOnlineSession(): Promise<OnlineSession | null> { return defaultStorage.session(); }
export function signInOnline(username: string, password: string): Promise<OnlineSession> { return defaultStorage.signIn(username, password); }
export function signOutOnline(): Promise<void> { return defaultStorage.signOut(); }
export function activateOnline(username: string, code: string, password: string): Promise<void> { return defaultStorage.activate(username, code, password); }
