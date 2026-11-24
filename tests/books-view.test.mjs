import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountTotals, bankCents, billFinder, isOpening, entryAmount, entryEffects, entryGap, entryKind, entryProofs, entryWords,
  monthRange, ownOwe, perHundred, plainAccount,
} from '../src/lib/booksView.ts';

const ACCTS = [
  { id: 'acct-bank-uc-1', name: 'Public Bank', type: 'asset' },
  { id: 'acct-bank-operating', name: 'Bank — Operating', type: 'asset' },
  { id: 'acct-inv-own', name: 'Inventory — Own Stock', type: 'asset' },
  { id: 'acct-ar', name: 'Accounts Receivable', type: 'asset' },
  { id: 'acct-ap', name: 'Accounts Payable', type: 'liability' },
  { id: 'acct-opening-review', name: 'Opening balance waiting for review', type: 'equity' },
  { id: 'acct-rev-car-sales', name: 'Car Sales Revenue', type: 'revenue' },
  { id: 'acct-cogs-own', name: 'COGS — Own Stock', type: 'cogs' },
  { id: 'acct-exp-salesman-comm', name: 'Salesman Commission Expense', type: 'expense' },
];
const byId = new Map(ACCTS.map((a) => [a.id, a]));
const L = (accountId, debit, credit = 0) => ({ accountId, debit, credit });
const E = (o) => ({ id: 'e', date: '2026-11-17', description: '', lines: [], ...o });

test('plain names: known accounts, bank accounts by their own name, others keep theirs', () => {
  assert.equal(plainAccount(byId.get('acct-ap')).name, 'Bills still to pay');
  assert.equal(plainAccount(byId.get('acct-inv-own')).name, 'Cars in stock');
  assert.equal(plainAccount(byId.get('acct-bank-uc-1')).name, 'Public Bank');
  const own = plainAccount({ id: 'x1', name: 'EWP', type: 'expense' });
  assert.equal(own.name, 'EWP');
  assert.match(own.explain, /cost/);
});

test('what we own and owe adds up when every entry balances', () => {
  const entries = [
    E({ lines: [L('acct-bank-uc-1', 100000), L('acct-opening-review', 0, 100000)] }),
    E({ lines: [L('acct-inv-own', 2000), L('acct-ap', 0, 2000)] }),
    E({ lines: [L('acct-ar', 72000), L('acct-rev-car-sales', 0, 72000), L('acct-cogs-own', 44943.93), L('acct-inv-own', 0, 44943.93)] }),
    E({ lines: [L('acct-exp-salesman-comm', 1500), L('acct-ap', 0, 1500)] }),
    E({ voided: true, lines: [L('acct-inv-own', 90), L('acct-ap', 0, 90)] }),
  ];
  const b = ownOwe(ACCTS, accountTotals(entries));
  assert.equal(b.gapCents, 0);
  assert.equal(b.oweCents, 350000);
  assert.equal(b.profitCents, 7200000 - 4494393 - 150000);
  assert.equal(b.ours.find((x) => x.id === 'profit').cents, b.profitCents);
  assert.equal(b.own[0].name, 'Public Bank');
  assert.ok(!b.own.some((x) => x.id === 'acct-inv-own' && x.cents === 0));
});

test('an entry that does not balance shows as the gap, and only that entry', () => {
  const known = new Set(ACCTS.map((a) => a.id));
  const good = E({ lines: [L('acct-inv-own', 500), L('acct-ap', 0, 500)] });
  const bad = E({ lines: [L('acct-inv-own', 914.28), L('acct-unknown', 0, 914.28)] });
  const b = ownOwe(ACCTS, accountTotals([good, bad]));
  assert.equal(b.gapCents, 91428);
  assert.equal(entryGap(good, known), 0);
  assert.equal(entryGap(bad, known), 91428);
  assert.equal(entryGap({ ...bad, voided: true }, known), 0);
});

test('kinds: sale, purchase, money in and out, staff, bill keyed', () => {
  assert.equal(entryKind(E({ sourceType: 'car_sold', lines: [L('acct-ar', 1), L('acct-rev-car-sales', 0, 1)] })), 'sold');
  assert.equal(entryKind(E({ sourceType: 'car_purchased', lines: [L('acct-inv-own', 1), L('acct-bank-operating', 0, 1)] })), 'bought');
  assert.equal(entryKind(E({ sourceType: 'repair_paid', lines: [L('acct-ap', 30), L('acct-bank-uc-1', 0, 30)] })), 'out');
  assert.equal(entryKind(E({ sourceType: 'disbursement_received', lines: [L('acct-bank-operating', 50), L('acct-ar', 0, 50)] })), 'in');
  assert.equal(entryKind(E({ sourceType: 'salesman_commission', lines: [L('acct-exp-salesman-comm', 1), L('acct-ap', 0, 1)] })), 'staff');
  assert.equal(entryKind(E({ sourceType: 'repair', lines: [L('acct-inv-own', 1), L('acct-ap', 0, 1)] })), 'cost');
  assert.equal(entryKind(E({ lines: [L('acct-ar', 1), L('acct-inv-own', 0, 1)] })), 'other');
  const opening = E({ sourceId: 'opening:b1', description: 'Registered bank opening; old bank cleared, difference awaits statement review', lines: [L('acct-bank-uc-1', 374045.8), L('acct-bank-operating', 0, 365260.08), L('acct-opening-review', 0, 8785.72)] });
  assert.equal(entryKind(opening), 'other');
  assert.equal(isOpening(opening), true);
  assert.equal(entryAmount(opening), 37404580);
  assert.equal(entryWords(opening.description).title, 'Bank starting figures');
});

test('amount is the bank move when money moved, else the entry size', () => {
  assert.equal(entryAmount(E({ lines: [L('acct-ap', 30), L('acct-bank-uc-1', 0, 30)] })), -3000);
  assert.equal(bankCents(E({ lines: [L('acct-bank-operating', 51233.22), L('acct-ar', 0, 51233.22)] })), 5123322);
  assert.equal(entryAmount(E({ lines: [L('acct-inv-own', 2000), L('acct-ap', 0, 2000)] })), 200000);
  const sale = E({ sourceType: 'car_sold', lines: [L('acct-ar', 60000), L('acct-bank-uc-1', 12000), L('acct-rev-car-sales', 0, 72000), L('acct-cogs-own', 44943.93), L('acct-inv-own', 0, 44943.93)] });
  assert.equal(entryAmount(sale), 7200000);
});

test('effects say which way each account went, in plain words', () => {
  const fx = entryEffects(E({ lines: [L('acct-ap', 30), L('acct-bank-uc-1', 0, 30)] }), byId);
  assert.deepEqual(fx.map((f) => [f.name, f.cents]), [['Bills still to pay', -3000], ['Public Bank', -3000]]);
  const keyed = entryEffects(E({ lines: [L('acct-inv-own', 2000), L('acct-ap', 0, 2000)] }), byId);
  assert.deepEqual(keyed.map((f) => [f.name, f.cents]), [['Cars in stock', 200000], ['Bills still to pay', 200000]]);
  const same = entryEffects(E({ lines: [L('acct-inv-own', 10), L('acct-inv-own', 0, 10)] }), byId);
  assert.equal(same.length, 0);
});

test('titles lose the accounting words', () => {
  assert.deepEqual(entryWords('Repair recognized — Spray paint'), { title: 'Repair bill', detail: 'Spray paint' });
  assert.deepEqual(entryWords('Disbursement received — 2020 Proton X50 (VGK1714)'), { title: 'Loan money came in', detail: '2020 Proton X50 (VGK1714)' });
  assert.deepEqual(entryWords('Car sold — VRL6442'), { title: 'Car sold', detail: 'VRL6442' });
  assert.deepEqual(entryWords('Spray paint repair'), { title: 'Spray paint repair', detail: '' });
  assert.equal(entryWords('Commission paid — Voon').title, 'Commission paid');
});

test('bill finder: by bill id, and commission entries by car', () => {
  const find = billFinder([{ id: 'p1', type: 'repair', carId: 'c1' }, { id: 'p2', type: 'salesman_commission', carId: 'c1' }]);
  assert.equal(find({ sourceId: 'p1', sourceType: 'repair' }), 'p1');
  assert.equal(find({ sourceId: 'c1', sourceType: 'salesman_commission', carId: 'c1' }), 'p2');
  assert.equal(find({ sourceId: 'p9', sourceType: 'salesman_commission_paid', carId: 'c1' }), 'p2');
  assert.equal(find({ sourceId: 'c1', sourceType: 'car_sold', carId: 'c1' }), undefined);
});

test('proofs: what each entry has, lacks, or waits for', () => {
  const base = { voided: false, gapCents: 0, bill: null, bank: 'none', moneyIn: null };
  const s = (xs) => xs.map((p) => `${p.label}:${p.state}`).join(' ');
  assert.equal(s(entryProofs({ ...base, kind: 'cost', bill: { paid: false, doc: 'need_invoice' } })), 'Bill:yes Invoice:no Paid:wait');
  assert.equal(s(entryProofs({ ...base, kind: 'out', bill: { paid: true, doc: 'ok' }, bank: 'matched' })), 'Bill:yes Receipt:yes Statement:yes');
  assert.equal(s(entryProofs({ ...base, kind: 'in', bank: 'unmatched' })), 'Statement:wait');
  assert.equal(s(entryProofs({ ...base, kind: 'sold', moneyIn: false })), 'Sale:yes Money in:wait');
  assert.equal(s(entryProofs({ ...base, kind: 'cost', voided: true })), 'Cancelled, no longer counts:wait');
  assert.equal(s(entryProofs({ ...base, kind: 'other', gapCents: 5 })), "Doesn't add up:no");
});

test('per RM 100: adds to exactly RM 100 when the parts make the total', () => {
  const parts = [{ key: 'car', cents: 16610000 }, { key: 'rep', cents: 406600 }, { key: 'oth', cents: 1802937 }, { key: 'com', cents: 800000 }, { key: 'pro', cents: 3428759 }];
  const total = parts.reduce((s, p) => s + p.cents, 0);
  const out = perHundred(parts, total);
  assert.equal(out.reduce((s, p) => s + p.per100, 0), 10000);
  assert.equal(out[0].per100, 7207);
  assert.deepEqual(perHundred([{ key: 'a', cents: 5 }], 0), [{ key: 'a', per100: 0 }]);
  assert.equal(perHundred([{ key: 'a', cents: 110 }], 100)[0].per100, 11000);
});

test('month range runs across the year end', () => {
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthRange('2026-11', '2026-10'), []);
  assert.deepEqual(monthRange('bad', '2026-10'), []);
});
