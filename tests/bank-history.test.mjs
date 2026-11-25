import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billSplit, historyState, monthTallies, readCheckedLines, suggestions } from '../src/lib/bankHistory.ts';

// Made-up figures only.
const BANK = { openingDate: '2026-11-01', openingCents: 15000 };
const file = (over = {}) => ({
  format: 'autodream-bank-lines-1', openingCents: 0, closingCents: 15000,
  months: [
    { month: '2026-09', openingCents: 0, closingCents: 20000, creditCents: 30000, credits: 1, debitCents: 10000, debits: 2 },
    { month: '2026-10', openingCents: 20000, closingCents: 15000, creditCents: 0, credits: 0, debitCents: 5000, debits: 1 },
  ],
  lines: [
    { date: '2026-09-02', cents: 30000, balanceCents: 30000, type: 'DUITNOW TRSF CR', who: 'A CUSTOMER', memo: 'car', ref: '' },
    { date: '2026-09-05', cents: -10000, balanceCents: 20000, type: 'DUITNOW TRSF DR', who: 'A WORKSHOP', memo: '', ref: '' },
    { date: '2026-09-05', cents: 0, balanceCents: 20000, type: 'SST DR', who: '', memo: '', ref: '' },
    { date: '2026-10-01', cents: -5000, balanceCents: 15000, type: 'DUITNOW TRSF DR', who: 'A SHOP', memo: '', ref: '' },
  ],
  ...over,
});
const line = (id, date, cents, details = {}) => ({ id, date, cents, text: '', status: 'unmatched', details: { bankId: 'b', history: true, ...details } });
const none = () => 0, noMove = () => undefined;

test('a file whose every balance follows and whose months match their statements is loaded, RM 0.00 lines left out', () => {
  const r = readCheckedLines(file(), BANK);
  assert.equal(r.problem, undefined);
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.months.map((m) => m.month), ['2026-09', '2026-10']);
});

test('one sen out anywhere and nothing is loaded', () => {
  const f = file(); f.lines[1].cents = -10001;
  assert.match(readCheckedLines(f, BANK).problem, /Line 2 .*does not follow/);
});

test('a month whose count or total differs from its statement is refused', () => {
  const f = file(); f.months[0].debits = 1;
  assert.match(readCheckedLines(f, BANK).problem, /September 2026: money out/);
  const g = file(); g.months[1].closingCents = 14999;
  assert.match(readCheckedLines(g, BANK).problem, /October 2026's lines end/);
});

test('the file must end where the app starts the bank, and hold only earlier dates', () => {
  assert.match(readCheckedLines(file(), { ...BANK, openingCents: 1 }).problem, /must be the same/);
  const f = file(); f.lines[3].date = '2026-11-01'; f.months[1].month = '2026-11';
  assert.match(readCheckedLines(f, BANK).problem, /on or after 2026-11-01/);
  assert.match(readCheckedLines({ lines: [] }, BANK).problem, /not a checked-lines file/);
});

test('a line is matched when drafts explain it to the sen, answered when said what it was', () => {
  const bills = new Map([['b1', 6000], ['b2', 4000]]);
  const billCents = (id) => bills.get(id) ?? 0;
  assert.equal(historyState(line('l', '2026-09-05', -10000), billCents, noMove), 'needs');
  assert.equal(historyState(line('l', '2026-09-05', -10000, { billIds: ['b1'], answer: { kind: 'bills' } }), billCents, noMove), 'part');
  assert.equal(historyState(line('l', '2026-09-05', -10000, { billIds: ['b1'], toAdd: [{ plate: 'X1', what: 'Tyre', cents: 4000 }] }), billCents, noMove), 'linked');
  assert.equal(historyState(line('l', '2026-09-05', -10000, { answer: { kind: 'salary' } }), billCents, noMove), 'answered');
  assert.equal(historyState(line('l', '2026-09-02', 30000, { linkIds: ['e1'] }), billCents, (id) => (id === 'e1' ? 30000 : undefined)), 'linked');
  // Linked to an entry with a different amount, and nothing said: still to finish.
  assert.equal(historyState(line('l', '2026-09-02', 30000, { linkIds: ['e1'] }), billCents, () => 29000), 'part');
});

test('a run of one payee\'s bills keyed one after another that adds up exactly is the split', () => {
  const bills = [
    { id: 'a', cents: 1000, date: '2026-08-01', label: '', payee: 'W' },
    { id: 'b', cents: 2000, date: '2026-08-03', label: '', payee: 'W' },
    { id: 'c', cents: 3000, date: '2026-08-04', label: '', payee: 'W' },
    { id: 'd', cents: 9000, date: '2026-09-20', label: '', payee: 'W' }, // keyed after the transfer + 3 days
  ];
  assert.deepEqual(billSplit(line('l', '2026-09-05', -5000), bills).map((b) => b.id), ['b', 'c']);
  assert.equal(billSplit(line('l', '2026-09-05', -9000), bills), null);
  assert.equal(billSplit(line('l', '2026-09-05', -5000), bills, new Set(['b'])), null);
});

test('suggestions: books entry nearest day first, then a payee split, then one bill; each used once', () => {
  const lines = [line('in', '2026-09-02', 30000), line('o1', '2026-09-05', -3000, { who: 'A WORKSHOP' }), line('o2', '2026-09-06', -700), line('done', '2026-09-07', -700, { answer: { kind: 'other' } })];
  const moves = [{ id: 'far', date: '2026-09-20', label: '', cents: 30000 }, { id: 'near', date: '2026-09-03', label: '', cents: 30000 }];
  const bills = [{ id: 'x', cents: 1000, date: '2026-09-01', label: '', payee: 'A Workshop' }, { id: 'y', cents: 2000, date: '2026-09-02', label: '', payee: 'A Workshop' }, { id: 'z', cents: 700, date: '2026-09-04', label: '', payee: 'Shop' }];
  const s = suggestions(lines, moves, bills, (l) => (l.details.who ? 'A Workshop' : undefined));
  assert.equal(s.get('in').move.id, 'near');
  assert.deepEqual(s.get('o1').bills.map((b) => b.id), ['x', 'y']);
  assert.deepEqual(s.get('o2').bills.map((b) => b.id), ['z']);
  assert.equal(s.has('done'), false);
});

test('a month is ready only when every line is answered and every books entry is accounted for', () => {
  const lines = [line('a', '2026-09-02', 30000, { balanceCents: 30000, seq: 1 }), line('b', '2026-09-05', -10000, { balanceCents: 20000, seq: 2 })];
  const moves = [{ id: 'e1', date: '2026-09-02', label: 'Sale', cents: 30000 }, { id: 'e2', date: '2026-09-10', label: 'Car bought', cents: -18500 }];
  let states = new Map([['a', 'linked'], ['b', 'needs']]);
  let [t] = monthTallies(lines, states, moves, () => undefined);
  assert.equal(t.openingCents, 0); assert.equal(t.closingCents, 20000);
  assert.equal(t.done, false); assert.equal(t.unlinked.length, 2);
  lines[0].details.linkIds = ['e1'];
  states = new Map([['a', 'linked'], ['b', 'answered']]);
  [t] = monthTallies(lines, states, moves, () => undefined);
  assert.deepEqual(t.undecided.map((m) => m.id), ['e2']);
  assert.equal(t.answeredOutCents, 10000);
  assert.equal(t.done, false);
  [t] = monthTallies(lines, states, moves, (id) => (id === 'e2' ? { how: 'wrong', at: '', by: '' } : undefined));
  assert.equal(t.done, true);
});
