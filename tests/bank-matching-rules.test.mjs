import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CENTS, validateStatement, classifyImport, buildMatchPlan, suggestMatches, parseMoneyToCents, isRealDate,
} from '../server/usedCar/bankMatchingRules.mjs';

const BANK = 'bank-uc-main';
const stmt = (lines, over = {}) => ({
  bankId: BANK, periodStart: '2026-10-01', periodEnd: '2026-10-31', openingBalanceCents: 100000,
  closingBalanceCents: 100000 + lines.reduce((t, l) => t + l.amountCents, 0), lines, ...over,
});
const codes = (r) => r.errors.map((e) => e.code);
const line = (lineKey, amountCents, extra = {}) => ({ lineKey, bankId: BANK, amountCents, allocatedCents: 0, ...extra });
const entry = (sourceType, sourceId, amountCents, extra = {}) => ({
  sourceType, sourceId, bankId: BANK, amountCents, paidOn: '2026-10-05', actual: true, allocatedCents: 0, ...extra,
});
const group = (lineKeys, sources, extra = {}) => ({
  confirmed: true, lineKeys, sources: sources.map(([sourceType, sourceId]) => ({ sourceType, sourceId })), ...extra,
});

test('valid statement reconciles opening + rows = closing and keeps identical same-day rows', () => {
  const r = validateStatement(stmt([
    { date: '2026-10-02', amountCents: -2500, description: 'Fuel', runningBalanceCents: 97500 },
    { date: '2026-10-02', amountCents: -2500, description: 'Fuel', runningBalanceCents: 95000 },
    { date: '2026-10-03', amountCents: 50000, description: 'Investor deposit', reference: ' INV-1 ' },
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.statement.lineCount, 3);
  assert.notEqual(r.statement.lines[0].lineKey, r.statement.lines[1].lineKey);
  assert.equal(r.statement.lines[2].reference, 'INV-1');
  assert.equal(r.statement.totalInCents, '50000');
  assert.equal(r.statement.totalOutCents, '5000');
  assert.ok(Object.isFrozen(r.statement.lines[0]));
});

test('closing mismatch, running balance mismatch, wrong order, bad dates and floats are rejected', () => {
  assert.deepEqual(codes(validateStatement(stmt([{ date: '2026-10-02', amountCents: -100, description: 'x' }], { closingBalanceCents: 1 }))), ['CLOSING_BALANCE_MISMATCH']);
  assert.ok(codes(validateStatement(stmt([{ date: '2026-10-02', amountCents: -100, description: 'x', runningBalanceCents: 100000 }]))).includes('RUNNING_BALANCE_MISMATCH'));
  assert.ok(codes(validateStatement(stmt([
    { date: '2026-10-05', amountCents: 1, description: 'a' }, { date: '2026-10-04', amountCents: 1, description: 'b' },
  ]))).includes('LINES_OUT_OF_ORDER'));
  assert.ok(codes(validateStatement(stmt([{ date: '2026-02-30', amountCents: 1, description: 'a' }]))).includes('INVALID_DATE'));
  assert.ok(codes(validateStatement(stmt([{ date: '2026-11-01', amountCents: 1, description: 'a' }]))).includes('DATE_OUTSIDE_PERIOD'));
  assert.ok(codes(validateStatement(stmt([{ date: '2026-10-02', amountCents: 10.5, description: 'a' }], { closingBalanceCents: 100010 }))).includes('INVALID_CENTS'));
  assert.ok(codes(validateStatement(stmt([{ date: '2026-10-02', amountCents: 0, description: 'a' }]))).includes('INVALID_CENTS'));
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-1-01'), false);
});

test('overflow: per-line max is enforced and big sums are exact in BigInt', () => {
  assert.ok(codes(validateStatement(stmt([{ date: '2026-10-02', amountCents: MAX_CENTS + 1, description: 'a' }], { closingBalanceCents: 0 }))).includes('INVALID_CENTS'));
  const big = Array.from({ length: 3 }, (_, i) => ({ date: '2026-10-02', amountCents: i % 2 ? -MAX_CENTS : MAX_CENTS, description: 'big' }));
  const r = validateStatement(stmt(big, { openingBalanceCents: 0, closingBalanceCents: MAX_CENTS }));
  assert.equal(r.ok, true);
  assert.equal(r.statement.totalInCents, String(2 * MAX_CENTS));
});

test('parseMoneyToCents is strict and float-free', () => {
  assert.equal(parseMoneyToCents('0.10'), 10);
  assert.equal(parseMoneyToCents('-1,234.56'), -123456);
  assert.equal(parseMoneyToCents('10000000000.00'), MAX_CENTS);
  assert.equal(parseMoneyToCents('10000000000.01'), null);
  for (const bad of ['0.1', '1e3', '1.234', '', 'abc', '0.105']) assert.equal(parseMoneyToCents(bad), null);
});

test('digest is stable for exact retries; overlap is rejected, never auto-deleted', () => {
  const lines = [{ date: '2026-10-02', amountCents: -100, description: 'Fee ' }];
  const a = validateStatement(stmt(lines)).statement;
  const b = validateStatement(stmt([{ date: '2026-10-02', amountCents: -100, description: '  Fee' }])).statement;
  assert.equal(a.digest, b.digest);
  assert.equal(classifyImport(b, [a]).action, 'exact_retry');
  const c = validateStatement(stmt([{ date: '2026-10-02', amountCents: -101, description: 'Fee' }])).statement;
  assert.notEqual(c.digest, a.digest);
  assert.deepEqual(classifyImport(c, [a]), { action: 'reject_overlap', digest: c.digest, overlaps: [a.digest] });
  assert.equal(classifyImport(c, [{ ...a, bankId: 'other' }]).action, 'insert');
});

test('one line to many actual entries and many lines to one entry', () => {
  const p1 = buildMatchPlan({ bankId: BANK, lines: [line('L1', -30000)],
    entries: [entry('company_payment', 'p1', -10000), entry('company_payment', 'p2', -20000)],
    groups: [group(['L1'], [['company_payment', 'p1'], ['company_payment', 'p2']])] });
  assert.equal(p1.ok, true);
  assert.equal(p1.plan.allocations.length, 2);
  assert.equal(p1.plan.totalCents, '-30000');
  const p2 = buildMatchPlan({ bankId: BANK, lines: [line('L1', 40000), line('L2', 60000)],
    entries: [entry('investor_cash', 'c1', 100000)], groups: [group(['L1', 'L2'], [['investor_cash', 'c1']])] });
  assert.equal(p2.ok, true);
  assert.deepEqual(p2.plan.sourceTotals[0], { sourceKey: 'investor_cash:c1', amountCents: 100000, previouslyAllocatedCents: 0, newAllocatedCents: 100000, remainingCents: 0, fullyMatched: true });
  assert.ok(Object.isFrozen(p2.plan.allocations));
});

test('plan digest is order independent', () => {
  const base = { bankId: BANK, lines: [line('L1', -30000)],
    entries: [entry('company_payment', 'p1', -10000), entry('company_payment', 'p2', -20000)] };
  const a = buildMatchPlan({ ...base, groups: [group(['L1'], [['company_payment', 'p1'], ['company_payment', 'p2']])] });
  const b = buildMatchPlan({ ...base, entries: [...base.entries].reverse(), groups: [group(['L1'], [['company_payment', 'p2'], ['company_payment', 'p1']])] });
  assert.equal(a.plan.digest, b.plan.digest);
});

test('partial and many-to-many need explicit allocations; prior allocations count', () => {
  const lines = [line('L1', 50000), line('L2', 50000, { allocatedCents: 20000 })];
  const entries = [entry('investor_cash', 'c1', 40000), entry('company_receipt', 'r1', 60000)];
  const g = [['investor_cash', 'c1'], ['company_receipt', 'r1']];
  assert.deepEqual(codes(buildMatchPlan({ bankId: BANK, lines, entries, groups: [group(['L1', 'L2'], g)] })), ['MANY_TO_MANY_NEEDS_ALLOCATIONS']);
  const ok = buildMatchPlan({ bankId: BANK, lines, entries, groups: [group(['L1', 'L2'], g, { allocations: [
    { lineKey: 'L1', sourceType: 'investor_cash', sourceId: 'c1', amountCents: 40000 },
    { lineKey: 'L1', sourceType: 'company_receipt', sourceId: 'r1', amountCents: 10000 },
    { lineKey: 'L2', sourceType: 'company_receipt', sourceId: 'r1', amountCents: 20000 },
  ] })] });
  assert.equal(ok.ok, true);
  const l2 = ok.plan.lineTotals.find((t) => t.lineKey === 'L2');
  assert.equal(l2.remainingCents, 10000);
  assert.equal(l2.fullyMatched, false);
  // L2 has only 30000 left: 40000 overallocates even though the raw line is 50000.
  const over = buildMatchPlan({ bankId: BANK, lines, entries, groups: [group(['L2'], [['company_receipt', 'r1']], { allocations: [
    { lineKey: 'L2', sourceType: 'company_receipt', sourceId: 'r1', amountCents: 40000 }] })] });
  assert.deepEqual(codes(over), ['OVER_ALLOCATED_LINE']);
});

test('overallocation across groups and unequal totals are rejected', () => {
  const entries = [entry('company_payment', 'p1', -10000)];
  const twice = buildMatchPlan({ bankId: BANK, lines: [line('L1', -10000), line('L2', -10000)], entries,
    groups: [group(['L1'], [['company_payment', 'p1']]), group(['L2'], [['company_payment', 'p1']])] });
  assert.ok(codes(twice).includes('GROUP_TOTALS_DIFFER'));
  const differ = buildMatchPlan({ bankId: BANK, lines: [line('L1', -10001)], entries, groups: [group(['L1'], [['company_payment', 'p1']])] });
  assert.deepEqual(codes(differ), ['GROUP_TOTALS_DIFFER']);
  const srcOver = buildMatchPlan({ bankId: BANK, lines: [line('L1', -20000)], entries, groups: [group(['L1'], [['company_payment', 'p1']], {
    allocations: [{ lineKey: 'L1', sourceType: 'company_payment', sourceId: 'p1', amountCents: -15000 }] })] });
  assert.deepEqual(codes(srcOver), ['OVER_ALLOCATED_SOURCE']);
});

test('different bank, wrong sign, internal/non-cash entries and unconfirmed groups are rejected', () => {
  const run = (entries, lines = [line('L1', -10000)], groups) => buildMatchPlan({ bankId: BANK, lines, entries,
    groups: groups ?? [group(['L1'], [[entries[0].sourceType, entries[0].sourceId]])] });
  assert.deepEqual(codes(run([entry('company_payment', 'p1', -10000, { bankId: 'other' })])), ['CROSS_BANK']);
  assert.deepEqual(codes(run([entry('company_payment', 'p1', -10000)], [line('L1', -10000, { bankId: 'other' })])), ['CROSS_BANK']);
  assert.deepEqual(codes(run([entry('company_payment', 'p1', 10000)])), ['WRONG_SIGN']);
  assert.deepEqual(codes(run([entry('company_receipt', 'r1', -10000)])), ['WRONG_SIGN']);
  assert.deepEqual(codes(run([entry('investor_cash', 'c1', 10000)])), ['GROUP_TOTALS_DIFFER']);
  for (const t of ['company_profit', 'internal_allocation', 'opening_balance', 'approved_bill', 'sale_agreement']) {
    assert.deepEqual(codes(run([entry(t, 'x', -10000)])), ['NOT_ACTUAL_CASH'], t);
  }
  assert.deepEqual(codes(run([entry('company_payment', 'p1', -10000, { actual: false })])), ['NOT_ACTUAL_CASH']);
  assert.deepEqual(codes(run([entry('mystery', 'p1', -10000)])), ['UNKNOWN_SOURCE_TYPE']);
  assert.deepEqual(codes(run([entry('company_payment', 'p1', -10000)], undefined, [{ ...group(['L1'], [['company_payment', 'p1']]), confirmed: false }])), ['UNCONFIRMED_MATCH']);
});

test('same id in different source namespaces does not collide; duplicates in one namespace do', () => {
  const ok = buildMatchPlan({ bankId: BANK, lines: [line('L1', 30000)],
    entries: [entry('investor_cash', 'id-1', 10000), entry('company_receipt', 'id-1', 20000)],
    groups: [group(['L1'], [['investor_cash', 'id-1'], ['company_receipt', 'id-1']])] });
  assert.equal(ok.ok, true);
  const dup = buildMatchPlan({ bankId: BANK, lines: [line('L1', 30000)],
    entries: [entry('investor_cash', 'id-1', 10000), entry('investor_cash', 'id-1', 20000)], groups: [] });
  assert.deepEqual(codes(dup), ['DUPLICATE_SOURCE']);
});

test('suggestions rank but never match; ambiguity and reference collisions stay ambiguous', () => {
  const lines = [line('L1', -5000, { date: '2026-10-05', reference: 'ref-9' }), line('L2', -7000, { date: '2026-10-05' }), line('L3', -1, { date: '2026-10-05' })];
  const entries = [
    entry('company_payment', 'a', -5000, { reference: 'REF-9', paidOn: '2026-10-06' }),
    entry('company_payment', 'b', -5000, { reference: 'ref-9', paidOn: '2026-10-05' }),
    entry('company_payment', 'c', -5000, { paidOn: '2026-10-04' }),
    entry('company_payment', 'd', -7000, { paidOn: '2026-10-05' }),
    entry('company_profit', 'e', -1),
    entry('company_payment', 'f', -7000, { bankId: 'other' }),
  ];
  const s = suggestMatches({ bankId: BANK, lines, entries });
  assert.equal(s[0].status, 'ambiguous');
  assert.deepEqual(s[0].candidates.map((c) => c.sourceId), ['b', 'a', 'c']);
  assert.equal(s[0].candidates[0].referenceShared, true);
  assert.equal(s[1].status, 'single_candidate');
  assert.equal(s[2].status, 'none');
  assert.ok(s.every((x) => x.requiresConfirmation === true && !('matched' in x)));
});
