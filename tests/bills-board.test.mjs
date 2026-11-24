import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageDays, billBlock, billKind, docCoverage, docState, inBucket, monthBuckets, myDay, namesLabel, paidGroups, payeeCore, payeeGroups } from '../src/lib/billsBoard.ts';

const bill = (o) => ({ id: 'b', type: 'repair', status: 'pending', recipientType: 'workshop', recipientId: 'w1', recipientName: 'Hub Seng', amount: 100, createdAt: '2026-11-02T03:00:00Z', ...o });
const cents = (p) => Math.round(p.amount * 100);

test('kinds put each bill type in one plain group', () => {
  assert.equal(billKind('repair'), 'repairs');
  assert.equal(billKind('panel_charge'), 'repairs');
  assert.equal(billKind('misc_cost'), 'car_costs');
  assert.equal(billKind('salary'), 'staff_pay');
  assert.equal(billKind('consignment_payout'), 'consignment');
  assert.equal(billKind('customer_refund'), 'other');
});

test('Malaysia day moves late-evening UTC times to the next day', () => {
  assert.equal(myDay('2026-10-31T17:00:00Z'), '2026-11-01');
  assert.equal(myDay('2026-11-10'), '2026-11-10');
  assert.equal(myDay(''), '');
});

test('payee groups: one per payee, newest bill first, newest name shown', () => {
  const g = payeeGroups([
    bill({ id: 'a', createdAt: '2026-10-01T00:00:00Z', recipientName: 'HUB SENG' }),
    bill({ id: 'b', createdAt: '2026-11-05T00:00:00Z', amount: 50 }),
    bill({ id: 'c', recipientId: 'w2', recipientName: 'LM Motor', createdAt: '2026-11-01T00:00:00Z' }),
  ], cents);
  assert.deepEqual(g.map((x) => [x.name, x.bills.map((b) => b.id), x.cents]), [['Hub Seng', ['b', 'a'], 15000], ['LM Motor', ['c'], 10000]]);
});

test('look-alike shop names are flagged across all bills, even ones filtered out', () => {
  assert.equal(payeeCore('Sam Hin Auto Service'), 'sam hin');
  assert.equal(payeeCore('SAM HIN'), 'sam hin');
  const all = [
    bill({ id: 'a', recipientId: 'w1', recipientName: 'SAM HIN', type: 'repair' }),
    bill({ id: 'b', recipientId: 'w2', recipientName: 'Sam Hin Auto Service', type: 'misc_cost' }),
    bill({ id: 'c', recipientId: 'w3', recipientName: 'Benry Auto Sdn Bhd', createdAt: '2026-10-02T03:00:00Z' }),
  ];
  const g = payeeGroups(all, cents, (p) => p.type === 'repair');
  assert.deepEqual(g.map((x) => [x.name, x.sameAs]), [['SAM HIN', ['Sam Hin Auto Service']], ['Benry Auto Sdn Bhd', []]]);
});

test('a panel still to be chosen is flagged', () => {
  const g = payeeGroups([bill({ recipientId: 'Panel (to be chosen)', recipientName: 'Panel (to be chosen)', recipientType: 'merchant' })], cents);
  assert.equal(g[0].needsPanel, true);
});

test('bills that cannot be ticked say why', () => {
  assert.equal(billBlock(bill({})), null);
  assert.match(billBlock(bill({ id: 'uc_commission_1' })), /car bill/);
  assert.match(billBlock(bill({ type: 'customer_refund' })), /bank details/);
  assert.match(billBlock(bill({ type: 'expense_claim', recipientType: 'merchant', recipientId: '' })), /vendor/);
  assert.match(billBlock(bill({ type: 'expense_claim', recipientType: 'user' })), /Check the claim/);
  assert.equal(billBlock(bill({ type: 'expense_claim', recipientType: 'user', claimConfirmedBy: 'u' })), null);
  assert.match(billBlock(bill({ status: 'transferred' })), /settled/);
});

test('month buckets: last n months plus one bucket for anything older', () => {
  const bills = [
    bill({ id: 'a', createdAt: '2026-01-10T00:00:00Z' }),
    bill({ id: 'b', createdAt: '2026-10-31T17:00:00Z' }), // 1 Nov in Malaysia
    bill({ id: 'c', createdAt: '2026-11-20T00:00:00Z', amount: 5 }),
    bill({ id: 'd', createdAt: '2026-12-01T00:00:00Z' }), // after the last month: left out
  ];
  const b = monthBuckets(bills, cents, '2026-11', 3);
  assert.deepEqual(b.map((x) => [x.month, x.before, x.count, x.cents]), [['2026-09', true, 1, 10000], ['2026-09', false, 0, 0], ['2026-10', false, 0, 0], ['2026-11', false, 2, 10500]]);
  assert.equal(inBucket(bills[0], b[0]), true);
  assert.equal(inBucket(bills[1], b[3]), true);
  assert.equal(monthBuckets([bills[2]], cents, '2026-11', 3).length, 3);
});

test('paperwork: listed bills show what is missing; older unlisted ones are unknown', () => {
  const items = [
    { paymentId: 'x', date: '2026-11-10T00:00:00Z', needInvoice: true, needReceipt: false },
    { paymentId: 'y', date: '2026-11-01T00:00:00Z', needInvoice: true, needReceipt: true },
  ];
  const part = docCoverage(items, 900);
  assert.equal(docState(part, { id: 'x', createdAt: '2026-11-10T00:00:00Z' }), 'need_invoice');
  assert.equal(docState(part, { id: 'y', createdAt: '2026-11-01T00:00:00Z' }), 'need_both');
  assert.equal(docState(part, { id: 'z', createdAt: '2026-11-05T00:00:00Z' }), 'ok');
  assert.equal(docState(part, { id: 'z', createdAt: '2026-09-05T00:00:00Z' }), 'unknown');
  assert.equal(docState(part, { id: 'z', createdAt: '2026-09-05T00:00:00Z', transferredAt: '2026-11-20T00:00:00Z' }), 'ok');
  assert.equal(docState(docCoverage(items, 2), { id: 'z', createdAt: '2020-01-01T00:00:00Z' }), 'ok');
  assert.equal(docState(null, { id: 'x', createdAt: '' }), 'unknown');
});

test('paid groups: bills ticked on one statement line stay together; others group by payee and day', () => {
  const paid = [
    bill({ id: 'a', status: 'transferred', transferredAt: '2026-11-10T04:00:00Z', bankPaidCents: 15000 }),
    bill({ id: 'b', status: 'transferred', transferredAt: '2026-11-10T04:00:00Z', recipientId: 'w2', recipientName: 'LM Motor' }),
    bill({ id: 'c', status: 'transferred', transferredAt: '2026-11-10T04:00:00Z' }),
    bill({ id: 'd', status: 'transferred', transferredAt: '2026-11-10T06:00:00Z' }),
    bill({ id: 'e', status: 'transferred', transferredAt: '2026-11-11T04:00:00Z' }),
  ];
  const lines = [
    { id: 'L1', date: '2026-11-10', text: 'IBG HUB SENG', details: { billIds: ['a', 'b'], done: { how: 'recorded' } } },
    { id: 'L2', date: '2026-11-10', text: 'not done yet', details: { billIds: ['c'] } },
  ];
  const g = paidGroups(paid, lines);
  assert.deepEqual(g.map((x) => [x.day, x.lineId ?? '', x.bills.map((b) => b.id).join(''), x.cents, namesLabel(x.names)]), [
    ['2026-11-11', '', 'e', 10000, 'Hub Seng'],
    ['2026-11-10', 'L1', 'ab', 25000, 'Hub Seng and LM Motor'],
    ['2026-11-10', '', 'cd', 20000, 'Hub Seng'],
  ]);
});

test('names label shortens long payee lists', () => {
  assert.equal(namesLabel(['A']), 'A');
  assert.equal(namesLabel(['A', 'B', 'C', 'D']), 'A, B and 2 more');
});

test('age in days counts Malaysia calendar days', () => {
  assert.equal(ageDays('2026-08-26T03:00:00Z', '2026-11-24'), 90);
  assert.equal(ageDays('2026-11-23T17:00:00Z', '2026-11-24'), 0);
  assert.equal(ageDays('bad', '2026-11-24'), 0);
});
