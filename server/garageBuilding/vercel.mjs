// Adapts Vercel's Node (req, res) to the injectable core handlers.
import bcrypt from 'bcryptjs';
import { LIMITS } from './core.mjs';

const REPO_METHODS = ['findUserByUsername', 'findUserById', 'createSession', 'findSession', 'touchSession', 'deleteSession', 'deleteExpiredSessions', 'throttleHit', 'throttleClear', 'canActivateStaff', 'activateStaff', 'rpc'];

// Default production dependencies. The Supabase client is imported lazily
// so a misconfigured deployment answers 503 instead of crashing on load.
export function productionDeps() {
  let repo = null;
  return {
    env: process.env,
    bcrypt,
    repo(config) {
      if (!repo) {
        const ready = import('./supabaseRepo.mjs').then(m => m.supabaseRepo(config));
        repo = Object.fromEntries(REPO_METHODS.map(n => [n, async (...args) => (await ready)[n](...args)]));
      }
      return repo;
    },
    log: (message, detail) => console.error(message, detail ?? ''),
  };
}

// Reads the body without trusting the platform to have bounded it.
// Returns { body } or { tooLarge: true } / { invalid: true }.
async function readBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  let parsed;
  try { parsed = req.body; } catch { return { invalid: true }; } // platform JSON parse failed
  if (parsed !== undefined) return { body: Buffer.isBuffer(parsed) ? parsed.toString('utf8') : parsed };
  if (req.method !== 'POST' && req.method !== 'PUT') return { body: undefined };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return { tooLarge: true };
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks).toString('utf8') };
}

export function vercelHandler(core, depsFactory = productionDeps) {
  let deps = null;
  return async function handler(req, res) {
    deps ??= depsFactory();
    const read = await readBody(req, LIMITS.maxBodyBytes);
    const out = await core({
      method: req.method,
      url: req.url ?? '/',
      headers: req.headers,
      body: read.body,
      bodyTooLarge: !!read.tooLarge,
      bodyInvalid: !!read.invalid,
      socketAddress: req.socket?.remoteAddress,
    }, deps);
    res.statusCode = out.status;
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.end(out.body);
  };
}
