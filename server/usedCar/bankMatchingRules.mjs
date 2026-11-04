// Pure integer-cent rule engine for Used Car bank statement import and
// many-to-many matching against immutable actual cash entries.
//
// No DB, no I/O, no auth: callers (Director-only APIs) enforce access and
// persist the frozen plan objects returned here. Every money value is an
// integer number of cents; sums are done in BigInt and checked against limits.
import { createHash } from 'node:crypto';

export const MAX_CENTS = 1_000_000_000_000; // per line / entry / balance, matches DB checks
export const ENGINE_VERSION = 1;

// Real cash sources only. Namespaced so identical ids in different tables never collide.
export const ACTUAL_CASH_SOURCE_TYPES = Object.freeze(['investor_cash', 'company_payment', 'company_receipt']);
// Things that look like money but never moved through a bank on their own.
export const FORBIDDEN_SOURCE_TYPES = Object.freeze([
  'company_profit', 'internal_allocation', 'opening_balance', 'bill', 'approved_bill', 'unpaid_bill',
  'sale_agreement', 'car_sale', 'journal', 'profit_share', 'withdrawal_request',
]);
const SIGN_RULES = { company_payment: -1, company_receipt: 1, investor_cash: 0 }; // 0 = either sign

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_RE = /^(-)?(\d{1,13})(?:\.(\d{2}))?$/;

function err(code, extra = {}) { return { code, ...extra }; }

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function isRealDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isCents(v, { allowZero = false, maxAbs = MAX_CENTS } = {}) {
  return Number.isSafeInteger(v) && Math.abs(v) <= maxAbs && (allowZero || v !== 0);
}

// Strict decimal string -> cents without float math. "12.3" and "1e3" are rejected.
export function parseMoneyToCents(text) {
  if (typeof text !== 'string') return null;
  const m = MONEY_RE.exec(text.trim().replace(/,/g, ''));
  if (!m) return null;
  const cents = BigInt(m[2]) * 100n + BigInt(m[3] ?? '0');
  const signed = m[1] ? -cents : cents;
  if (signed > BigInt(MAX_CENTS) || signed < -BigInt(MAX_CENTS)) return null;
  return Number(signed);
}

function normText(s) { return typeof s === 'string' ? s.normalize('NFC').trim().replace(/\s+/g, ' ') : ''; }
function normRef(s) { return normText(s).toLowerCase(); }
function nonEmptyId(s) { return typeof s === 'string' && s.trim() === s && s.length > 0 && s.length <= 200; }
function sha256(obj) { return createHash('sha256').update(JSON.stringify(obj)).digest('hex'); }
function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function dayNumber(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; }

// ── Statement validation ──────────────────────────────────────────────────

/**
 * input: { bankId, periodStart, periodEnd, openingBalanceCents, closingBalanceCents,
 *          lines: [{ date, amountCents (signed, non-zero), description, reference?, runningBalanceCents? }] }
 * Lines are in source order, oldest first (non-decreasing dates). Identical same-day
 * lines are legitimate and kept: identity is the 1-based row ordinal, never date+amount.
 */
export function validateStatement(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return deepFreeze({ ok: false, errors: [err('INVALID_INPUT')] });
  const { bankId, periodStart, periodEnd, openingBalanceCents, closingBalanceCents, lines } = input;

  if (!nonEmptyId(bankId)) errors.push(err('INVALID_BANK_ID'));
  if (!isRealDate(periodStart)) errors.push(err('INVALID_DATE', { field: 'periodStart' }));
  if (!isRealDate(periodEnd)) errors.push(err('INVALID_DATE', { field: 'periodEnd' }));
  if (isRealDate(periodStart) && isRealDate(periodEnd) && periodStart > periodEnd) errors.push(err('PERIOD_REVERSED'));
  if (!isCents(openingBalanceCents, { allowZero: true })) errors.push(err('INVALID_CENTS', { field: 'openingBalanceCents' }));
  if (!isCents(closingBalanceCents, { allowZero: true })) errors.push(err('INVALID_CENTS', { field: 'closingBalanceCents' }));
  if (!Array.isArray(lines)) errors.push(err('INVALID_LINES'));
  if (errors.length) return deepFreeze({ ok: false, errors });

  const out = [];
  let running = BigInt(openingBalanceCents);
  let totalIn = 0n, totalOut = 0n, prevDate = null;
  lines.forEach((line, i) => {
    const ordinal = i + 1;
    if (!line || typeof line !== 'object') { errors.push(err('INVALID_LINE', { ordinal })); return; }
    const { date, amountCents, description, reference, runningBalanceCents } = line;
    if (!isRealDate(date)) errors.push(err('INVALID_DATE', { ordinal, field: 'date' }));
    else {
      if (date < periodStart || date > periodEnd) errors.push(err('DATE_OUTSIDE_PERIOD', { ordinal }));
      if (prevDate && date < prevDate) errors.push(err('LINES_OUT_OF_ORDER', { ordinal }));
      prevDate = date;
    }
    if (!isCents(amountCents)) { errors.push(err('INVALID_CENTS', { ordinal, field: 'amountCents' })); return; }
    if (!normText(description)) errors.push(err('MISSING_DESCRIPTION', { ordinal }));
    if (reference != null && typeof reference !== 'string') errors.push(err('INVALID_REFERENCE', { ordinal }));
    running += BigInt(amountCents);
    if (amountCents > 0) totalIn += BigInt(amountCents); else totalOut += BigInt(-amountCents);
    let rb = null;
    if (runningBalanceCents != null) {
      if (!isCents(runningBalanceCents, { allowZero: true })) errors.push(err('INVALID_CENTS', { ordinal, field: 'runningBalanceCents' }));
      else if (BigInt(runningBalanceCents) !== running) errors.push(err('RUNNING_BALANCE_MISMATCH', { ordinal, expectedCents: running.toString() }));
      rb = runningBalanceCents;
    }
    out.push({
      ordinal, date, amountCents, direction: amountCents > 0 ? 'credit' : 'debit',
      description: normText(description), reference: reference == null ? null : normText(reference) || null,
      runningBalanceCents: rb,
    });
  });
  if (!errors.length && running !== BigInt(closingBalanceCents)) {
    errors.push(err('CLOSING_BALANCE_MISMATCH', { computedCents: running.toString(), closingBalanceCents }));
  }
  if (errors.length) return deepFreeze({ ok: false, errors });

  const digest = sha256({
    v: ENGINE_VERSION, bankId, periodStart, periodEnd, openingBalanceCents, closingBalanceCents,
    lines: out.map((l) => [l.ordinal, l.date, l.amountCents, l.description, l.reference, l.runningBalanceCents]),
  });
  return deepFreeze({
    ok: true,
    statement: {
      digest, bankId, periodStart, periodEnd, openingBalanceCents, closingBalanceCents,
      lineCount: out.length, totalInCents: totalIn.toString(), totalOutCents: totalOut.toString(),
      lines: out.map((l) => ({ ...l, lineKey: `${digest}:${l.ordinal}` })),
    },
  });
}

/**
 * Decide what to do with a validated statement given imports already stored for any bank.
 * existing: [{ digest, bankId, periodStart, periodEnd }]. Never deletes or rewrites history:
 * an overlapping non-identical import is rejected for a human to resolve.
 */
export function classifyImport(statement, existing = []) {
  const same = existing.find((e) => e.digest === statement.digest);
  if (same) return deepFreeze({ action: 'exact_retry', digest: statement.digest });
  const overlaps = existing
    .filter((e) => e.bankId === statement.bankId && e.periodStart <= statement.periodEnd && e.periodEnd >= statement.periodStart)
    .map((e) => e.digest).sort();
  if (overlaps.length) return deepFreeze({ action: 'reject_overlap', digest: statement.digest, overlaps });
  return deepFreeze({ action: 'insert', digest: statement.digest });
}

// ── Matching ──────────────────────────────────────────────────────────────

export function sourceKey(sourceType, sourceId) { return `${sourceType}:${sourceId}`; }

function checkLine(l, bankId, errors) {
  if (!l || !nonEmptyId(l.lineKey)) { errors.push(err('INVALID_LINE')); return false; }
  if (l.bankId !== bankId) { errors.push(err('CROSS_BANK', { lineKey: l.lineKey })); return false; }
  if (!isCents(l.amountCents)) { errors.push(err('INVALID_CENTS', { lineKey: l.lineKey })); return false; }
  if (!isCents(l.allocatedCents ?? 0, { allowZero: true }) || Math.abs(l.allocatedCents ?? 0) > Math.abs(l.amountCents)
    || (l.allocatedCents && sign(l.allocatedCents) !== sign(l.amountCents))) {
    errors.push(err('INVALID_ALLOCATED', { lineKey: l.lineKey })); return false;
  }
  return true;
}

function checkEntry(e, bankId, errors) {
  if (!e || typeof e !== 'object') { errors.push(err('INVALID_SOURCE')); return false; }
  const key = sourceKey(e.sourceType, e.sourceId);
  if (FORBIDDEN_SOURCE_TYPES.includes(e.sourceType)) { errors.push(err('NOT_ACTUAL_CASH', { sourceKey: key })); return false; }
  if (!ACTUAL_CASH_SOURCE_TYPES.includes(e.sourceType)) { errors.push(err('UNKNOWN_SOURCE_TYPE', { sourceKey: key })); return false; }
  if (!nonEmptyId(e.sourceId)) { errors.push(err('INVALID_SOURCE_ID', { sourceKey: key })); return false; }
  if (e.actual !== true || !isRealDate(e.paidOn)) { errors.push(err('NOT_ACTUAL_CASH', { sourceKey: key })); return false; }
  if (e.bankId !== bankId) { errors.push(err('CROSS_BANK', { sourceKey: key })); return false; }
  if (!isCents(e.amountCents)) { errors.push(err('INVALID_CENTS', { sourceKey: key })); return false; }
  const rule = SIGN_RULES[e.sourceType];
  if (rule && sign(e.amountCents) !== rule) { errors.push(err('WRONG_SIGN', { sourceKey: key })); return false; }
  if (!isCents(e.allocatedCents ?? 0, { allowZero: true }) || Math.abs(e.allocatedCents ?? 0) > Math.abs(e.amountCents)
    || (e.allocatedCents && sign(e.allocatedCents) !== sign(e.amountCents))) {
    errors.push(err('INVALID_ALLOCATED', { sourceKey: key })); return false;
  }
  return true;
}

/**
 * input: {
 *   bankId,
 *   lines:   [{ lineKey, bankId, amountCents, allocatedCents }],                     // allocatedCents = already recorded
 *   entries: [{ sourceType, sourceId, bankId, amountCents, paidOn, actual: true, allocatedCents }],
 *   groups:  [{ confirmed: true, lineKeys: [...], sources: [{ sourceType, sourceId }],
 *               allocations?: [{ lineKey, sourceType, sourceId, amountCents }] }]
 * }
 * Without explicit allocations a group must be 1→N or N→1 and the remaining amounts on both
 * sides must be exactly equal. N→M groups need explicit allocations whose per-group totals are
 * equal on both sides by construction. Returns { ok:false, errors } or a frozen plan.
 */
export function buildMatchPlan(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || !nonEmptyId(input.bankId) || !Array.isArray(input.lines)
    || !Array.isArray(input.entries) || !Array.isArray(input.groups)) {
    return deepFreeze({ ok: false, errors: [err('INVALID_INPUT')] });
  }
  const { bankId } = input;
  const lines = new Map();
  for (const l of input.lines) {
    if (!checkLine(l, bankId, errors)) continue;
    if (lines.has(l.lineKey)) { errors.push(err('DUPLICATE_LINE', { lineKey: l.lineKey })); continue; }
    lines.set(l.lineKey, { amount: BigInt(l.amountCents), prior: BigInt(l.allocatedCents ?? 0), added: 0n });
  }
  const entries = new Map();
  for (const e of input.entries) {
    if (!checkEntry(e, bankId, errors)) continue;
    const key = sourceKey(e.sourceType, e.sourceId);
    if (entries.has(key)) { errors.push(err('DUPLICATE_SOURCE', { sourceKey: key })); continue; }
    entries.set(key, { sourceType: e.sourceType, sourceId: e.sourceId, amount: BigInt(e.amountCents), prior: BigInt(e.allocatedCents ?? 0), added: 0n });
  }
  if (errors.length) return deepFreeze({ ok: false, errors });

  const edges = new Map(); // `${lineKey}|${sourceKey}` -> BigInt
  const remaining = (x) => x.amount - x.prior - x.added;
  const addEdge = (g, lineKey, sKey, amount) => {
    const line = lines.get(lineKey), entry = entries.get(sKey);
    if (amount === 0n) { errors.push(err('ZERO_ALLOCATION', { group: g, lineKey, sourceKey: sKey })); return; }
    if (sign(Number(amount)) !== sign(Number(line.amount)) || sign(Number(amount)) !== sign(Number(entry.amount))) {
      errors.push(err('WRONG_SIGN', { group: g, lineKey, sourceKey: sKey })); return;
    }
    const abs = (v) => (v < 0n ? -v : v);
    if (abs(amount) > abs(remaining(line))) { errors.push(err('OVER_ALLOCATED_LINE', { group: g, lineKey })); return; }
    if (abs(amount) > abs(remaining(entry))) { errors.push(err('OVER_ALLOCATED_SOURCE', { group: g, sourceKey: sKey })); return; }
    const k = `${lineKey}|${sKey}`;
    if (edges.has(k)) { errors.push(err('DUPLICATE_ALLOCATION', { group: g, lineKey, sourceKey: sKey })); return; }
    edges.set(k, amount); line.added += amount; entry.added += amount;
  };

  input.groups.forEach((group, g) => {
    if (!group || group.confirmed !== true) { errors.push(err('UNCONFIRMED_MATCH', { group: g })); return; }
    const lk = Array.isArray(group.lineKeys) ? group.lineKeys : [];
    const sk = Array.isArray(group.sources) ? group.sources.map((s) => sourceKey(s?.sourceType, s?.sourceId)) : [];
    if (!lk.length || !sk.length) { errors.push(err('EMPTY_GROUP', { group: g })); return; }
    if (new Set(lk).size !== lk.length || new Set(sk).size !== sk.length) { errors.push(err('DUPLICATE_IN_GROUP', { group: g })); return; }
    const missingL = lk.filter((k) => !lines.has(k)), missingS = sk.filter((k) => !entries.has(k));
    if (missingL.length || missingS.length) { errors.push(err('UNKNOWN_REFERENCE', { group: g, lineKeys: missingL, sourceKeys: missingS })); return; }

    if (Array.isArray(group.allocations) && group.allocations.length) {
      for (const a of group.allocations) {
        const s = sourceKey(a?.sourceType, a?.sourceId);
        if (!lk.includes(a?.lineKey) || !sk.includes(s)) { errors.push(err('ALLOCATION_OUTSIDE_GROUP', { group: g })); continue; }
        if (!isCents(a.amountCents)) { errors.push(err('INVALID_CENTS', { group: g, lineKey: a.lineKey, sourceKey: s })); continue; }
        addEdge(g, a.lineKey, s, BigInt(a.amountCents));
      }
      return;
    }
    if (lk.length > 1 && sk.length > 1) { errors.push(err('MANY_TO_MANY_NEEDS_ALLOCATIONS', { group: g })); return; }
    const lineSum = lk.reduce((t, k) => t + remaining(lines.get(k)), 0n);
    const srcSum = sk.reduce((t, k) => t + remaining(entries.get(k)), 0n);
    if (lineSum !== srcSum) { errors.push(err('GROUP_TOTALS_DIFFER', { group: g, lineCents: lineSum.toString(), sourceCents: srcSum.toString() })); return; }
    if (lk.length === 1) for (const s of sk) addEdge(g, lk[0], s, remaining(entries.get(s)));
    else for (const l of lk) addEdge(g, l, sk[0], remaining(lines.get(l)));
  });
  if (errors.length) return deepFreeze({ ok: false, errors });

  const allocations = [...edges.entries()].map(([k, amount]) => {
    const [lineKey, sKey] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const e = entries.get(sKey);
    return { lineKey, sourceType: e.sourceType, sourceId: e.sourceId, sourceKey: sKey, amountCents: Number(amount) };
  }).sort((a, b) => (a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
  const totals = (map, keyName) => [...map.entries()].filter(([, x]) => x.added !== 0n).map(([k, x]) => ({
    [keyName]: k, amountCents: Number(x.amount), previouslyAllocatedCents: Number(x.prior),
    newAllocatedCents: Number(x.added), remainingCents: Number(remaining(x)), fullyMatched: remaining(x) === 0n,
  })).sort((a, b) => (a[keyName] < b[keyName] ? -1 : 1));
  const lineTotals = totals(lines, 'lineKey');
  const sourceTotals = totals(entries, 'sourceKey');
  const totalCents = allocations.reduce((t, a) => t + BigInt(a.amountCents), 0n).toString();
  const digest = sha256({ v: ENGINE_VERSION, bankId, allocations: allocations.map((a) => [a.lineKey, a.sourceKey, a.amountCents]) });
  return deepFreeze({ ok: true, plan: { digest, bankId, totalCents, allocations, lineTotals, sourceTotals } });
}

/**
 * Ranked hints only. Never returns a match: every candidate needs explicit confirmation.
 * Exact remaining-amount, same bank, same sign; reference equality and date proximity rank.
 * status: 'none' | 'single_candidate' | 'ambiguous'. Duplicated references never break ties.
 */
export function suggestMatches({ bankId, lines = [], entries = [], maxDays = 14, limit = 5 } = {}) {
  const pool = entries.filter((e) => {
    const sink = [];
    return checkEntry(e, bankId, sink) && Math.abs(e.amountCents) > Math.abs(e.allocatedCents ?? 0);
  });
  const refCount = new Map();
  for (const e of pool) { const r = normRef(e.reference); if (r) refCount.set(r, (refCount.get(r) ?? 0) + 1); }
  const result = lines.filter((l) => checkLine(l, bankId, [])).map((l) => {
    const lineRemaining = l.amountCents - (l.allocatedCents ?? 0);
    if (lineRemaining === 0) return { lineKey: l.lineKey, status: 'none', requiresConfirmation: true, candidates: [] };
    const lref = normRef(l.reference);
    const candidates = pool
      .filter((e) => e.amountCents - (e.allocatedCents ?? 0) === lineRemaining)
      .map((e) => {
        const days = isRealDate(l.date) ? Math.abs(dayNumber(l.date) - dayNumber(e.paidOn)) : null;
        const eref = normRef(e.reference);
        const referenceMatch = !!lref && lref === eref;
        return { sourceType: e.sourceType, sourceId: e.sourceId, sourceKey: sourceKey(e.sourceType, e.sourceId),
          amountCents: e.amountCents - (e.allocatedCents ?? 0), referenceMatch,
          referenceShared: referenceMatch && refCount.get(eref) > 1, dayDistance: days };
      })
      .filter((c) => c.dayDistance === null || c.dayDistance <= maxDays)
      .sort((a, b) => (Number(b.referenceMatch) - Number(a.referenceMatch))
        || ((a.dayDistance ?? 1e9) - (b.dayDistance ?? 1e9)) || (a.sourceKey < b.sourceKey ? -1 : 1))
      .slice(0, limit);
    return { lineKey: l.lineKey, status: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'single_candidate' : 'ambiguous',
      requiresConfirmation: true, candidates };
  });
  return deepFreeze(result);
}
