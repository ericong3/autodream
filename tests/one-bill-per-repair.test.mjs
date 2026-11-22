import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

// Bundle the bill helpers so the test runs the real code.
const out = buildSync({ entryPoints: [new URL('../src/utils/generatePayments.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, (n) => { throw new Error('unexpected require ' + n); });
const { generateRepairPayment, generateMiscCostPayment, isBillAlreadyExists } = mod.exports;

const repair = { id: 'job1', carId: 'car1', typeOfRepair: 'Spray Paint', location: 'Hub Seng', totalCost: 450, status: 'done', parts: [], labourCost: 0, createdAt: '2026-11-12' };
const refused = () => Object.assign(new Error('This already has a bill in To pay, so no second bill was made.'), { code: 'BILL_ALREADY_EXISTS' });

test('a repair bill always gets the same id for the same repair job', async () => {
  const saved = [];
  const id = await generateRepairPayment({ repair, payments: [], workshops: [], addPayment: async (p) => { saved.push(p); } });
  assert.equal(id, 'repair-bill-job1');
  assert.equal(saved[0].id, 'repair-bill-job1');
  assert.equal(saved[0].repairJobId, 'job1');
});

test('when the database says the repair already has a bill, nothing is returned and no error is shown', async () => {
  const id = await generateRepairPayment({ repair, payments: [], workshops: [], addPayment: async () => { throw refused(); } });
  assert.equal(id, undefined);
});

test('other save errors still reach the person saving', async () => {
  await assert.rejects(generateRepairPayment({ repair, payments: [], workshops: [], addPayment: async () => { throw new Error('offline'); } }), /offline/);
});

test('a car cost the database says already has a bill is skipped quietly', async () => {
  const misc = { id: 'm1', description: 'Petrol', amount: 50, merchant: 'Petrol', createdAt: '2026-11-03' };
  const id = await generateMiscCostPayment({ carId: 'car1', misc, payments: [], merchants: [], addPayment: async () => { throw refused(); } });
  assert.equal(id, undefined);
});

test('the refusal is recognised by code or by the database message', () => {
  assert.equal(isBillAlreadyExists(refused()), true);
  assert.equal(isBillAlreadyExists(new Error('BILL_ALREADY_EXISTS')), true);
  assert.equal(isBillAlreadyExists(new Error('Could not confirm this finance change.')), false);
  assert.equal(isBillAlreadyExists(null), false);
});

test('the database rule lets bill corrections through and checks every other repair or cost bill', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261122000300_one_bill_per_repair_and_cost.sql', import.meta.url), 'utf8');
  assert.match(sql, /before insert on public\.payments/);
  assert.match(sql, /company-bill-adjustment:%/);
  assert.match(sql, /supplier-adjustment:%/);
  assert.match(sql, /new\.type = 'repair'[\s\S]*repair_job_id = new\.repair_job_id/);
  assert.match(sql, /new\.type = 'misc_cost'[\s\S]*misc_cost_id = new\.misc_cost_id/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
