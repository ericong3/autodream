/* Run: node --test work/garage-building-logic.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'garage-building-logic.js'), 'utf8'), ctx);
const BL = ctx.BuildingLogic;

let T = Date.parse('2026-10-20T09:00:00Z');
function ok(s, a) { const r = BL.apply(s, a, (T += 60000)); assert.ok(r.ok, a.type + ': ' + r.error); return r.state; }
function no(s, a, re) { const r = BL.apply(s, a, (T += 60000)); assert.equal(r.ok, false, a.type + ' should fail'); if (re) assert.match(r.error, re); assert.equal(r.state, s); return r.error; }
const SIG = 'data:image/png;base64,TEST-SIGNATURE-0000000000';
const checks = { id: true, series: true, dims: true };

test('all presets build without errors', () => {
  for (const k of Object.keys(BL.PRESETS)) assert.ok(BL.preset(k), k);
  assert.equal(BL.projectStatus(BL.preset('fresh')), 'quote');
  assert.equal(BL.projectStatus(BL.preset('signed')), 'awaiting_deposit');
  assert.equal(BL.projectStatus(BL.preset('deposit')), 'in_progress');
});

test('sqft uses measured size as entered, no allowance; custom uses verified sqft', () => {
  const s = BL.createDemo();
  assert.equal(BL.rectSqft(24, 60), 10);
  assert.equal(BL.panelSqft({ shape: 'rect', w: 30, h: 84 }), 17.5);
  assert.equal(BL.panelSqft({ shape: 'custom', w: 36, h: 24, verifiedSqft: 4.8 }), 4.8);
  // 1A-W1 3×(20×80) + 1A-S1 4×(30×84) + 1B-W1 2×(24×60) + 2A-W1 2×(30×72) + arch 4.8 + 2B-W1 2×(24×60)
  const expect = BL.round2((3 * 1600 + 4 * 2520 + 2 * 1440 + 2 * 2160 + 2 * 1440) / 144 + 4.8);
  assert.equal(BL.quoteSqft(s), expect);
});

test('quote editing: rooms, windows, panels and planner placement', () => {
  let s = BL.createDemo();
  s = ok(s, { type: 'ADD_ROOM', actor: 'alex', floorId: 'L1', zoneId: 'Z1', name: 'Study', w: 120, d: 100 });
  assert.ok(s.rooms.some((r) => r.id === '1C' && r.name === 'Study'));
  s = ok(s, { type: 'ADD_ASSEMBLY', actor: 'alex', roomId: '1C', kind: 'window', series: 'A', count: 2, w: '18.5', h: '40', wall: 'E' });
  const a = s.assemblies.find((x) => x.id === '1C-W1'); assert.equal(a.panels.length, 2); assert.equal(a.panels[0].w, 18.5);
  s = ok(s, { type: 'UPDATE_ASSEMBLY', actor: 'alex', assemblyId: '1C-W1', wall: 'S', pos: 0.99 });
  assert.equal(s.assemblies.find((x) => x.id === '1C-W1').pos, 0.95, 'position clamped');
  s = ok(s, { type: 'UPDATE_PANEL', actor: 'alex', panelId: '1C-W1-1', w: 20 });
  no(s, { type: 'UPDATE_PANEL', actor: 'alex', panelId: '1C-W1-1', w: 0 }, /above 0/);
  no(s, { type: 'ADD_ROOM', actor: 'jay', floorId: 'L1', zoneId: 'Z1' }, /Installer cannot/);
  s = ok(s, { type: 'SAVE_VERSION', actor: 'alex', note: 'v1' });
  assert.equal(s.quote.versions.length, 1); assert.equal(s.quote.dirty, false);
});

test('signing guards: pin, signature, acceptance, custom glass', () => {
  let s = BL.createDemo();
  const sign = { type: 'SIGN_AGREEMENT', actor: 'alex', signer: 'Ms. Demo', signature: SIG, accept: true };
  no(s, sign, /site pin/);
  s = ok(s, { type: 'CONFIRM_PIN', actor: 'alex', address: 'No. 1 Demo' });
  no(s, Object.assign({}, sign, { signature: '' }), /signature/);
  no(s, Object.assign({}, sign, { accept: false }), /accept/);
  const bad = ok(s, { type: 'UPDATE_PANEL', actor: 'alex', panelId: '2A-C1-1', verifiedSqft: 0 });
  no(bad, sign, /Custom glass/);
  s = ok(s, sign);
  assert.equal(s.project.mwo, 'MWO-DEMO-014');
  assert.equal(Object.keys(s.pieces).length, BL.allPanels(s).length);
  no(s, { type: 'ADD_ROOM', actor: 'alex', floorId: 'L1', zoneId: 'Z1' }, /amendment/);
  assert.equal(s.milestones[0].dueAt !== null, true, 'deposit due at signing');
});

test('payment: partial receipt cannot verify; only verified funds open cutting', () => {
  let s = BL.preset('signed');
  assert.equal(BL.gate(s, 'Z1', 'cutting').open, false);
  no(s, { type: 'RESERVE_LEFTOVER', actor: 'jay', windowId: '1A-W1-1', code: 'A-001' }, /Cutting locked/);
  no(s, { type: 'RECORD_RECEIPT', actor: 'alex', id: 'M1', amount: 100 }, /Salesman cannot/);
  s = ok(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M1', amount: 2000, ref: 'T1' });
  assert.equal(BL.milestoneStatus(s.milestones[0]), 'partial');
  no(s, { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M1' }, /Full payment not received/);
  no(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M1', amount: 5000 }, /More than the outstanding/);
  assert.equal(BL.gate(s, 'Z1', 'cutting').open, false, 'received but unverified stays locked');
  s = ok(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M1', amount: 4000, ref: 'T2' });
  s = ok(s, { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M1' });
  assert.equal(BL.gate(s, 'Z1', 'cutting').open, true);
});

test('director exception opens only the named zone and scope', () => {
  let s = BL.preset('signed');
  no(s, { type: 'DIRECTOR_EXCEPTION', actor: 'ravi', id: 'M1', scope: 'cutting', zones: ['Z1'], reason: 'long term client' }, /Garage Head cannot/);
  s = ok(s, { type: 'DIRECTOR_EXCEPTION', actor: 'lim', id: 'M1', scope: 'cutting', zones: ['Z1'], reason: 'long term client' });
  assert.equal(BL.gate(s, 'Z1', 'cutting').open, true);
  assert.equal(BL.gate(s, 'Z2', 'cutting').open, false);
  assert.equal(BL.gate(s, 'Z1', 'install').open, false);
});

test('reservations, cutting and stock deduction happen once', () => {
  let s = BL.preset('deposit');
  const sug = BL.suggestSources(s, '1A-W1-1');
  assert.equal(sug[0].kind, 'leftover', 'leftovers suggested first');
  assert.equal(sug[0].code, 'A-001', 'smallest fitting leftover first');
  s = ok(s, { type: 'RESERVE_LEFTOVER', actor: 'jay', windowId: '1A-W1-1', code: 'A-001' });
  no(s, { type: 'RESERVE_LEFTOVER', actor: 'lee', windowId: '1A-W1-2', code: 'A-001' }, /reserved/);
  no(s, { type: 'CANCEL_RESERVATION', actor: 'lee', windowId: '1A-W1-1' }, /Garage Head/);
  no(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-1', source: { kind: 'leftover', code: 'A-001' }, checks: { id: true, series: true } }, /Confirm Window ID/);
  s = ok(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-1', source: { kind: 'leftover', code: 'A-001' }, checks });
  assert.equal(s.stock.leftovers.find((l) => l.code === 'A-001').status, 'consumed');
  no(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-1', source: { kind: 'roll', code: 'A-R001' }, checks }, /Already cut/);
  const before = s.stock.rolls.find((r) => r.code === 'A-R001').length;
  s = ok(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-2', source: { kind: 'roll', code: 'A-R001' }, checks });
  assert.equal(s.stock.rolls.find((r) => r.code === 'A-R001').length, before - 80, '20 in side across a 60 in roll, 80 in consumed along length');
  no(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1B-W1-1', source: { kind: 'roll', code: 'A-R001' }, checks }, /Series mismatch/);
  assert.equal(s.stock.ledger.filter((l) => l.kind === 'cut').length, 2);
});

test('bundle needs every room piece cut; dispatch is per room (partial)', () => {
  let s = BL.preset('deposit');
  no(s, { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '1B' }, /Not cut yet/);
  s = ok(s, { type: 'CONFIRM_CUT', actor: 'lee', windowId: '1B-W1-1', source: { kind: 'roll', code: 'B-R001' }, checks });
  s = ok(s, { type: 'CONFIRM_CUT', actor: 'lee', windowId: '1B-W1-2', source: { kind: 'roll', code: 'B-R001' }, checks });
  s = ok(s, { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '1B' });
  s = ok(s, { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-1B-1' });
  assert.equal(BL.pieceStatus(s.pieces['1B-W1-1']), 'on_site');
  assert.equal(BL.pieceStatus(s.pieces['1A-W1-1']), 'to_cut');
  no(s, { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-1B-1' }, /Already dispatched/);
});

test('install needs team + check-in; zone confirm needs photos and every involved installer', () => {
  let s = BL.preset('onsite');
  no(s, { type: 'CLAIM_PANEL', actor: 'jay', windowId: '1A-W1-1' }, /Check in/);
  no(s, { type: 'CHECK_IN', actor: 'sam' }, /Not on this site team/);
  s = ok(s, { type: 'CHECK_IN', actor: 'jay' }); s = ok(s, { type: 'CHECK_IN', actor: 'lee' });
  s = ok(s, { type: 'CLAIM_PANEL', actor: 'jay', windowId: '1A-W1-1' });
  no(s, { type: 'CLAIM_PANEL', actor: 'lee', windowId: '1A-W1-1' }, /Not available/);
  no(s, { type: 'MARK_INSTALLED', actor: 'lee', windowId: '1A-W1-1' }, /Claim this window/);
  const ids = Object.values(s.pieces).filter((p) => p.zoneId === 'Z1').map((p) => p.windowId);
  for (const w of ids) {
    const by = w.startsWith('1B') ? 'lee' : 'jay';
    if (!s.pieces[w].claim) s = ok(s, { type: 'CLAIM_PANEL', actor: by, windowId: w });
    s = ok(s, { type: 'MARK_INSTALLED', actor: by, windowId: w });
  }
  assert.equal(BL.zoneStatus(s, 'Z1'), 'confirming');
  no(s, { type: 'CONFIRM_ZONE', actor: 'jay', zoneId: 'Z1' }, /Completion photo/);
  s = ok(s, { type: 'ADD_ZONE_PHOTO', actor: 'jay', roomId: '1A' }); s = ok(s, { type: 'ADD_ZONE_PHOTO', actor: 'lee', roomId: '1B' });
  no(s, { type: 'CONFIRM_ZONE', actor: 'sam', zoneId: 'Z1' }, /Only installers who worked/);
  s = ok(s, { type: 'CONFIRM_ZONE', actor: 'jay', zoneId: 'Z1' });
  assert.equal(BL.zoneStatus(s, 'Z1'), 'confirming', 'waits for Lee');
  s = ok(s, { type: 'CONFIRM_ZONE', actor: 'lee', zoneId: 'Z1' });
  assert.equal(BL.zoneStatus(s, 'Z1'), 'pending_inspection');
  s = ok(s, { type: 'REQUEST_PHOTOS', actor: 'ravi', zoneId: 'Z1', note: 'close-up' });
  no(s, { type: 'APPROVE_ZONE', actor: 'ravi', zoneId: 'Z1' }, /Not pending/);
  s = ok(s, { type: 'ADD_ZONE_PHOTO', actor: 'jay', roomId: '1A' });
  s = ok(s, { type: 'APPROVE_ZONE', actor: 'ravi', zoneId: 'Z1' });
  assert.equal(BL.zoneStatus(s, 'Z1'), 'approved');
});

test('Z1 approval makes progress payment due and keeps Z2 install locked until verified', () => {
  let s = BL.preset('z1done');
  const m2 = s.milestones.find((m) => m.id === 'M2');
  assert.ok(m2.dueAt, 'M2 due'); assert.ok(s.alerts.some((a) => a.ref === 'M2' && a.to === 'alex'));
  assert.equal(BL.gate(s, 'Z2', 'install').open, false);
  s = ok(s, { type: 'MARK_REQUEST_SENT', actor: 'alex', id: 'M2' });
  assert.equal(BL.milestoneStatus(s.milestones.find((m) => m.id === 'M2')), 'requested');
  s = ok(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M2', amount: 8000, ref: 'T3' });
  s = ok(s, { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M2' });
  assert.equal(BL.gate(s, 'Z2', 'install').open, true);
});

test('measurement issue → amendment → director approval → replacement keeps history', () => {
  let s = BL.preset('z1done');
  no(s, { type: 'REQUEST_AMENDMENT', actor: 'alex', windowId: '1A-W1-1', w: 21, h: 80, reason: 'x' }, /before cutting/);
  s = ok(s, { type: 'REPORT_ISSUE', actor: 'jay', windowId: '1A-W1-1', kind: 'measurement', evidence: 'photo', note: 'short' });
  assert.equal(BL.zoneStatus(s, 'Z1'), 'in_progress', 'zone approval reset');
  assert.equal(s.zones[0].inspection, null);
  no(s, { type: 'AUTHORIZE_REPLACEMENT', actor: 'ravi', windowId: '1A-W1-1' }, /amendment/);
  s = ok(s, { type: 'REQUEST_AMENDMENT', actor: 'alex', windowId: '1A-W1-1', w: 21, h: 80, reason: 'remeasured' });
  no(s, { type: 'APPROVE_AMENDMENT', actor: 'ravi', id: 'AM-1' }, /Director/);
  s = ok(s, { type: 'APPROVE_AMENDMENT', actor: 'lim', id: 'AM-1' });
  s = ok(s, { type: 'AUTHORIZE_REPLACEMENT', actor: 'ravi', windowId: '1A-W1-1' });
  const p = s.pieces['1A-W1-1'];
  assert.equal(p.rev, 2); assert.equal(p.w, 21); assert.equal(BL.pieceStatus(p), 'to_cut'); assert.ok(p.history.length >= 2);
  s = ok(s, { type: 'HEAD_LOSS_NOTE', actor: 'ravi', id: 'LS-1', note: 'tape slipped' });
  s = ok(s, { type: 'DIRECTOR_LOSS_DECISION', actor: 'lim', id: 'LS-1', decision: 'company_absorbs' });
  assert.equal(s.losses[0].decision.value, 'company_absorbs');
});

test('offcuts, stock mismatch and wastage review', () => {
  let s = BL.preset('deposit');
  s = ok(s, { type: 'REPORT_OFFCUT', actor: 'jay', fromRoll: 'A-R001', w: 20, h: 30 });
  s = ok(s, { type: 'CLASSIFY_OFFCUT', actor: 'ravi', id: 'OC-1', decision: 'reusable' });
  assert.ok(s.stock.leftovers.some((l) => l.code === 'A-004' && l.status === 'available'));
  no(s, { type: 'REPORT_STOCK_MISMATCH', actor: 'jay', code: 'B-001', w: 30, h: 90, reason: 'short' }, /Evidence/);
  s = ok(s, { type: 'REPORT_STOCK_MISMATCH', actor: 'jay', code: 'B-001', w: 30, h: 90, reason: 'short', evidence: 'photo' });
  assert.equal(BL.suggestSources(s, '1B-W1-1').some((x) => x.code === 'B-001'), false, 'held stock not suggested');
  no(s, { type: 'DIRECTOR_REVIEW_DISCREPANCY', actor: 'lim', id: 'SD-1', note: 'ok' }, /Garage Head must verify/);
  s = ok(s, { type: 'VERIFY_STOCK_ADJUST', actor: 'ravi', id: 'SD-1' });
  assert.equal(s.stock.leftovers.find((l) => l.code === 'B-001').w, 30);
  s = ok(s, { type: 'REPORT_WASTAGE', actor: 'jay', sqft: 2, reason: 'crease' });
  s = ok(s, { type: 'REVIEW_WASTAGE', actor: 'ravi', id: 'WS-1', correctedSqft: 1.5 });
  assert.ok(s.stock.ledger.some((l) => l.kind === 'wastage correction' && l.sqft === -0.5));
});

test('cancellation pauses gates; director confirms and releases reservations', () => {
  let s = BL.preset('deposit');
  s = ok(s, { type: 'RESERVE_LEFTOVER', actor: 'jay', windowId: '1A-W1-1', code: 'A-001' });
  s = ok(s, { type: 'REQUEST_CANCELLATION', actor: 'alex', reason: 'customer relocating' });
  assert.equal(BL.gate(s, 'Z1', 'cutting').open, false);
  no(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-1', source: { kind: 'leftover', code: 'A-001' }, checks }, /Paused/);
  assert.equal(s.cancellation.summary.reserved, 1);
  no(s, { type: 'DIRECTOR_CANCELLATION', actor: 'lim', decision: 'confirm' }, /note/);
  const w = ok(s, { type: 'DIRECTOR_CANCELLATION', actor: 'lim', decision: 'withdraw', note: 'resolved' });
  assert.equal(BL.gate(w, 'Z1', 'cutting').open, true);
  s = ok(s, { type: 'DIRECTOR_CANCELLATION', actor: 'lim', decision: 'confirm', note: 'agreed' });
  assert.equal(s.stock.leftovers.find((l) => l.code === 'A-001').status, 'available');
  no(s, { type: 'CHECK_IN', actor: 'jay' }, /cancelled/);
});

test('handover blocked until all checks pass; conditional then acknowledged', () => {
  let s = BL.preset('z1done');
  no(s, { type: 'HANDOVER_SIGN', actor: 'alex', photo: 'p', signer: 'Ms. Demo', signature: SIG }, /Not ready/);
  assert.equal(BL.handoverChecks(s).find((c) => c.key === 'zones').ok, false);
  s = ok(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M2', amount: 8000 }); s = ok(s, { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M2' });
  const z2 = Object.values(s.pieces).filter((p) => p.zoneId === 'Z2');
  for (const p of z2) s = ok(s, { type: 'CONFIRM_CUT', actor: 'jay', windowId: p.windowId, source: { kind: 'roll', code: p.series + '-R001' }, checks });
  s = ok(s, { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '2A' }); s = ok(s, { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '2B' });
  s = ok(s, { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-2A-1' }); s = ok(s, { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-2B-1' });
  for (const p of z2) { s = ok(s, { type: 'CLAIM_PANEL', actor: 'jay', windowId: p.windowId }); s = ok(s, { type: 'MARK_INSTALLED', actor: 'jay', windowId: p.windowId }); }
  s = ok(s, { type: 'ADD_ZONE_PHOTO', actor: 'jay', roomId: '2A' }); s = ok(s, { type: 'ADD_ZONE_PHOTO', actor: 'jay', roomId: '2B' });
  s = ok(s, { type: 'CONFIRM_ZONE', actor: 'jay', zoneId: 'Z2' }); s = ok(s, { type: 'APPROVE_ZONE', actor: 'ravi', zoneId: 'Z2' });
  assert.equal(BL.handoverChecks(s).find((c) => c.key === 'payments').ok, false, 'final balance still outstanding');
  assert.ok(s.milestones.find((m) => m.id === 'M3').dueAt);
  s = ok(s, { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M3', amount: 6000 }); s = ok(s, { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M3' });
  assert.equal(BL.projectStatus(s), 'ready_handover');
  no(s, { type: 'HANDOVER_SIGN', actor: 'alex', signer: 'Ms. Demo', signature: SIG }, /photo/);
  s = ok(s, { type: 'HANDOVER_SIGN', actor: 'alex', photo: 'p', signer: 'Ms. Demo', signature: SIG, issues: ['Touch up 2B-W1-2 edge'] });
  assert.equal(BL.projectStatus(s), 'conditional');
  no(s, { type: 'CUSTOMER_ACK', actor: 'alex', signer: 'Ms. Demo', signature: SIG }, /Resolve all/);
  s = ok(s, { type: 'RESOLVE_CORRECTION', actor: 'ravi', id: 'CR-1', note: 'edge re-squeegeed' });
  s = ok(s, { type: 'CUSTOMER_ACK', actor: 'alex', signer: 'Ms. Demo', signature: SIG });
  assert.equal(BL.projectStatus(s), 'completed');
  no(s, { type: 'REPORT_WASTAGE', actor: 'jay', sqft: 1, reason: 'x' }, /completed/);
});
