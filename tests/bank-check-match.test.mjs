import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appSaysAt, bankMoves, bankSaysAt, guessPayee, lineIds, lineState, matchLines, samePlate } from '../src/lib/bankCheckMatch.ts';

const BANK = 'acct-bank-uc-x';
const line = (id, date, cents, details = {}, status = 'unmatched') => ({ id, date, cents, text: '', status, details: { bankId: 'b', ...details } });
const je = (id, date, description, debit, credit) => ({ id, date, description, voided: false, lines: [{ accountId: BANK, debit, credit }, { accountId: 'acct-ap', debit: credit, credit: debit }] });

test('books entries become bank movements, voided ones are left out', () => {
  const moves = bankMoves([je('a', '2026-11-02', 'Payment recorded: Skk', 0, 180), { ...je('b', '2026-11-02', 'x', 0, 5), voided: true }, je('c', '2026-11-03', 'Received', 10000, 0)], BANK);
  assert.deepEqual(moves.map((m) => [m.id, m.cents]), [['a', -18000], ['c', 1000000]]);
});

test('a line matches one entry of the same day and amount, each entry only once', () => {
  const moves = bankMoves([je('a', '2026-11-02', 'Payment recorded: A', 0, 100), je('b', '2026-11-03', 'Payment recorded: B', 0, 100)], BANK);
  const m = matchLines([line('l1', '2026-11-02', -10000), line('l2', '2026-11-02', -10000), line('l3', '2026-11-04', -10000)], moves);
  assert.deepEqual([...m.entries()], [['l1', ['a']]]);
});

test('a bulk transfer matches all entries of that day for the same payee', () => {
  const moves = bankMoves([je('a', '2026-11-02', 'Payment recorded: Skk', 0, 180), je('b', '2026-11-02', 'Payment recorded: Skk', 0, 890), je('c', '2026-11-02', 'Payment recorded: Other', 0, 1070)], BANK);
  const m = matchLines([line('bulk', '2026-11-02', -107000)], moves);
  assert.deepEqual(m.get('bulk'), ['c']);
  const m2 = matchLines([line('other', '2026-11-02', -107000), line('bulk', '2026-11-02', -107000)], moves);
  assert.deepEqual(m2.get('other'), ['c']);
  assert.deepEqual(m2.get('bulk'), ['a', 'b']);
});

test('a line recorded from the page keeps its own entries', () => {
  const moves = bankMoves([je('a', '2026-11-02', 'P', 0, 100), je('b', '2026-11-02', 'P', 0, 100)], BANK);
  const m = matchLines([line('l1', '2026-11-02', -10000), line('l2', '2026-11-02', -10000, { done: { how: 'recorded', journalIds: ['b'], at: '', by: '' } })], moves);
  assert.deepEqual(m.get('l2'), ['b']);
  assert.deepEqual(m.get('l1'), ['a']);
});

test('line states', () => {
  const bal = (id) => ({ x: 50000, y: 52400 })[id] ?? 0;
  assert.equal(lineState(line('l', '2026-11-17', -102400, { billIds: ['x', 'y'] }), false, bal), 'ready');
  assert.equal(lineState(line('l', '2026-11-17', -102400, { billIds: ['x'] }), false, bal), 'needs');
  assert.equal(lineState(line('l', '2026-11-17', 102400, { billIds: ['x', 'y'] }), false, bal), 'needs');
  assert.equal(lineState(line('l', '2026-11-17', -102400, { answer: { kind: 'office', at: '', by: '' } }), false, bal), 'answered');
  assert.equal(lineState(line('l', '2026-11-17', -102400), true, bal), 'done');
  assert.equal(lineState(line('l', '2026-11-17', -102400, {}, 'matched'), false, bal), 'done');
});

test('line ids are fixed, so the same statement adds nothing twice', () => {
  const rows = [{ date: '2026-11-02', cents: -18000 }, { date: '2026-11-02', cents: -18000 }, { date: '2026-11-03', cents: 1000000 }];
  const a = lineIds('8ba304ba-33c1', rows);
  assert.deepEqual(a, ['bc-8ba304ba-2026-11-02-o18000-1', 'bc-8ba304ba-2026-11-02-o18000-2', 'bc-8ba304ba-2026-11-03-i1000000-1']);
  assert.deepEqual(lineIds('8ba304ba-33c1', rows), a);
});

test('bank and app balances', () => {
  const lines = [line('a', '2026-11-01', -1000, { seq: 1, balanceCents: 99000 }), line('b', '2026-11-02', 500, { seq: 2, balanceCents: 99500 })];
  assert.equal(bankSaysAt(lines, 100000, '2026-11-02'), 99500);
  assert.equal(bankSaysAt(lines, 100000, '2026-11-01'), 99000);
  assert.equal(bankSaysAt([line('a', '2026-11-01', -1000), line('b', '2026-11-02', 500)], 100000, '2026-11-30'), 99500);
  const moves = [{ id: 'm', date: '2026-12-01', label: '', cents: -300 }, { id: 'n', date: '2026-11-02', label: '', cents: 500 }];
  assert.equal(appSaysAt(10000, moves, '2026-11-30'), 10300);
});

test('payee guess and plates', () => {
  assert.equal(guessPayee('SKK PREMIUM AUTO SERVICE WORKSHOP OCTOBER', ['Sam Hin Auto Service', 'Skk Premium Auto Service', 'Benry Auto Sdn Bhd']), 'Skk Premium Auto Service');
  assert.equal(guessPayee('AUTO SERVICE SDN BHD', ['Sam Hin Auto Service']), undefined);
  assert.ok(samePlate('qaa 1234 a', 'QAA1234A'));
  assert.ok(!samePlate('', 'QAA1234A'));
});
