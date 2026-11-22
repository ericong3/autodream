import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { handlePrivateFinance } from '../server/usedCar/privateFinance.mjs';
import { handleAppSession, COOKIE_NAME } from '../server/garageBuilding/core.mjs';

// An admin finishing a repair used to save the bill, then have its books entry
// refused. These tests check the entry now goes to the server function that
// builds it from the saved bill.
const origin = 'https://app.example';
async function fixture(role, rpcResult = (fn, args) => ({ data: { id: args.p_entry, source_type: 'repair', source_id: args.p_bill, lines: [] } })) {
  const user = { id: 'staff-1', username: 'staff', name: 'Sample', password: bcrypt.hashSync('sample-password', 4), role, business_access: 'both', enabled: true, registration_status: 'active' };
  const sessions = new Map(), calls = [], rpcs = [];
  const repo = {
    findUserByUsername: async () => user, findUserById: async () => user, createSession: async (s) => sessions.set(s.tokenHash, s), findSession: async (h) => sessions.get(h),
    touchSession: async () => {}, deleteSession: async (h) => sessions.delete(h), deleteExpiredSessions: async () => {}, throttleHit: async () => ({ allowed: true }), throttleClear: async () => {},
    privateFinance: async (input) => { calls.push(input); return { data: [input.data] }; },
    rpc: async (fn, args) => { rpcs.push({ fn, args }); return rpcResult(fn, args); },
  };
  const deps = { env: { USED_CAR_PRIVATE_FINANCE_ONLINE: '1', GARAGE_BUILDING_ONLINE: '1', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-real-service-key-123456789', GARAGE_SESSION_SECRET: 'not-real-session-secret-123456789012345', GARAGE_ALLOWED_ORIGINS: origin }, bcrypt, repo: () => repo };
  const req = (body, cookie) => ({ method: 'POST', headers: { origin, 'x-garage-building': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ scope: 'private_finance', ...body }) });
  const loginRequest = req({}); loginRequest.body = JSON.stringify({ username: 'staff', password: 'sample-password' });
  const login = await handleAppSession(loginRequest, deps);
  assert.equal(login.status, 200);
  const cookie = [].concat(login.headers['Set-Cookie']).find((c) => c.startsWith(COOKIE_NAME + '=') && !c.includes('Max-Age=0')).split(';')[0];
  return { calls, rpcs, run: async (body) => { const r = await handlePrivateFinance(req(body, cookie), deps); return { ...r, body: JSON.parse(r.body) }; } };
}
const entry = (over = {}) => ({ id: 'je-1', date: '2026-11-22', description: 'Repair recognized — Spray Paint', lines: [{ accountId: 'acct-inv-own', debit: 450, credit: 0 }, { accountId: 'acct-ap', debit: 0, credit: 450 }], source_type: 'repair', source_id: 'repair-bill-job1', car_id: 'car1', created_by: 'staff-1', ...over });

test('an admin repair books entry is built by the server from the saved bill', async () => {
  const f = await fixture('admin');
  const r = await f.run({ table: 'journal_entries', operation: 'insert', data: entry({ lines: [{ accountId: 'acct-inv-own', debit: 99999, credit: 0 }] }) });
  assert.equal(r.status, 200);
  assert.deepEqual(f.rpcs, [{ fn: 'uc_post_car_cost_journal', args: { p_actor: 'staff-1', p_bill: 'repair-bill-job1', p_entry: 'je-1' } }]);
  assert.equal(f.calls.length, 0, 'the browser lines are never written');
});

test('an admin car-cost entry uses the same server function, even for an investor-account car', async () => {
  const f = await fixture('admin');
  const r = await f.run({ table: 'journal_entries', operation: 'insert', data: entry({ source_type: 'misc_cost', source_id: 'misc-bill-1', lines: [{ accountId: 'acct-inv-investor', debit: 50, credit: 0 }] }) });
  assert.equal(r.status, 200);
  assert.equal(f.rpcs[0].fn, 'uc_post_car_cost_journal');
  assert.equal(f.rpcs[0].args.p_bill, 'misc-bill-1');
});

test('admin claim confirmations still use the claim function', async () => {
  const f = await fixture('admin', (fn, args) => ({ data: { id: args.p_entry, source_type: 'expense_claim_confirmed', lines: [] } }));
  const r = await f.run({ table: 'journal_entries', operation: 'insert', data: entry({ source_type: 'expense_claim_confirmed', source_id: 'claim-1' }) });
  assert.equal(r.status, 200);
  assert.deepEqual(f.rpcs[0], { fn: 'uc_confirm_claim_journal', args: { p_actor: 'staff-1', p_claim: 'claim-1', p_entry: 'je-1' } });
});

test('admins still cannot write any other books entry, change one, or send several at once', async () => {
  const f = await fixture('admin');
  assert.equal((await f.run({ table: 'journal_entries', operation: 'insert', data: entry({ source_type: 'car_sale' }) })).status, 403);
  assert.equal((await f.run({ table: 'journal_entries', operation: 'insert', data: entry({ source_type: 'salary' }) })).status, 403);
  assert.equal((await f.run({ table: 'journal_entries', operation: 'update', data: { voided: true }, filters: [{ op: 'eq', column: 'id', value: 'je-1' }] })).status, 403);
  assert.equal((await f.run({ table: 'journal_entries', operation: 'insert', data: [entry(), entry({ id: 'je-2' })] })).status, 400);
  assert.equal(f.rpcs.length, 0);
});

test('a bill that changed after it was booked gives a clear message', async () => {
  const f = await fixture('admin', () => ({ error: { message: 'BOOKS_REVIEW_REQUIRED' } }));
  const r = await f.run({ table: 'journal_entries', operation: 'insert', data: entry() });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'BOOKS_REVIEW_REQUIRED');
});

test('directors keep writing books entries directly', async () => {
  const f = await fixture('director');
  const r = await f.run({ table: 'journal_entries', operation: 'insert', data: entry() });
  assert.equal(r.status, 200);
  assert.equal(f.rpcs.length, 0);
  assert.equal(f.calls.length, 1);
});

test('the database function takes everything from the bill and only books each bill once', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261122000400_car_cost_books_entry.sql', import.meta.url), 'utf8');
  assert.match(sql, /function public\.uc_post_car_cost_journal\(p_actor text, p_bill text, p_entry text\)/);
  assert.match(sql, /bill\.type not in \('repair','misc_cost'\)/);
  assert.match(sql, /'debit', bill\.amount/);
  assert.match(sql, /'credit', bill\.amount/);
  assert.match(sql, /USE_INVESTOR_CAR_BILLS/);
  assert.match(sql, /existing\.lines is distinct from lines/);
  assert.match(sql, /return to_jsonb\(existing\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /grant execute on function public\.uc_post_car_cost_journal\(text, text, text\) to service_role/);
  assert.match(sql, /from public, anon, authenticated, service_role/);
});
