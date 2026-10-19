// Garage building online bridge: session gate, CSRF, throttling, actor
// derivation and error mapping. Everything external is injected — no
// network, no real database, no real secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { handleSession, handleProjects, readConfig, COOKIE_NAME, LIMITS } from '../server/garageBuilding/core.mjs';
import { vercelHandler } from '../server/garageBuilding/vercel.mjs';

const ORIGIN = 'https://garage.example';
const ENV = {
  GARAGE_BUILDING_ONLINE: '1',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real-0123456789',
  GARAGE_SESSION_SECRET: 'test-session-secret-not-real-0123456789abcdef',
  GARAGE_ALLOWED_ORIGINS: ORIGIN,
};
const sha = s => createHash('sha256').update(s).digest('hex');

function world({ env = ENV, users } = {}) {
  let clock = Date.parse('2026-10-19T08:00:00.000Z');
  let seed = 0;
  const state = {
    users: new Map((users ?? [
      { id: 'u1', name: 'Sam', username: 'sam', password: bcrypt.hashSync('right-pass', 4), role: 'garage_salesman', business_access: 'garage' },
      { id: 'u2', name: 'Lee', username: 'lee', password: 'legacy-plain', role: 'garage_salesman', business_access: 'both' },
      { id: 'h1', name: 'Head', username: 'head', password: bcrypt.hashSync('head-pass', 4), role: 'garage_head', business_access: 'garage' },
      { id: 'i1', name: 'Ira', username: 'ira', password: bcrypt.hashSync('ira-pass', 4), role: 'garage_installer', business_access: 'garage' },
      { id: 'c1', name: 'Cara', username: 'cara', password: bcrypt.hashSync('cara-pass', 4), role: 'salesperson', business_access: 'used_car' },
    ]).map(u => [u.id, { enabled: true, ...u }])),
    sessions: new Map(),
    throttle: new Map(),
    rpcCalls: [],
    rpcResult: (fn, args) => ({ data: fn === 'garage_building_list' ? [] : [{ document: args.p_document ?? { id: args.p_id }, revision: (args.p_expected_revision ?? 0) + 1, created_at: 'c', updated_at: 'u' }], error: null }),
    logs: [],
  };
  const repo = {
    async findUserByUsername(name) { return [...state.users.values()].find(u => u.username === name) ?? null; },
    async findUserById(id) { return state.users.get(id) ?? null; },
    async createSession(s) { state.sessions.set(s.tokenHash, { ...s }); },
    async findSession(h) { return state.sessions.get(h) ?? null; },
    async touchSession(h, at) { const s = state.sessions.get(h); if (s) s.lastSeenAt = at; },
    async deleteSession(h) { state.sessions.delete(h); },
    async deleteExpiredSessions(userId, nowIso) { for (const [h, s] of state.sessions) if (s.userId === userId && s.expiresAt < nowIso) state.sessions.delete(h); },
    async throttleHit(key, limit, windowSeconds) {
      let t = state.throttle.get(key);
      if (!t || t.start + windowSeconds * 1000 <= clock) t = { start: clock, attempts: 0 };
      t.attempts++;
      state.throttle.set(key, t);
      return { allowed: t.attempts <= limit, retryAfter: Math.ceil((t.start + windowSeconds * 1000 - clock) / 1000) };
    },
    async throttleClear(key) { state.throttle.delete(key); },
    async rpc(fn, args) { state.rpcCalls.push({ fn, args }); return state.rpcResult(fn, args); },
  };
  const deps = {
    env, bcrypt, repo: () => repo, now: () => clock,
    randomBytes: n => Buffer.alloc(n, ++seed),
    log: (m, d) => state.logs.push(`${m} ${d}`),
  };
  return { state, deps, advance: ms => { clock += ms; } };
}

function req({ method = 'GET', url = '/api/garage-building/session', headers = {}, body, cookie, ip = '203.0.113.9' } = {}) {
  const h = { origin: ORIGIN, 'x-garage-building': '1', 'x-garage-user': 'u1', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': ip, ...headers };
  if (body !== undefined) h['content-type'] ??= 'application/json';
  if (cookie) h.cookie = `${COOKIE_NAME}=${cookie}`;
  for (const [k, v] of Object.entries(h)) if (v === undefined) delete h[k];
  return { method, url, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) };
}
const parse = out => ({ ...out, json: JSON.parse(out.body) });
const cookieFrom = out => {
  const set = [].concat(out.headers['Set-Cookie'] ?? []).find(c => c.startsWith(`${COOKIE_NAME}=`) && !c.includes('Max-Age=0'));
  return set?.slice(COOKIE_NAME.length + 1).split(';')[0];
};
async function signIn(w, username = 'sam', password = 'right-pass') {
  const out = parse(await handleSession(req({ method: 'POST', body: { username, password } }), w.deps));
  return { out, token: cookieFrom(out) };
}
function project(id = 'bld_1', revision = 0, ownerId = 'u1') {
  return { schema: 1, id, ownerId, customerName: '', phone: '', title: 'Shop', address: '', floors: [{ id: 'fl1', name: 'L1' }], rooms: [], windows: [], versions: [], revision, createdAt: 'x', updatedAt: 'x' };
}

test('sign-in sets a hardened HttpOnly cookie and stores only a token hash', async () => {
  const w = world();
  const { out, token } = await signIn(w);
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.user, { id: 'u1', name: 'Sam', username: 'sam', role: 'garage_salesman', businessAccess: 'garage' });
  const set = [].concat(out.headers['Set-Cookie']).find(c => !c.includes('Max-Age=0'));
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${LIMITS.sessionTtlSeconds}`]) assert.ok(set.includes(attr), attr);
  assert.ok(set.startsWith('__Host-'), 'host-only cookie prefix');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!out.body.includes(token), 'token never in the response body');
  assert.ok(!out.body.includes('password') && !out.body.includes('$2'), 'no password material returned');
  assert.ok(w.state.sessions.has(sha(token)));
  assert.ok(![...w.state.sessions.keys()].includes(token), 'raw token not stored');
  assert.equal(out.headers['Cache-Control'], 'no-store');
  assert.ok(!Object.keys(out.headers).some(k => k.toLowerCase().startsWith('access-control-')), 'never answers CORS');
});

test('plaintext legacy credentials are refused; wrong and unknown users get the same answer', async () => {
  const w = world();
  assert.equal((await signIn(w, 'lee', 'legacy-plain')).out.status, 401);
  const wrong = (await signIn(w, 'sam', 'nope')).out;
  const unknown = (await signIn(w, 'ghost', 'nope')).out;
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json);
  assert.equal(cookieFrom(wrong), undefined);
});

test('accounts without building permission cannot open a session', async () => {
  const w = world();
  assert.equal((await signIn(w, 'ira', 'ira-pass')).out.status, 403, 'garage installer');
  assert.equal((await signIn(w, 'cara', 'cara-pass')).out.status, 403, 'used-car only');
  assert.equal(w.state.sessions.size, 0);
});

test('sign-in is throttled per username (even with the right password) and per IP, then recovers', async () => {
  const w = world();
  for (let i = 0; i < LIMITS.userAttempts; i++) assert.equal((await signIn(w, 'sam', 'bad')).out.status, 401);
  const locked = (await signIn(w, 'sam', 'right-pass')).out;
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error.code, 'RATE_LIMITED');
  assert.ok(Number(locked.headers['Retry-After']) > 0);
  assert.equal(w.state.sessions.size, 0);
  assert.ok([...w.state.throttle.keys()].every(k => !k.includes('sam') && !k.includes('203.0.113')), 'keys are hashed');
  w.advance(LIMITS.throttleWindowSeconds * 1000);
  assert.equal((await signIn(w, 'sam', 'right-pass')).out.status, 200);

  const w2 = world();
  for (let i = 0; i < LIMITS.ipAttempts; i++) await handleSession(req({ method: 'POST', body: { username: `user${i}`, password: 'x' } }), w2.deps);
  assert.equal((await signIn(w2, 'head', 'head-pass')).out.status, 429, 'same IP spraying usernames');
});

test('CSRF and cross-site requests are refused before any database work', async () => {
  const w = world();
  const login = headers => handleSession(req({ method: 'POST', headers, body: { username: 'sam', password: 'right-pass' } }), w.deps);
  assert.equal((await login({ origin: undefined })).status, 403, 'missing Origin on unsafe method');
  assert.equal((await login({ origin: 'https://evil.example' })).status, 403, 'foreign Origin');
  assert.equal((await login({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await login({ 'x-garage-building': undefined })).status, 403, 'custom header required');
  assert.equal((await login({ 'content-type': 'text/plain' })).status, 415, 'simple-request content type');
  assert.equal(w.state.throttle.size, 0, 'nothing counted');
  const { token } = await signIn(w);
  const read = await handleProjects(req({ url: '/api/garage-building/projects', cookie: token, headers: { 'x-garage-building': undefined } }), w.deps);
  assert.equal(read.status, 403, 'reads need the custom header too');
  const sameOriginGet = await handleProjects(req({ url: '/api/garage-building/projects', cookie: token, headers: { origin: undefined } }), w.deps);
  assert.equal(sameOriginGet.status, 200, 'same-origin GET without Origin is fine');
});

test('the actor always comes from the verified session, never the request', async () => {
  const w = world();
  const { token } = await signIn(w);
  await handleProjects(req({ url: '/api/garage-building/projects?actorId=h1&p_actor_id=h1', cookie: token }), w.deps);
  assert.deepEqual(w.state.rpcCalls.at(-1), { fn: 'garage_building_list', args: { p_actor_id: 'u1' } });

  const spoof = parse(await handleProjects(req({ method: 'PUT', url: '/api/garage-building/projects', cookie: token, body: { project: project(), actorId: 'h1' } }), w.deps));
  assert.equal(spoof.status, 400, 'unknown body fields rejected');
  assert.equal(w.state.rpcCalls.length, 1, 'rpc not called');

  const ok = parse(await handleProjects(req({ method: 'PUT', url: '/api/garage-building/projects', cookie: token, body: { project: project('bld_2', 3) } }), w.deps));
  assert.equal(ok.status, 200);
  const save = w.state.rpcCalls.at(-1);
  assert.equal(save.fn, 'garage_building_save');
  assert.equal(save.args.p_actor_id, 'u1');
  assert.equal(save.args.p_expected_revision, 3);
  assert.deepEqual([ok.json.project.revision, ok.json.project.createdAt, ok.json.project.updatedAt], [4, 'c', 'u']);

  await handleProjects(req({ url: '/api/garage-building/projects?id=bld_9', cookie: token }), w.deps);
  assert.deepEqual(w.state.rpcCalls.at(-1).args, { p_id: 'bld_9', p_actor_id: 'u1' });
  assert.equal((await handleProjects(req({ url: '/api/garage-building/projects?id=../x', cookie: token }), w.deps)).status, 400);
});

test('no cookie, forged cookie or unknown session is unauthenticated', async () => {
  const w = world();
  assert.equal((await handleProjects(req({ url: '/api/garage-building/projects' }), w.deps)).status, 401);
  assert.equal((await handleProjects(req({ url: '/api/garage-building/projects', cookie: 'not-a-token' }), w.deps)).status, 401);
  assert.equal((await handleProjects(req({ url: '/api/garage-building/projects', cookie: 'A'.repeat(43) }), w.deps)).status, 401);
  assert.equal(w.state.rpcCalls.length, 0);
});

test('shared-PC account mismatch cannot read or write using another session', async () => {
  const w = world(), { token } = await signIn(w);
  for (const expected of ['h1', undefined]) {
    const out = await handleProjects(req({url:'/api/garage-building/projects',cookie:token,headers:{'x-garage-user':expected}}),w.deps);
    assert.equal(out.status,401);
  }
  assert.equal(w.state.rpcCalls.length,0);
});

test('password change, username change, deletion or lost access revoke existing sessions', async () => {
  const cases = [
    ['password changed', s => { s.users.get('u1').password = bcrypt.hashSync('new-pass', 4); }, 401],
    ['username changed', s => { s.users.get('u1').username = 'sammy'; }, 401],
    ['user deleted', s => { s.users.delete('u1'); }, 401],
    ['garage access removed', s => { s.users.get('u1').business_access = 'used_car'; }, 403],
    ['role changed to installer', s => { s.users.get('u1').role = 'garage_installer'; }, 403],
    ['account disabled', s => { s.users.get('u1').enabled = false; }, 403],
  ];
  for (const [name, mutate, status] of cases) {
    const w = world();
    const { token } = await signIn(w);
    mutate(w.state);
    const out = await handleProjects(req({ url: '/api/garage-building/projects', cookie: token }), w.deps);
    assert.equal(out.status, status, name);
    assert.equal(w.state.sessions.size, 0, `${name}: session deleted`);
    assert.ok([].concat(out.headers['Set-Cookie']).some(c => c.includes('Max-Age=0')), `${name}: cookie cleared`);
    assert.equal(w.state.rpcCalls.length, 0, `${name}: no rpc`);
  }
});

test('sessions expire absolutely and when idle; activity extends idle time', async () => {
  const w = world();
  const { token } = await signIn(w);
  const get = () => handleSession(req({ cookie: token }), w.deps);
  w.advance(LIMITS.idleTimeoutSeconds * 1000 - 60_000);
  assert.equal((await get()).status, 200, 'touch before idle timeout');
  w.advance(LIMITS.idleTimeoutSeconds * 1000 - 60_000);
  assert.equal((await get()).status, 200, 'still alive thanks to the touch');
  w.advance(LIMITS.idleTimeoutSeconds * 1000);
  assert.equal((await get()).status, 401, 'idle');

  const w2 = world();
  const { token: t2 } = await signIn(w2);
  for (let i = 0; i < 12; i++) { w2.advance(LIMITS.idleTimeoutSeconds * 1000 - 60_000); await handleSession(req({ cookie: t2 }), w2.deps); }
  assert.equal((await handleSession(req({ cookie: t2 }), w2.deps)).status, 401, 'absolute lifetime');
});

test('sign-out deletes the session; signing in replaces a previous browser session', async () => {
  const w = world();
  const { token: first } = await signIn(w, 'head', 'head-pass');
  const second = parse(await handleSession(req({ method: 'POST', cookie: first, body: { username: 'sam', password: 'right-pass' } }), w.deps));
  assert.equal(second.status, 200);
  assert.ok(!w.state.sessions.has(sha(first)), 'previous staff session on this browser removed');
  const t = cookieFrom(second);
  const out = await handleSession(req({ method: 'DELETE', cookie: t }), w.deps);
  assert.equal(out.status, 200);
  assert.equal(w.state.sessions.size, 0);
  assert.ok([].concat(out.headers['Set-Cookie']).some(c => c.includes('Max-Age=0')));
  assert.equal((await handleSession(req({ method: 'DELETE', cookie: t, headers: { origin: 'https://evil.example' } }), w.deps)).status, 403, 'sign-out is CSRF-protected too');
});

test('request bounds: size, JSON shape, field lengths, methods', async () => {
  const w = world();
  const { token } = await signIn(w);
  const put = (body, headers = {}) => handleProjects(req({ method: 'PUT', url: '/api/garage-building/projects', cookie: token, body, headers }), w.deps);
  assert.equal((await put('{"project":', {})).status, 400, 'invalid JSON');
  assert.equal((await put('[]')).status, 400, 'array body');
  assert.equal((await put({ project: { ...project(), revision: -1 } })).status, 400);
  assert.equal((await put({ project: { ...project(), id: 'bad id' } })).status, 400);
  assert.equal((await put({ project: project() }, { 'content-length': String(LIMITS.maxBodyBytes + 1) })).status, 413);
  const huge = { project: { ...project(), address: 'x'.repeat(LIMITS.maxBodyBytes) } };
  assert.equal((await put(huge)).status, 413);
  const login = body => handleSession(req({ method: 'POST', body }), w.deps);
  assert.equal((await login({ username: 'sam', password: 'p'.repeat(LIMITS.maxPassword + 1) })).status, 400, 'password length bound');
  assert.equal((await login({ username: 'sam', password: 'p'.repeat(LIMITS.maxLoginBodyBytes) })).status, 413, 'login body bound');
  assert.equal((await login({ username: 'sam', password: 7 })).status, 400);
  assert.equal((await login({ username: 'sam', password: 'x', role: 'director' })).status, 400);
  const m = await handleProjects(req({ method: 'DELETE', url: '/api/garage-building/projects', cookie: token }), w.deps);
  assert.equal(m.status, 405);
  assert.equal(m.headers.Allow, 'GET, PUT');
});

test('database errors map to safe client errors without leaking internals', async () => {
  const w = world();
  const { token } = await signIn(w);
  const list = () => handleProjects(req({ url: '/api/garage-building/projects', cookie: token }), w.deps).then(parse);
  const cases = [
    [{ code: 'P0001', message: 'REVISION_CONFLICT' }, 409, 'CONFLICT'],
    [{ code: 'P0001', message: 'NOT_ALLOWED' }, 403, 'FORBIDDEN'],
    [{ code: 'P0001', message: 'VERSION_IMMUTABLE' }, 422, 'INVALID'],
    [{ code: 'P0001', message: 'INVALID_DOCUMENT: project window w1' }, 422, 'INVALID'],
    [{ code: 'PGRST202', message: 'Could not find function' }, 503, 'SETUP'],
    [{ code: 'XX000', message: 'internal detail: password hash table users' }, 502, 'CLOUD'],
  ];
  for (const [error, status, code] of cases) {
    w.state.rpcResult = () => ({ data: null, error });
    const out = await list();
    assert.equal(out.status, status, error.message);
    assert.equal(out.json.error.code, code);
  }
  assert.ok(!JSON.stringify(await list()).includes('internal detail'));
  w.state.rpcResult = () => { throw new Error('socket hang up at 10.0.0.1'); };
  const net = await list();
  assert.equal(net.status, 502);
  assert.ok(!net.body.includes('10.0.0.1'));
});

test('server refuses to run unconfigured, with a publishable key, or with a secret exposed to Vite', async () => {
  const cases = [
    { ...ENV, GARAGE_BUILDING_ONLINE: undefined },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' },
    { ...ENV, GARAGE_SESSION_SECRET: 'short' },
    { ...ENV, GARAGE_ALLOWED_ORIGINS: 'http://garage.example' },
    { ...ENV, SUPABASE_URL: 'http://insecure.example' },
    { ...ENV, VITE_LEAK: ENV.SUPABASE_SERVICE_ROLE_KEY },
  ];
  for (const env of cases) {
    const w = world({ env });
    const out = parse(await handleSession(req({ method: 'POST', body: { username: 'sam', password: 'right-pass' } }), w.deps));
    assert.equal(out.status, 503);
    assert.equal(out.json.error.code, 'SETUP');
    assert.ok(!out.body.includes('SUPABASE') && !out.body.includes('VITE'), 'config details stay in server logs');
  }
  assert.equal(readConfig(ENV).ok, true);
  assert.deepEqual(readConfig({ ...ENV, GARAGE_ALLOWED_ORIGINS: 'http://localhost:3000, https://a.example/' }).origins, ['http://localhost:3000', 'https://a.example']);
});

test('Vercel adapter streams bounded bodies and writes the core response', async () => {
  const w = world();
  const handler = vercelHandler(handleSession, () => w.deps);
  function vreq(body, extra = {}) {
    const r = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
    r.method = 'POST'; r.url = '/api/garage-building/session';
    r.headers = { origin: ORIGIN, 'x-garage-building': '1', 'content-type': 'application/json', ...extra };
    return r;
  }
  function vres() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; }
  const ok = vres();
  await handler(vreq(JSON.stringify({ username: 'sam', password: 'right-pass' })), ok);
  assert.equal(ok.statusCode, 200);
  assert.ok([].concat(ok.headers['Set-Cookie']).some(c => c.startsWith(COOKIE_NAME)));
  const big = vres();
  await handler(vreq('x'.repeat(LIMITS.maxBodyBytes + 10)), big);
  assert.equal(big.statusCode, 413);
  const parsedByPlatform = vreq(undefined);
  parsedByPlatform.body = { username: 'sam', password: 'right-pass' };
  const p = vres();
  await handler(parsedByPlatform, p);
  assert.equal(p.statusCode, 200, 'platform-parsed body accepted');
  const broken = vreq(undefined);
  Object.defineProperty(broken, 'body', { get() { throw new Error('Invalid JSON'); } });
  const b = vres();
  await handler(broken, b);
  assert.equal(b.statusCode, 400);
});

test('API entry points parse and export handlers; vercel.json keeps /api out of the SPA rewrite', async () => {
  for (const file of ['session', 'projects']) {
    const mod = await import(`../api/garage-building/${file}.mjs`);
    assert.equal(typeof mod.default, 'function', file);
  }
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  const rewrites = config.rewrites ?? [];
  // Vercel source patterns are path-to-regexp; these use only a plain
  // regex group, so a JS RegExp is a faithful check.
  const matches = path => rewrites.some(r => new RegExp(`^${r.source}$`).test(path));
  assert.ok(!matches('/api/garage-building/session'));
  assert.ok(!matches('/api/garage-building/projects'));
  assert.ok(matches('/garage/building/bld_1'), 'SPA deep links still rewrite');
  assert.ok(matches('/'));
  const src = readFileSync(new URL('../src/lib/garageBuildingProjects.ts', import.meta.url), 'utf8');
  assert.ok(!/SERVICE_ROLE|GARAGE_SESSION_SECRET/.test(src), 'browser code never references server secrets');
});

test('online identity authority is private and never inherited from legacy users', () => {
  const repo = readFileSync(new URL('../server/garageBuilding/supabaseRepo.mjs',import.meta.url),'utf8');
  assert.ok(!repo.includes(".from('users')"));
  assert.ok(repo.includes(".from('garage_building_staff')"));
  const sql = readFileSync(new URL('../supabase/migrations/20261020000000_garage_building_projects.sql',import.meta.url),'utf8');
  assert.match(sql,/alter table garage_building_staff enable row level security/i);
  assert.match(sql,/revoke all on garage_building_staff from public, anon, authenticated/i);
  assert.match(sql,/from garage_building_staff where id = p_actor_id and enabled/i);
});
