import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeRepairPrice, repairBill, repairPriceBlock } from '../src/lib/repairPriceChange.ts';

const car = { id: 'car1', carPlate: 'QAA1A' };
const bill = { id: 'bill1', type: 'repair', repairJobId: 'r1', amount: 350, status: 'pending', createdAt: '2026-11-02T03:00:00Z', carId: 'car1' };
const repair = { id: 'r1', carId: 'car1', typeOfRepair: 'Detailing', parts: [], labourCost: 350, totalCost: 350 };
const oldEntry = { id: 'je1', date: '2026-11-02', description: 'Repair recognized — Detailing', sourceType: 'repair', sourceId: 'bill1', lines: [], createdAt: '' };

function deps(fail) {
  const log = [];
  const step = (name) => async (...a) => { log.push([name, ...a.slice(0, 2)]); if (fail === name) throw new Error(name + ' failed'); };
  return {
    log,
    d: {
      journalEntries: [oldEntry, { ...oldEntry, id: 'je0', voided: true }, { ...oldEntry, id: 'other', sourceId: 'bill9' }],
      updatePayment: step('updatePayment'), voidJournalEntry: step('void'), restoreJournalEntry: step('restore'),
      addJournalEntry: async (e) => { log.push(['add', e.date, e.lines[0].debit, e.sourceId]); if (fail === 'add') throw new Error('add failed'); },
      buildEntry: (o) => ({ id: 'new', date: 'today', description: o.description, sourceType: o.sourceType, sourceId: o.sourceId, lines: [{ accountId: 'inv', debit: o.amount, credit: 0 }, { accountId: 'ap', debit: 0, credit: o.amount }], createdAt: '' }),
    },
  };
}

test('a new price changes the bill, cancels the old entry and adds one on the same date', async () => {
  const { log, d } = deps();
  assert.equal(await changeRepairPrice({ repair, bill, car, newPrice: 300, actorId: 'dir' }, d), 'changed');
  assert.deepEqual(log, [['updatePayment', 'bill1', { amount: 300 }], ['void', 'je1', 'dir'], ['add', '2026-11-02', 300, 'bill1']]);
});

test('the same price changes nothing', async () => {
  const { log, d } = deps();
  assert.equal(await changeRepairPrice({ repair, bill, car, newPrice: 350.001, actorId: 'dir' }, d), 'unchanged');
  assert.equal(log.length, 0);
});

test('a bill with no books entry gets one dated the day it was keyed', async () => {
  const { log, d } = deps();
  d.journalEntries = [];
  await changeRepairPrice({ repair, bill: { ...bill, createdAt: '2026-11-02T18:00:00Z' }, car, newPrice: 200, actorId: 'dir' }, d);
  assert.deepEqual(log.at(-1), ['add', '2026-11-03', 200, 'bill1']);
});

test('if the new entry fails, the old entry and the old price are put back', async () => {
  const { log, d } = deps('add');
  await assert.rejects(changeRepairPrice({ repair, bill, car, newPrice: 300, actorId: 'dir' }, d), /nothing was changed/);
  assert.deepEqual(log.slice(-2), [['restore', 'je1'], ['updatePayment', 'bill1', { amount: 350 }]]);
});

test('if the bill change fails, the books are not touched', async () => {
  const { log, d } = deps('updatePayment');
  await assert.rejects(changeRepairPrice({ repair, bill, car, newPrice: 300, actorId: 'dir' }, d));
  assert.deepEqual(log, [['updatePayment', 'bill1', { amount: 300 }]]);
});

test('only the Director, unpaid bills, company cars and a price above zero', () => {
  const ok = { bill, car, isDirector: true, newPrice: 300, carChanged: false };
  assert.equal(repairPriceBlock(ok), undefined);
  assert.match(repairPriceBlock({ ...ok, isDirector: false }), /Only the Director/);
  assert.match(repairPriceBlock({ ...ok, bill: { ...bill, status: 'transferred' } }), /already paid/);
  assert.match(repairPriceBlock({ ...ok, bill: { ...bill, bankPaidCents: 100 } }), /already paid/);
  assert.match(repairPriceBlock({ ...ok, car: { ...car, investorFunded: true } }), /investor car/);
  assert.match(repairPriceBlock({ ...ok, newPrice: 0 }), /more than RM 0/);
  assert.match(repairPriceBlock({ ...ok, carChanged: true }), /another car/);
  assert.equal(repairBill([{ ...bill, obligationReplaced: true }, { ...bill, id: 'b2' }], 'r1').id, 'b2');
});
