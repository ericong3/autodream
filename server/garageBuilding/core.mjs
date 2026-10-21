// Garage building online saving — trusted server bridge.
//
// The browser never sees the service-role key and never chooses the actor.
// A Garage user re-confirms their existing username/password here; the
// server verifies it against private `garage_building_staff`, issues an HttpOnly session cookie,
// and every project call derives p_actor_id from that verified session.
//
// Everything external (database, clock, randomness, bcrypt, env) is
// injected so the whole flow is testable without network or secrets.
import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = '__Host-autodream_gb';
export const CSRF_HEADER = 'x-garage-building';
export const LIMITS = {
  maxBodyBytes: 2_100_000, // DB rejects documents over 2,000,000 bytes
  maxLoginBodyBytes: 4_096,
  maxUsername: 100,
  maxPassword: 256,
  sessionTtlSeconds: 10 * 60 * 60, // absolute: one working day
  idleTimeoutSeconds: 2 * 60 * 60, // shared PCs: drop sessions nobody is using
  touchEverySeconds: 5 * 60,
  userAttempts: 5, // per username per window
  ipAttempts: 30, // per client IP per window
  throttleWindowSeconds: 15 * 60,
};
const BUILDING_ROLES = new Set(['garage_salesman', 'director', 'shareholder', 'garage_head']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const BCRYPT_RE = /^\$2[aby]\$/;
const SETUP_CODES = new Set(['PGRST202', 'PGRST205', '42P01', '42883', '42501']);

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const setupError = () => new ApiError(503, 'SETUP', 'Shared building saving is not configured on the server yet.');
const authError = (message = 'Sign in to Garage online saving.') => new ApiError(401, 'AUTH', message);

// ── Config ───────────────────────────────────────────────────────────────
// Server-only names. Nothing here may be prefixed VITE_ (Vite would bundle
// it into the browser), and we refuse to run if a secret leaked into one.
export const ENV_NAMES = ['GARAGE_BUILDING_ONLINE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GARAGE_SESSION_SECRET', 'GARAGE_ALLOWED_ORIGINS'];

export function readConfig(env) {
  const problems = [];
  if (env.GARAGE_BUILDING_ONLINE !== '1') problems.push('GARAGE_BUILDING_ONLINE');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const secret = env.GARAGE_SESSION_SECRET ?? '';
  let supabaseUrl = '';
  try { supabaseUrl = new URL(env.SUPABASE_URL ?? '').protocol === 'https:' ? env.SUPABASE_URL : ''; } catch { /* reported below */ }
  if (!supabaseUrl) problems.push('SUPABASE_URL');
  if (serviceKey.length < 20 || serviceKey.startsWith('sb_publishable')) problems.push('SUPABASE_SERVICE_ROLE_KEY');
  if (secret.length < 32) problems.push('GARAGE_SESSION_SECRET');
  const origins = [];
  for (const raw of (env.GARAGE_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(raw);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol === 'https:' || (local && u.protocol === 'http:')) origins.push(u.origin);
      else problems.push('GARAGE_ALLOWED_ORIGINS');
    } catch { problems.push('GARAGE_ALLOWED_ORIGINS'); }
  }
  if (!origins.length) problems.push('GARAGE_ALLOWED_ORIGINS');
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && value && ((serviceKey && value.includes(serviceKey)) || (secret && value.includes(secret)))) {
      problems.push(`secret exposed in ${name}`);
    }
  }
  return problems.length
    ? { ok: false, problems: [...new Set(problems)] }
    : { ok: true, supabaseUrl, serviceKey, secret, origins };
}

// ── Small crypto helpers ────────────────────────────────────────────────
const sha256 = s => createHash('sha256').update(s).digest('hex');
const hmac = (secret, s) => createHmac('sha256', secret).update(s).digest('base64url');
function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
// Binds a session to the exact credentials it was issued for: a password
// or username change invalidates every outstanding session for that user.
const fingerprint = (secret, user) => hmac(secret, `fp:${user.id}\n${user.username}\n${user.password}\n${user.session_version ?? 0}`);

let dummyHash = null;
async function verifyPassword(bcrypt, plain, stored) {
  if (typeof stored !== 'string' || !stored) {
    // Unknown user: spend the same bcrypt time so timing doesn't reveal it.
    dummyHash ??= await bcrypt.hash(nodeRandomBytes(16).toString('hex'), 10);
    await bcrypt.compare(plain, dummyHash);
    return false;
  }
  if (BCRYPT_RE.test(stored)) return bcrypt.compare(plain, stored);
  // Never trust legacy app passwords: its public staff table is not an
  // identity authority. Garage online accounts must have private bcrypt hashes.
  return false;
}

const canUseBuilding = u => !!u && u.enabled === true && u.registration_status !== 'pending' && (u.business_access === 'garage' || u.business_access === 'both') && BUILDING_ROLES.has(u.role);
const APP_ROLES = new Set(['director','shareholder','salesperson','mechanic','admin','investor','banker','garage_salesman','garage_head','garage_installer','garage_detailer','garage_spray']);
const canUseApp = u => !!u && u.enabled === true && u.registration_status !== 'pending' && APP_ROLES.has(u.role) && ['used_car','garage','both'].includes(u.business_access) && (!['director','shareholder'].includes(u.role) || u.business_access === 'both');
const canUseGarage = u => !!u && u.enabled === true && u.registration_status !== 'pending' && ['garage','both'].includes(u.business_access) && ['garage_salesman','garage_head','director','shareholder','garage_installer','garage_detailer','garage_spray'].includes(u.role);
const publicUser = u => ({ id: u.id, name: u.name ?? u.username, username: u.username, role: u.role, businessAccess: u.business_access });

// ── HTTP helpers ─────────────────────────────────────────────────────────
function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function parseCookies(raw) {
  const out = {};
  for (const part of String(raw ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (!(k in out)) out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

const sessionCookie = (token, maxAge) => `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
const clearCookie = () => `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

// CSRF / cross-site: every call must carry our custom header (a cross-site
// page can't add one without a CORS preflight, and we never answer CORS);
// unsafe methods must also come from an allow-listed Origin; any
// Sec-Fetch-Site other than same-origin is refused.
function assertSameOrigin(req, config) {
  if (header(req, CSRF_HEADER) !== '1') throw new ApiError(403, 'FORBIDDEN', 'Request blocked.');
  const site = header(req, 'sec-fetch-site');
  if (site && site !== 'same-origin') throw new ApiError(403, 'FORBIDDEN', 'Request blocked.');
  const origin = header(req, 'origin');
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (origin ? !config.origins.includes(origin) : unsafe) throw new ApiError(403, 'FORBIDDEN', 'Request blocked.');
}

function readJson(req, maxBytes) {
  const type = String(header(req, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'INVALID', 'Send JSON.');
  const declared = Number(header(req, 'content-length'));
  if (req.bodyTooLarge || (Number.isFinite(declared) && declared > maxBytes)) throw new ApiError(413, 'INVALID', 'Request is too large.');
  if (req.bodyInvalid) throw new ApiError(400, 'INVALID', 'Request body is not valid JSON.');
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > maxBytes) throw new ApiError(413, 'INVALID', 'Request is too large.');
    try { body = JSON.parse(body); } catch { throw new ApiError(400, 'INVALID', 'Request body is not valid JSON.'); }
  } else if (body && typeof body === 'object') {
    // Already parsed by the platform: still bound the size.
    if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) throw new ApiError(413, 'INVALID', 'Request is too large.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID', 'Request body must be a JSON object.');
  return body;
}

function onlyKeys(body, keys) {
  for (const k of Object.keys(body)) if (!keys.includes(k)) throw new ApiError(400, 'INVALID', `Unexpected field: ${k.slice(0, 40)}`);
}

function clientIp(req) {
  const fwd = String(header(req, 'x-forwarded-for') ?? '').split(',')[0].trim();
  return fwd || String(header(req, 'x-real-ip') ?? '').trim() || req.socketAddress || 'unknown';
}

// ── Dependencies ─────────────────────────────────────────────────────────
// deps = {
//   env, now(): ms, randomBytes(n): Buffer, bcrypt: { compare, hash },
//   repo(config): {
//     findUserByUsername(username), findUserById(id),
//     createSession({ tokenHash, userId, fingerprint, createdAt, lastSeenAt, expiresAt }),
//     findSession(tokenHash), touchSession(tokenHash, lastSeenAt),
//     deleteSession(tokenHash), deleteExpiredSessions(userId, nowIso),
//     throttleHit(key, limit, windowSeconds) -> { allowed, retryAfter },
//     throttleClear(key),
//     rpc(fn, args) -> { data, error },
//   },
//   log(message, detail)
// }
function context(deps) {
  const config = readConfig(deps.env ?? {});
  if (!config.ok) {
    deps.log?.('garage-building: server not configured', config.problems.join(', '));
    throw setupError();
  }
  return { config, repo: deps.repo(config), now: deps.now ?? Date.now, random: deps.randomBytes ?? nodeRandomBytes };
}

async function db(promise) {
  try { return await promise; } catch (e) {
    if (e instanceof ApiError) throw e;
    if (SETUP_CODES.has(e?.code)) throw setupError();
    throw new ApiError(502, 'CLOUD', 'Garage online storage is unavailable. Try again.');
  }
}

// Verifies the cookie, the session row, and the *current* account on every
// request. Returns the actor or throws (deleting the session when it's dead).
export async function authenticate(req, ctx, res, allow = canUseBuilding) {
  const token = parseCookies(header(req, 'cookie'))[COOKIE_NAME];
  if (!token || !TOKEN_RE.test(token)) throw authError();
  const tokenHash = sha256(token);
  const kill = async (error) => {
    await db(ctx.repo.deleteSession(tokenHash));
    res.cookies.push(clearCookie());
    throw error;
  };
  const session = await db(ctx.repo.findSession(tokenHash));
  if (!session) { res.cookies.push(clearCookie()); throw authError(); }
  const now = ctx.now();
  const lastSeen = Date.parse(session.lastSeenAt);
  if (!(now < Date.parse(session.expiresAt)) || !(now - lastSeen < LIMITS.idleTimeoutSeconds * 1000)) {
    await kill(authError('Your Garage online session expired. Sign in again.'));
  }
  const user = await db(ctx.repo.findUserById(session.userId));
  if (!user) await kill(authError('This account is no longer active.'));
  if (!safeEqual(fingerprint(ctx.config.secret, user), session.fingerprint)) {
    await kill(authError('Your account details changed. Sign in again.'));
  }
  if (!allow(user)) {
    const denied = new ApiError(403, 'FORBIDDEN', 'This account cannot access this Garage feature.');
    if (!canUseApp(user)) await kill(denied);
    throw denied;
  }
  if (now - lastSeen >= LIMITS.touchEverySeconds * 1000) {
    await db(ctx.repo.touchSession(tokenHash, new Date(now).toISOString()));
  }
  return { user, session, tokenHash };
}

// ── Handlers ─────────────────────────────────────────────────────────────
async function login(req, ctx, res, allow = canUseBuilding) {
  const body = readJson(req, LIMITS.maxLoginBodyBytes);
  onlyKeys(body, ['username', 'password']);
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password
      || username.length > LIMITS.maxUsername || password.length > LIMITS.maxPassword) {
    throw new ApiError(400, 'INVALID', 'Enter your username and password.');
  }
  // Count the attempt before checking it, so parallel guesses still hit
  // the limit. Keys are HMACs: no raw usernames or IPs are stored.
  const userKey = `u:${hmac(ctx.config.secret, `user:${username.toLowerCase()}`)}`;
  const ipKey = `ip:${hmac(ctx.config.secret, `ip:${clientIp(req)}`)}`;
  const ip = await db(ctx.repo.throttleHit(ipKey, LIMITS.ipAttempts, LIMITS.throttleWindowSeconds));
  // Do not create unlimited username rows for an already blocked IP.
  const u = ip.allowed
    ? await db(ctx.repo.throttleHit(userKey, LIMITS.userAttempts, LIMITS.throttleWindowSeconds))
    : { allowed: true, retryAfter: 0 };
  if (!u.allowed || !ip.allowed) {
    const retryAfter = Math.max(1, Math.ceil(Math.max(u.allowed ? 0 : u.retryAfter, ip.allowed ? 0 : ip.retryAfter)));
    res.headers['Retry-After'] = String(retryAfter);
    throw new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait and try again.', { retryAfter });
  }
  const user = await db(ctx.repo.findUserByUsername(username));
  if (!(await verifyPassword(ctx.bcrypt, password, user?.password))) {
    throw authError('Username or password is incorrect.');
  }
  if (!allow(user)) {
    if (allow === canUseGarage || allow === canUseApp) throw authError('Username or password is incorrect.');
    throw new ApiError(403, 'FORBIDDEN', 'This account cannot use building projects.');
  }

  const token = ctx.random(32).toString('base64url');
  const now = ctx.now();
  const expiresAt = new Date(now + LIMITS.sessionTtlSeconds * 1000).toISOString();
  await db(ctx.repo.deleteExpiredSessions(user.id, new Date(now).toISOString()));
  await db(ctx.repo.createSession({
    tokenHash: sha256(token), userId: user.id, fingerprint: fingerprint(ctx.config.secret, user),
    createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(), expiresAt,
  }));
  await db(ctx.repo.throttleClear(userKey));
  // Replace any session this browser already held (e.g. another staff
  // member on a shared PC) so it can't linger.
  const previous = parseCookies(header(req, 'cookie'))[COOKIE_NAME];
  if (previous && TOKEN_RE.test(previous)) await db(ctx.repo.deleteSession(sha256(previous)));
  res.cookies.push(sessionCookie(token, LIMITS.sessionTtlSeconds));
  return { status: 200, body: { user: publicUser(user), expiresAt } };
}

export async function handleSession(req, deps) {
  return respond(req, deps, ['GET', 'POST', 'DELETE'], async (ctx, res) => {
    if (req.method === 'POST') return login(req, ctx, res);
    if (req.method === 'DELETE') {
      const token = parseCookies(header(req, 'cookie'))[COOKIE_NAME];
      if (token && TOKEN_RE.test(token)) await db(ctx.repo.deleteSession(sha256(token)));
      res.cookies.push(clearCookie());
      return { status: 200, body: { signedOut: true } };
    }
    const { user, session } = await authenticate(req, ctx, res);
    return { status: 200, body: { user: publicUser(user), expiresAt: session.expiresAt } };
  });
}

// General Garage login uses the same hardened cookie; project authorization stays separate.
export async function handleGarageSession(req, deps) {
  return respond(req, deps, ['GET','POST','DELETE'], async (ctx,res) => {
    if(req.method==='POST') return login(req,ctx,res,canUseGarage);
    if(req.method==='DELETE') {
      const token=parseCookies(header(req,'cookie'))[COOKIE_NAME];
      if(token&&TOKEN_RE.test(token)) await db(ctx.repo.deleteSession(sha256(token)));
      res.cookies.push(clearCookie());
      return {status:200,body:{signedOut:true}};
    }
    const {user,session}=await authenticate(req,ctx,res,canUseGarage);
    return {status:200,body:{user:publicUser(user),expiresAt:session.expiresAt}};
  });
}

// Shared AutoDream login. Only the private account determines role/business access.
export async function handleAppSession(req, deps) {
  return respond(req,deps,['GET','POST','DELETE'],async(ctx,res)=>{
    if(req.method==='POST')return login(req,ctx,res,canUseApp);
    if(req.method==='DELETE'){
      const token=parseCookies(header(req,'cookie'))[COOKIE_NAME];
      if(token&&TOKEN_RE.test(token))await db(ctx.repo.deleteSession(sha256(token)));
      res.cookies.push(clearCookie());return {status:200,body:{signedOut:true}};
    }
    const {user,session}=await authenticate(req,ctx,res,canUseApp);
    return {status:200,body:{user:publicUser(user),expiresAt:session.expiresAt}};
  });
}

// First-time setup requires an administrator-issued, single-use code.
// No authority is inherited from the legacy app account or client role.
export async function handleActivation(req, deps) {
  if(deps.env?.AUTH_INVITES_ENABLED==='1') return respond(req,deps,['POST'],async()=>{throw new ApiError(410,'INVALID','Use the registration link from your director.');});
  return respond(req, deps, ['POST'], async (ctx, res) => {
    const body = readJson(req, LIMITS.maxLoginBodyBytes);
    onlyKeys(body, ['username', 'code', 'password']);
    const { username, password } = body;
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
    if (typeof username !== 'string' || !username || username.length > LIMITS.maxUsername
        || typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password) > 72
        || !/^[a-f0-9]{64}$/.test(code)) {
      throw new ApiError(400, 'INVALID', 'Enter your setup code and a password of at least 10 characters (at most 72 bytes).');
    }
    const limit = await db(ctx.repo.throttleHit(`aip:${hmac(ctx.config.secret, clientIp(req))}`, 30, LIMITS.throttleWindowSeconds));
    if (!limit.allowed) {
      res.headers['Retry-After'] = String(limit.retryAfter);
      throw new ApiError(429, 'RATE_LIMITED', 'Too many setup attempts. Wait and try again.', { retryAfter: limit.retryAfter });
    }
    // Reject junk codes cheaply before spending bcrypt CPU. The atomic
    // activation function below remains the authoritative one-use check.
    if (!(await db(ctx.repo.canActivateStaff(sha256(code), username)))) throw authError('The setup code is invalid, expired or already used for this account. Ask your manager for a new code.');
    const passwordHash = await ctx.bcrypt.hash(password, 12);
    const activated = await db(ctx.repo.activateStaff(sha256(code), username, passwordHash));
    if (!activated) throw authError('The setup code is invalid, expired or already used for this account. Ask your manager for a new code.');
    return { status: 200, body: { activated: true } };
  });
}

function rowToProject(row) {
  if (!row || typeof row.document !== 'object' || !Number.isInteger(row.revision)) {
    throw new ApiError(502, 'CLOUD', 'Garage online storage returned an unexpected project.');
  }
  return { ...row.document, revision: row.revision, createdAt: row.created_at ?? row.document.createdAt, updatedAt: row.updated_at ?? row.document.updatedAt };
}

function rpcError(error, log) {
  const msg = String(error?.message ?? '');
  if (SETUP_CODES.has(error?.code)) return setupError();
  if (msg.includes('REVISION_CONFLICT')) return new ApiError(409, 'CONFLICT', 'This project changed since you opened it. Reload to see the latest.');
  if (msg.includes('NOT_ALLOWED') || msg.includes('NO_GARAGE_ACCESS')) return new ApiError(403, 'FORBIDDEN', 'You cannot edit this building project.');
  if (msg.includes('VERSION_IMMUTABLE')) return new ApiError(422, 'INVALID', 'Saved quote versions cannot be changed.');
  const invalid = msg.match(/INVALID_DOCUMENT:[^\n]{0,160}/);
  if (invalid) return new ApiError(422, 'INVALID', invalid[0]);
  log?.('garage-building: rpc failed', error?.code ?? 'unknown');
  return new ApiError(502, 'CLOUD', 'Garage online storage is unavailable. Try again.');
}

async function call(ctx, fn, args, log) {
  const res = await db(ctx.repo.rpc(fn, args));
  if (res?.error) throw rpcError(res.error, log);
  return res?.data;
}

export async function handleProjects(req, deps) {
  return respond(req, deps, ['GET', 'PUT'], async (ctx, res) => {
    const { user } = await authenticate(req, ctx, res);
    // This header is only a consistency check against the server identity,
    // never an authentication credential. It blocks shared-PC account races.
    if (header(req, 'x-garage-user') !== user.id) throw authError('The Garage online account changed. Sign in again.');
    // The actor is always the verified session user — never the request.
    const actor = user.id;
    if (req.method === 'GET') {
      const id = new URL(req.url, 'http://local').searchParams.get('id');
      if (id === null) {
        const rows = await call(ctx, 'garage_building_list', { p_actor_id: actor }, deps.log);
        return { status: 200, body: { projects: (Array.isArray(rows) ? rows : []).map(rowToProject) } };
      }
      if (!ID_RE.test(id)) throw new ApiError(400, 'INVALID', 'Invalid project id.');
      const rows = await call(ctx, 'garage_building_get', { p_id: id, p_actor_id: actor }, deps.log);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Building project not found.');
      return { status: 200, body: { project: rowToProject(row) } };
    }
    const body = readJson(req, LIMITS.maxBodyBytes);
    onlyKeys(body, ['project']);
    const project = body.project;
    if (!project || typeof project !== 'object' || Array.isArray(project) || !ID_RE.test(String(project.id ?? ''))
        || !Number.isInteger(project.revision) || project.revision < 0 || project.revision > 2_000_000_000) {
      throw new ApiError(400, 'INVALID', 'Send a building project with an id and revision.');
    }
    const rows = await call(ctx, 'garage_building_save', { p_document: project, p_expected_revision: project.revision, p_actor_id: actor }, deps.log);
    return { status: 200, body: { project: rowToProject(Array.isArray(rows) ? rows[0] : rows) } };
  });
}

// Shared envelope: method check, config, same-origin, error mapping,
// no-store, no CORS headers ever.
async function respond(req, deps, methods, run) {
  const res = { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, cookies: [] };
  let out;
  try {
    if (!methods.includes(req.method)) {
      res.headers.Allow = methods.join(', ');
      throw new ApiError(405, 'INVALID', 'Method not allowed.');
    }
    const ctx = context(deps);
    ctx.bcrypt = deps.bcrypt;
    assertSameOrigin(req, ctx.config);
    out = await run(ctx, res);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'CLOUD', 'Something went wrong. Try again.');
    if (!(e instanceof ApiError)) deps.log?.('garage-building: unexpected error', e?.name ?? 'Error');
    out = { status: err.status, body: { error: { code: err.code, message: err.message, ...err.extra } } };
  }
  if (res.cookies.length) res.headers['Set-Cookie'] = res.cookies;
  return { status: out.status, headers: res.headers, body: JSON.stringify(out.body) };
}

export { respond, readJson, onlyKeys, clientIp, canUseApp };
