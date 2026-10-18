/* AutoDream Garage · Building tint demo logic.
   Pure state + reducer. No network, no backend. Fictional records only.
   Loaded as a classic <script> (exposes window.BuildingLogic) and by
   garage-building-logic.test.cjs through node:vm. */
(function (root) {
  'use strict';

  const USERS = {
    alex: { name: 'Alex', role: 'salesman' },
    mei: { name: 'Mei', role: 'finance' },
    lim: { name: 'Director Lim', role: 'director' },
    ravi: { name: 'Ravi', role: 'head' },
    jay: { name: 'Jay', role: 'installer' },
    lee: { name: 'Lee', role: 'installer' },
    sam: { name: 'Sam', role: 'installer' },
  };
  const ROLE_LABEL = { salesman: 'Salesman', finance: 'Finance', director: 'Director', head: 'Garage Head', installer: 'Installer' };
  const SERIES = { A: 'Demo Series A', B: 'Demo Series B', C: 'Demo Series C' };
  const ISSUE_KIND = { damaged: 'Damaged', incorrect: 'Incorrect cut', missing: 'Missing', measurement: 'Measurement error' };

  const PERM = {
    ADD_FLOOR: ['salesman'], ADD_ZONE: ['salesman'], ADD_ROOM: ['salesman'], UPDATE_ROOM: ['salesman'], REMOVE_ROOM: ['salesman'],
    ADD_ASSEMBLY: ['salesman'], UPDATE_ASSEMBLY: ['salesman'], REMOVE_ASSEMBLY: ['salesman'],
    ADD_PANEL: ['salesman'], UPDATE_PANEL: ['salesman'], REMOVE_PANEL: ['salesman'],
    SAVE_VERSION: ['salesman'], CONFIRM_PIN: ['salesman'],
    ADD_MILESTONE: ['salesman'], UPDATE_MILESTONE: ['salesman'], REMOVE_MILESTONE: ['salesman'], SIGN_AGREEMENT: ['salesman'],
    MARK_REQUEST_SENT: ['salesman'], UPLOAD_PROOF: ['salesman'], RECORD_RECEIPT: ['finance', 'director'],
    VERIFY_MILESTONE: ['finance', 'director'], DIRECTOR_EXCEPTION: ['director'],
    PLAN_SOURCE: ['head'], RESERVE_LEFTOVER: ['installer', 'head'], CANCEL_RESERVATION: ['installer', 'head'],
    REASSIGN_RESERVATION: ['head'], CONFIRM_CUT: ['installer', 'head'], REPORT_OFFCUT: ['installer', 'head'],
    CLASSIFY_OFFCUT: ['head'], REGISTER_ROLL: ['head'], REPORT_STOCK_MISMATCH: ['installer', 'head'],
    VERIFY_STOCK_ADJUST: ['head'], DIRECTOR_REVIEW_DISCREPANCY: ['director'],
    APPROVE_BUNDLE: ['head'], DISPATCH_BUNDLE: ['head'],
    ASSIGN_TEAM: ['head'], SET_TARGETS: ['head'], CHECK_IN: ['installer'], CHECK_OUT: ['installer'],
    CLAIM_PANEL: ['installer'], RELEASE_CLAIM: ['installer'], MARK_INSTALLED: ['installer'],
    REPORT_ISSUE: ['installer', 'head'], AUTHORIZE_REPLACEMENT: ['head'],
    REPORT_WASTAGE: ['installer'], REVIEW_WASTAGE: ['head'],
    ADD_ZONE_PHOTO: ['installer', 'head'], CONFIRM_ZONE: ['installer'], APPROVE_ZONE: ['head'], REQUEST_PHOTOS: ['head'],
    REQUEST_AMENDMENT: ['salesman'], APPROVE_AMENDMENT: ['director'], REJECT_AMENDMENT: ['director'],
    HEAD_LOSS_NOTE: ['head'], DIRECTOR_LOSS_DECISION: ['director'],
    REQUEST_CANCELLATION: ['salesman'], DIRECTOR_CANCELLATION: ['director'],
    DELEGATE_HANDOVER: ['salesman'], CASH_RECEIVED: ['salesman', 'installer'], ACK_CASH: ['salesman'], HANDOVER_SIGN: ['salesman', 'installer'], RESOLVE_CORRECTION: ['head'], CUSTOMER_ACK: ['salesman', 'installer'],
  };

  const QUOTE_ACTIONS = new Set(['ADD_FLOOR', 'ADD_ZONE', 'ADD_ROOM', 'UPDATE_ROOM', 'REMOVE_ROOM', 'ADD_ASSEMBLY', 'UPDATE_ASSEMBLY',
    'REMOVE_ASSEMBLY', 'ADD_PANEL', 'UPDATE_PANEL', 'REMOVE_PANEL', 'ADD_MILESTONE', 'UPDATE_MILESTONE', 'REMOVE_MILESTONE']);

  class DemoError extends Error {}
  const fail = (msg) => { throw new DemoError(msg); };
  const must = (cond, msg) => { if (!cond) fail(msg); };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const round2 = (n) => Math.round(n * 100) / 100;
  const pad3 = (n) => String(n).padStart(3, '0');
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const posNum = (v) => { const n = num(v); return Number.isFinite(n) && n > 0 ? n : NaN; };
  const text = (v) => String(v == null ? '' : v).trim();

  /* Dimensions are used exactly as the Salesman entered them (allowance already included). */
  const rectSqft = (w, h) => (w * h) / 144;
  function panelSqft(p) {
    if (p.shape === 'custom') return p.verifiedSqft > 0 ? p.verifiedSqft : 0;
    return rectSqft(p.w, p.h);
  }

  function nextId(s, key) { s.seq[key] = (s.seq[key] || 0) + 1; return s.seq[key]; }

  /* ---------- demo seed ---------- */
  function panelsOf(asmId, list) { return list.map((d, i) => Object.assign({ id: asmId + '-' + (i + 1), shape: 'rect' }, d)); }

  function createDemo() {
    const asm = (id, roomId, kind, label, wall, pos, series, panels) => ({ id, roomId, kind, label, wall, pos, series, panels: panelsOf(id, panels) });
    return {
      schema: 1,
      project: {
        id: 'ADB-DEMO-014', mwo: null, title: 'Demo Residence', customer: 'Demo Holdings Sdn Bhd', contact: 'Ms. Demo',
        address: 'No. 1, Jalan Demo 1, Taman Demo', salesman: 'alex', pin: { x: 0.56, y: 0.44, confirmed: false, by: null, at: null },
      },
      floors: [{ id: 'L1', name: 'Level 1' }, { id: 'L2', name: 'Level 2' }],
      zones: [
        { id: 'Z1', name: 'Zone 1', confirmations: {}, inspection: null, started: false },
        { id: 'Z2', name: 'Zone 2', confirmations: {}, inspection: null, started: false },
      ],
      rooms: [
        { id: '1A', floorId: 'L1', zoneId: 'Z1', name: 'Living', w: 240, d: 180 },
        { id: '1B', floorId: 'L1', zoneId: 'Z1', name: 'Dining', w: 180, d: 150 },
        { id: '2A', floorId: 'L2', zoneId: 'Z2', name: 'Master bedroom', w: 200, d: 170 },
        { id: '2B', floorId: 'L2', zoneId: 'Z2', name: 'Bedroom 2', w: 160, d: 140 },
      ],
      assemblies: [
        asm('1A-W1', '1A', 'window', 'Window', 'N', 0.32, 'A', [{ w: 20, h: 80 }, { w: 20, h: 80 }, { w: 20, h: 80 }]),
        asm('1A-S1', '1A', 'sliding', 'Sliding door', 'S', 0.5, 'A', [{ w: 30, h: 84 }, { w: 30, h: 84 }, { w: 30, h: 84 }, { w: 30, h: 84 }]),
        asm('1B-W1', '1B', 'window', 'Window', 'E', 0.5, 'B', [{ w: 24, h: 60 }, { w: 24, h: 60 }]),
        asm('2A-W1', '2A', 'window', 'Window', 'N', 0.4, 'C', [{ w: 30, h: 72 }, { w: 30, h: 72 }]),
        asm('2A-C1', '2A', 'custom', 'Arched top', 'N', 0.78, 'C', [{ w: 36, h: 24, shape: 'custom', verifiedSqft: 4.8, photo: 'arch-ref (placeholder)', note: 'Half-round' }]),
        asm('2B-W1', '2B', 'window', 'Window', 'W', 0.5, 'B', [{ w: 24, h: 60 }, { w: 24, h: 60 }]),
      ],
      quote: { versions: [], dirty: true },
      milestones: [
        { id: 'M1', label: 'Deposit', amount: 6000, trigger: { type: 'signing' }, unlocks: { cutting: true, zones: ['Z1', 'Z2'], handover: false } },
        { id: 'M2', label: 'Progress payment', amount: 8000, trigger: { type: 'zones_approved', zones: ['Z1'] }, unlocks: { cutting: false, zones: ['Z2'], handover: false } },
        { id: 'M3', label: 'Final balance', amount: 6000, trigger: { type: 'zones_approved', zones: ['Z1', 'Z2'] }, unlocks: { cutting: false, zones: [], handover: true } },
      ],
      agreement: null,
      pieces: {},
      bundles: [],
      stock: {
        rolls: [
          { code: 'A-R001', series: 'A', width: 60, length: 600, original: 600, by: 'ravi' },
          { code: 'B-R001', series: 'B', width: 60, length: 400, original: 400, by: 'ravi' },
          { code: 'C-R001', series: 'C', width: 48, length: 300, original: 300, by: 'ravi' },
        ],
        leftovers: [
          { code: 'A-001', series: 'A', w: 24, h: 90, fromRoll: 'A-R001', status: 'available' },
          { code: 'A-002', series: 'A', w: 36, h: 100, fromRoll: 'A-R001', status: 'available' },
          { code: 'A-003', series: 'A', w: 18, h: 40, fromRoll: 'A-R001', status: 'available' },
          { code: 'B-001', series: 'B', w: 32, h: 90, fromRoll: 'B-R001', status: 'available' },
          { code: 'B-002', series: 'B', w: 20, h: 60, fromRoll: 'B-R001', status: 'available' },
          { code: 'C-001', series: 'C', w: 40, h: 30, fromRoll: 'C-R001', status: 'available' },
        ],
        offcuts: [], discrepancies: [], ledger: [],
      },
      team: { members: [], targets: null, presence: [] },
      photos: [], wastage: [], amendments: [], losses: [], exceptions: [],
      cancellation: null, delegation: null, cash: [], handover: null, corrections: [],
      alerts: [], audit: [], seq: { ver: 0 },
    };
  }

  /* ---------- selectors ---------- */
  const userName = (id) => (USERS[id] ? USERS[id].name : id);
  const roomOf = (s, id) => s.rooms.find((r) => r.id === id);
  const zoneOf = (s, id) => s.zones.find((z) => z.id === id);
  const assemblyOf = (s, id) => s.assemblies.find((a) => a.id === id);
  function findPanel(s, panelId) {
    for (const a of s.assemblies) { const p = a.panels.find((x) => x.id === panelId); if (p) return { asm: a, panel: p }; }
    return null;
  }
  const allPanels = (s) => s.assemblies.flatMap((a) => a.panels.map((p) => ({ asm: a, panel: p, room: roomOf(s, a.roomId) })));
  function quoteSqft(s, filter) {
    return round2(allPanels(s).filter((x) => !filter || filter(x)).reduce((t, x) => t + panelSqft(x.panel), 0));
  }
  const piecesList = (s) => Object.values(s.pieces);

  function pieceStatus(p) {
    if (p.issue) return 'issue';
    if (p.installed) return 'installed';
    if (p.claim) return 'installing';
    if (p.dispatched) return 'on_site';
    if (p.bundleId) return 'bundled';
    if (p.cut) return 'cut';
    if (p.reservation) return 'reserved';
    return 'to_cut';
  }

  const isPaused = (s) => !!(s.cancellation && (s.cancellation.status === 'review' || s.cancellation.status === 'confirmed'));

  /* Payment gate for a zone. scope: 'install' | 'cutting'. Director exceptions are scoped per milestone + zone. */
  function gate(s, zoneId, scope) {
    if (!s.agreement) return { open: false, reason: 'Agreement not signed' };
    if (s.cancellation && s.cancellation.status === 'confirmed') return { open: false, reason: 'Project cancelled' };
    if (isPaused(s)) return { open: false, reason: 'Paused · cancellation review' };
    const blocking = []; const viaException = [];
    for (const m of s.milestones) {
      const gated = scope === 'cutting' ? !!m.unlocks.cutting : (!!m.unlocks.cutting || (m.unlocks.zones || []).includes(zoneId));
      if (!gated || m.verified) continue;
      const ex = s.exceptions.find((e) => e.milestoneId === m.id && e.scope === scope && e.zones.includes(zoneId));
      if (ex) { viaException.push(ex.id); continue; }
      blocking.push(m);
    }
    if (blocking.length) return { open: false, reason: 'Awaiting verified ' + blocking.map((m) => m.label.toLowerCase()).join(', '), milestones: blocking.map((m) => m.id) };
    return { open: true, viaException };
  }

  const received = (m) => round2((m.receipts || []).reduce((t, r) => t + r.amount, 0));

  function milestoneStatus(m) {
    if (m.verified) return 'verified';
    const got = received(m);
    if (got > 0) return got >= m.amount ? 'received' : 'partial';
    if (m.requestSentAt) return 'requested';
    if (m.dueAt) return 'due';
    return 'scheduled';
  }

  const zonePieces = (s, zoneId) => piecesList(s).filter((p) => p.zoneId === zoneId);
  function involved(s, zoneId) {
    return [...new Set(zonePieces(s, zoneId).filter((p) => p.installed).map((p) => p.installed.by))];
  }
  function zoneStatus(s, zoneId) {
    const z = zoneOf(s, zoneId);
    if (!s.agreement) return 'quote';
    if (z.inspection) return z.inspection.status === 'approved' ? 'approved' : z.inspection.status === 'photos_requested' ? 'photos_requested' : 'pending_inspection';
    const ps = zonePieces(s, zoneId);
    if (ps.length && ps.every((p) => pieceStatus(p) === 'installed')) return 'confirming';
    if (z.started) return 'in_progress';
    return gate(s, zoneId, 'install').open ? 'open' : 'locked';
  }
  function roomsMissingPhoto(s, zoneId) {
    return s.rooms.filter((r) => r.zoneId === zoneId && !s.photos.some((ph) => ph.roomId === r.id && !ph.stale)).map((r) => r.id);
  }

  function leftoverFits(l, w, h) { return (w <= l.w && h <= l.h) || (w <= l.h && h <= l.w); }
  /* Roll use: piece side across the roll width, other side consumed along its length. */
  function rollUse(roll, w, h) {
    const lo = Math.min(w, h); const hi = Math.max(w, h);
    if (hi <= roll.width) return lo;
    if (lo <= roll.width) return hi;
    return null;
  }

  /* Leftovers first (smallest fitting area), then rolls. Worker still chooses. */
  function suggestSources(s, windowId) {
    const p = s.pieces[windowId]; if (!p) return [];
    const left = s.stock.leftovers
      .filter((l) => l.series === p.series && l.status === 'available' && leftoverFits(l, p.w, p.h))
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .map((l) => ({ kind: 'leftover', code: l.code, label: l.code + ' · ' + l.w + '×' + l.h + ' in leftover', spare: round2(rectSqft(l.w, l.h) - rectSqft(p.w, p.h)) }));
    const rolls = s.stock.rolls
      .filter((r) => r.series === p.series)
      .map((r) => ({ r, use: rollUse(r, p.w, p.h) }))
      .filter((x) => x.use !== null && x.use <= x.r.length)
      .map((x) => ({ kind: 'roll', code: x.r.code, label: x.r.code + ' · roll ' + x.r.width + ' in wide, ' + x.r.length + ' in left', use: x.use }));
    return left.concat(rolls);
  }

  const totalSqft = (s) => round2(piecesList(s).reduce((t, p) => t + p.area, 0));
  const installedSqft = (s) => round2(piecesList(s).filter((p) => pieceStatus(p) === 'installed').reduce((t, p) => t + p.area, 0));

  function handoverChecks(s) {
    const open = piecesList(s).filter((p) => p.issue);
    return [
      { key: 'zones', label: 'All zones approved by Garage Head', ok: !!s.agreement && s.zones.every((z) => z.inspection && z.inspection.status === 'approved') },
      { key: 'payments', label: 'All payments verified by Finance', ok: !!s.agreement && s.milestones.every((m) => m.verified) },
      { key: 'issues', label: 'No open window issues', ok: open.length === 0 },
      { key: 'amend', label: 'No pending amendments', ok: !s.amendments.some((a) => a.status === 'pending') },
      { key: 'cancel', label: 'No cancellation in review', ok: !isPaused(s) },
    ];
  }

  function projectStatus(s) {
    if (s.cancellation && s.cancellation.status === 'confirmed') return 'cancelled';
    if (s.cancellation && s.cancellation.status === 'review') return 'cancel_review';
    if (!s.agreement) return 'quote';
    if (s.handover) return s.handover.status === 'completed' ? 'completed' : 'conditional';
    if (s.milestones.some((m) => m.unlocks.cutting && !m.verified) && s.zones.every((z) => !gate(s, z.id, 'cutting').open && !gate(s, z.id, 'install').open)) return 'awaiting_deposit';
    if (s.zones.every((z) => z.inspection && z.inspection.status === 'approved')) return 'ready_handover';
    return 'in_progress';
  }

  function cancellationSummary(s) {
    const ps = piecesList(s);
    const cut = ps.filter((p) => p.cut || p.history.some((h) => h.cut));
    const inst = ps.filter((p) => pieceStatus(p) === 'installed');
    return {
      agreement: s.agreement ? 'Signed ' + s.agreement.signedAt.slice(0, 10) + ' by ' + s.agreement.signer : 'Not signed',
      cutPieces: cut.length, cutSqft: round2(cut.reduce((t, p) => t + p.area, 0)),
      reserved: s.stock.leftovers.filter((l) => l.status === 'reserved').length,
      installedPieces: inst.length, installedSqft: round2(inst.reduce((t, p) => t + p.area, 0)),
      receivedTotal: round2(s.milestones.reduce((t, m) => t + received(m), 0)),
    };
  }

  function productivity(s, now) {
    const t = now || Date.now();
    const per = {};
    for (const r of s.team.presence) {
      const end = r.out ? Date.parse(r.out) : t;
      per[r.user] = (per[r.user] || 0) + Math.max(0, end - Date.parse(r.in));
    }
    const first = s.team.presence.length ? Math.min(...s.team.presence.map((r) => Date.parse(r.in))) : null;
    return {
      total: totalSqft(s), installed: installedSqft(s),
      onSite: s.team.presence.filter((r) => !r.out).map((r) => r.user),
      minutes: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(v / 60000)])),
      elapsedDays: first ? Math.max(1, Math.ceil((t - first) / 86400000)) : 0,
      targets: s.team.targets,
    };
  }

  /* ---------- reducer helpers ---------- */
  function log(s, ctx, msg) {
    s.audit.unshift({ at: ctx.iso, by: ctx.actor, role: USERS[ctx.actor].role, text: msg });
    if (s.audit.length > 400) s.audit.length = 400;
  }
  function alertTo(s, ctx, to, msg, ref) { s.alerts.unshift({ id: 'AL-' + nextId(s, 'al'), to, msg, ref: ref || null, at: ctx.iso, done: false }); }

  function resetZone(s, zoneId) { const z = zoneOf(s, zoneId); if (z) { z.confirmations = {}; z.inspection = null; } }

  function piece(s, id) { const p = s.pieces[id]; must(p, 'Unknown window ID ' + id); return p; }
  function leftover(s, code) { const l = s.stock.leftovers.find((x) => x.code === code); must(l, 'Unknown leftover ' + code); return l; }
  function milestone(s, id) { const m = s.milestones.find((x) => x.id === id); must(m, 'Unknown milestone'); return m; }

  function releaseReservation(s, p) {
    if (!p.reservation) return;
    const l = s.stock.leftovers.find((x) => x.code === p.reservation.code);
    if (l && l.status === 'reserved') { l.status = 'available'; l.reservedFor = null; l.reservedBy = null; }
    p.reservation = null;
  }

  function nextLeftoverCode(s, series) {
    const n = s.stock.leftovers.filter((l) => l.series === series).map((l) => Number(l.code.split('-')[1]) || 0);
    return series + '-' + pad3((n.length ? Math.max(...n) : 0) + 1);
  }

  function refresh(s, ctx) {
    if (!s.agreement) return;
    const pct = totalSqft(s) ? (installedSqft(s) / totalSqft(s)) * 100 : 0;
    for (const m of s.milestones) {
      if (m.dueAt) continue;
      const t = m.trigger; let due = false;
      if (t.type === 'signing') due = true;
      else if (t.type === 'zones_approved') due = (t.zones || []).length > 0 && t.zones.every((z) => { const zz = zoneOf(s, z); return zz && zz.inspection && zz.inspection.status === 'approved'; });
      else if (t.type === 'progress') due = pct >= (Number(t.pct) || 0);
      else if (t.type === 'date') due = !!t.date && ctx.now >= Date.parse(t.date);
      if (due) {
        m.dueAt = ctx.iso;
        alertTo(s, ctx, s.project.salesman, 'Payment request ready · ' + m.label + ' · send via WhatsApp', m.id);
        s.audit.unshift({ at: ctx.iso, by: 'system', role: 'system', text: 'Payment request generated · ' + m.label });
      }
    }
  }

  /* ---------- reducer ---------- */
  function quoteGuard(s) { must(!s.agreement, 'Agreement signed · use an amendment instead'); }

  function validWall(w) { return ['N', 'E', 'S', 'W'].includes(w); }
  const clamp01 = (v) => Math.min(0.95, Math.max(0.05, Number(v)));

  const HANDLERS = {
    ADD_FLOOR(s, a, ctx) {
      quoteGuard(s); const name = text(a.name) || 'Level ' + (s.floors.length + 1);
      let n = 1; while (s.floors.some((f) => f.id === 'L' + n)) n++;
      const id = 'L' + n;
      s.floors.push({ id, name }); log(s, ctx, 'Added floor ' + name);
    },
    ADD_ZONE(s, a, ctx) {
      quoteGuard(s); const id = 'Z' + (s.zones.length + 1);
      must(!zoneOf(s, id), 'Zone exists');
      s.zones.push({ id, name: text(a.name) || 'Zone ' + (s.zones.length + 1), confirmations: {}, inspection: null, started: false });
      log(s, ctx, 'Added ' + id);
    },
    ADD_ROOM(s, a, ctx) {
      quoteGuard(s); const floor = s.floors.find((f) => f.id === a.floorId); must(floor, 'Choose a floor');
      must(zoneOf(s, a.zoneId), 'Choose a zone');
      const prefix = floor.id.replace('L', '');
      let code = 65; while (roomOf(s, prefix + String.fromCharCode(code))) code++;
      const id = prefix + String.fromCharCode(code);
      s.rooms.push({ id, floorId: floor.id, zoneId: a.zoneId, name: text(a.name) || 'Room ' + id, w: posNum(a.w) || 180, d: posNum(a.d) || 150 });
      log(s, ctx, 'Added room ' + id); return { roomId: id };
    },
    UPDATE_ROOM(s, a, ctx) {
      quoteGuard(s); const r = roomOf(s, a.roomId); must(r, 'Unknown room');
      if (a.name !== undefined) r.name = text(a.name) || r.name;
      if (a.w !== undefined) { const v = posNum(a.w); must(v, 'Room width must be above 0'); r.w = v; }
      if (a.d !== undefined) { const v = posNum(a.d); must(v, 'Room depth must be above 0'); r.d = v; }
      if (a.zoneId !== undefined) { must(zoneOf(s, a.zoneId), 'Unknown zone'); r.zoneId = a.zoneId; }
    },
    REMOVE_ROOM(s, a, ctx) {
      quoteGuard(s); must(roomOf(s, a.roomId), 'Unknown room');
      s.rooms = s.rooms.filter((r) => r.id !== a.roomId); s.assemblies = s.assemblies.filter((x) => x.roomId !== a.roomId);
      log(s, ctx, 'Removed room ' + a.roomId);
    },
    ADD_ASSEMBLY(s, a, ctx) {
      quoteGuard(s); const r = roomOf(s, a.roomId); must(r, 'Unknown room');
      const kind = ['window', 'sliding', 'custom'].includes(a.kind) ? a.kind : 'window';
      const count = Math.round(num(a.count)); must(count >= 1 && count <= 24, 'Panels: 1 to 24');
      const w = posNum(a.w); const h = posNum(a.h); must(w && h, 'Enter width and height in inches');
      must(SERIES[a.series], 'Choose a film series');
      const letter = kind === 'sliding' ? 'S' : kind === 'custom' ? 'C' : 'W';
      let n = 1; while (assemblyOf(s, r.id + '-' + letter + n)) n++;
      const id = r.id + '-' + letter + n;
      const label = text(a.label) || (kind === 'sliding' ? 'Sliding door' : kind === 'custom' ? 'Custom glass' : 'Window');
      const panels = Array.from({ length: count }, () => (kind === 'custom' ? { w, h, shape: 'custom', verifiedSqft: 0, photo: '', note: '' } : { w, h }));
      s.assemblies.push({ id, roomId: r.id, kind, label, wall: validWall(a.wall) ? a.wall : 'N', pos: clamp01(a.pos == null ? 0.5 : a.pos), series: a.series, panels: panelsOf(id, panels) });
      log(s, ctx, 'Added ' + label + ' ' + id + ' · ' + count + ' panel(s)'); return { assemblyId: id };
    },
    UPDATE_ASSEMBLY(s, a, ctx) {
      quoteGuard(s); const x = assemblyOf(s, a.assemblyId); must(x, 'Unknown assembly');
      if (a.wall !== undefined) { must(validWall(a.wall), 'Bad wall'); x.wall = a.wall; }
      if (a.pos !== undefined) x.pos = clamp01(a.pos);
      if (a.label !== undefined) x.label = text(a.label) || x.label;
      if (a.series !== undefined) { must(SERIES[a.series], 'Unknown series'); x.series = a.series; }
    },
    REMOVE_ASSEMBLY(s, a, ctx) {
      quoteGuard(s); must(assemblyOf(s, a.assemblyId), 'Unknown assembly');
      s.assemblies = s.assemblies.filter((x) => x.id !== a.assemblyId); log(s, ctx, 'Removed ' + a.assemblyId);
    },
    ADD_PANEL(s, a, ctx) {
      quoteGuard(s); const x = assemblyOf(s, a.assemblyId); must(x, 'Unknown assembly');
      must(x.panels.length < 24, 'Max 24 panels');
      const last = x.panels[x.panels.length - 1] || { w: 24, h: 60 };
      let n = 1; while (x.panels.some((p) => p.id === x.id + '-' + n)) n++;
      x.panels.push(Object.assign({ id: x.id + '-' + n, w: last.w, h: last.h, shape: x.kind === 'custom' ? 'custom' : 'rect' }, x.kind === 'custom' ? { verifiedSqft: 0, photo: '', note: '' } : {}));
    },
    UPDATE_PANEL(s, a, ctx) {
      quoteGuard(s); const f = findPanel(s, a.panelId); must(f, 'Unknown panel'); const p = f.panel; const was = [p.w, p.h];
      if (a.w !== undefined) { const v = posNum(a.w); must(v, 'Width must be above 0'); p.w = v; }
      if (a.h !== undefined) { const v = posNum(a.h); must(v, 'Height must be above 0'); p.h = v; }
      /* A new size is unchecked until someone re-ticks it; re-entering the same size keeps the check. */
      if (p.w !== Number(was[0]) || p.h !== Number(was[1])) p.measured = false;
      if (a.shape !== undefined) { p.shape = a.shape === 'custom' ? 'custom' : 'rect'; if (p.shape === 'custom' && p.verifiedSqft == null) p.verifiedSqft = 0; }
      if (a.verifiedSqft !== undefined) { const v = num(a.verifiedSqft); must(Number.isFinite(v) && v >= 0, 'Verified sqft must be 0 or more'); p.verifiedSqft = v; }
      if (a.photo !== undefined) p.photo = text(a.photo);
      if (a.note !== undefined) p.note = text(a.note);
    },
    REMOVE_PANEL(s, a, ctx) {
      quoteGuard(s); const f = findPanel(s, a.panelId); must(f, 'Unknown panel');
      must(f.asm.panels.length > 1, 'Keep at least one panel · remove the assembly instead');
      f.asm.panels = f.asm.panels.filter((p) => p.id !== a.panelId);
    },
    SAVE_VERSION(s, a, ctx) {
      quoteGuard(s); must(allPanels(s).length > 0, 'Add at least one window');
      const v = nextId(s, 'ver'); const ps = allPanels(s).map((x) => x.panel);
      /* Measurement flags at save time: checked, approximate (false) and never checked (no flag). */
      const measurement = { checked: ps.filter((p) => p.measured === true).length, approx: ps.filter((p) => p.measured === false).length, unknown: ps.filter((p) => p.measured !== true && p.measured !== false).length };
      s.quote.versions.push({ v, at: ctx.iso, by: ctx.actor, note: text(a.note), sqft: quoteSqft(s), panels: ps.length, measurement, rooms: clone(s.rooms), assemblies: clone(s.assemblies) });
      s.quote.dirty = false; log(s, ctx, 'Saved quotation v' + v);
    },
    CONFIRM_PIN(s, a, ctx) {
      const addr = text(a.address); must(addr, 'Enter the site address');
      s.project.address = addr;
      if (a.x !== undefined) s.project.pin.x = Math.min(1, Math.max(0, Number(a.x)));
      if (a.y !== undefined) s.project.pin.y = Math.min(1, Math.max(0, Number(a.y)));
      Object.assign(s.project.pin, { confirmed: true, by: ctx.actor, at: ctx.iso });
      log(s, ctx, 'Confirmed site pin');
    },
    ADD_MILESTONE(s, a, ctx) {
      quoteGuard(s); must(s.milestones.length < 6, 'Max 6 milestones');
      let n = 1; while (s.milestones.some((m) => m.id === 'M' + n)) n++;
      s.milestones.push({ id: 'M' + n, label: 'Milestone ' + n, amount: 0, trigger: { type: 'date', date: '' }, unlocks: { cutting: false, zones: [], handover: false } });
    },
    UPDATE_MILESTONE(s, a, ctx) {
      quoteGuard(s); const m = milestone(s, a.id);
      if (a.label !== undefined) m.label = text(a.label) || m.label;
      if (a.amount !== undefined) { const v = num(a.amount); must(Number.isFinite(v) && v >= 0, 'Amount must be 0 or more'); m.amount = v; }
      if (a.trigger !== undefined) m.trigger = clone(a.trigger);
      if (a.unlocks !== undefined) m.unlocks = Object.assign({ cutting: false, zones: [], handover: false }, clone(a.unlocks));
    },
    REMOVE_MILESTONE(s, a, ctx) { quoteGuard(s); milestone(s, a.id); s.milestones = s.milestones.filter((m) => m.id !== a.id); },

    SIGN_AGREEMENT(s, a, ctx) {
      quoteGuard(s);
      must(s.project.pin.confirmed, 'Confirm the site pin first');
      const panels = allPanels(s); must(panels.length > 0, 'Add at least one window');
      for (const x of panels) {
        must(x.panel.w > 0 && x.panel.h > 0, 'Panel ' + x.panel.id + ' needs a size');
        if (x.panel.shape === 'custom') must(x.panel.verifiedSqft > 0 && x.panel.photo, 'Custom glass ' + x.panel.id + ' needs verified sqft + reference photo');
      }
      for (const r of s.rooms) must(zoneOf(s, r.zoneId), 'Room ' + r.id + ' needs a zone');
      must(s.milestones.length > 0, 'Add payment milestones');
      for (const m of s.milestones) {
        must(m.amount > 0, m.label + ': enter an amount');
        for (const z of (m.unlocks.zones || []).concat(m.trigger.type === 'zones_approved' ? m.trigger.zones || [] : [])) must(zoneOf(s, z), m.label + ': unknown zone ' + z);
        if (m.trigger.type === 'zones_approved') must((m.trigger.zones || []).length, m.label + ': choose zones for the trigger');
        if (m.trigger.type === 'date') must(m.trigger.date, m.label + ': choose a date');
        if (m.trigger.type === 'progress') must(Number(m.trigger.pct) > 0 && Number(m.trigger.pct) <= 100, m.label + ': progress % 1–100');
      }
      must(s.milestones.some((m) => m.unlocks.cutting), 'One milestone must be the deposit that unlocks cutting');
      must(text(a.signer), 'Enter the signer name');
      must(typeof a.signature === 'string' && a.signature.length > 20, 'Customer signature required');
      must(a.accept === true, 'Customer must accept the agreement');
      if (s.quote.dirty || !s.quote.versions.length) HANDLERS.SAVE_VERSION(s, { note: 'At signing' }, ctx);
      const ver = s.quote.versions[s.quote.versions.length - 1];
      for (const x of panels) {
        s.pieces[x.panel.id] = {
          windowId: x.panel.id, assemblyId: x.asm.id, roomId: x.asm.roomId, zoneId: x.room.zoneId, series: x.asm.series,
          w: x.panel.w, h: x.panel.h, shape: x.panel.shape, area: round2(panelSqft(x.panel)), rev: 1,
          plan: null, reservation: null, cut: null, bundleId: null, dispatched: false, claim: null, installed: null, issue: null, history: [],
        };
      }
      for (const m of s.milestones) Object.assign(m, { dueAt: null, requestSentAt: null, proofs: [], receipts: [], verified: null });
      s.project.mwo = 'MWO-' + s.project.id.replace('ADB-', '');
      s.agreement = {
        quoteVersion: ver.v, signedAt: ctx.iso, signer: text(a.signer), signerTitle: text(a.signerTitle), signature: a.signature,
        collectedBy: ctx.actor, method: 'In person · Salesman device', totalSqft: quoteSqft(s),
        milestones: s.milestones.map((m) => ({ id: m.id, label: m.label, amount: m.amount, trigger: clone(m.trigger), unlocks: clone(m.unlocks) })),
        cancellationTerms: null,
      };
      log(s, ctx, 'Agreement signed in person by ' + text(a.signer) + ' · ' + s.project.mwo + ' created · Awaiting deposit');
    },

    MARK_REQUEST_SENT(s, a, ctx) {
      const m = milestone(s, a.id); must(m.dueAt, 'Not due yet'); must(!m.verified, 'Already verified');
      m.requestSentAt = ctx.iso; s.alerts.forEach((al) => { if (al.ref === m.id) al.done = true; });
      log(s, ctx, m.label + ' request sent via WhatsApp (outside app)');
    },
    UPLOAD_PROOF(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first'); const m = milestone(s, a.id); must(!m.verified, 'Already verified');
      const f = text(a.fileName); must(f, 'Choose a proof file');
      m.proofs.push({ name: f, by: ctx.actor, at: ctx.iso });
      log(s, ctx, m.label + ' proof uploaded · ' + f); alertTo(s, ctx, 'mei', 'Proof uploaded · verify ' + m.label, m.id);
    },
    RECORD_RECEIPT(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first'); const m = milestone(s, a.id); must(!m.verified, 'Already verified');
      const v = posNum(a.amount); must(v, 'Enter the amount received');
      must(received(m) + v <= m.amount + 0.001, 'More than the outstanding ' + round2(m.amount - received(m)));
      m.receipts.push({ amount: v, by: ctx.actor, at: ctx.iso, ref: text(a.ref) });
      log(s, ctx, m.label + ' receipt recorded · RM ' + v + ' (' + received(m) + ' of ' + m.amount + ')');
    },
    VERIFY_MILESTONE(s, a, ctx) {
      const m = milestone(s, a.id); must(!m.verified, 'Already verified');
      must(received(m) >= m.amount, 'Full payment not received · ' + received(m) + ' of ' + m.amount);
      m.verified = { by: ctx.actor, at: ctx.iso };
      log(s, ctx, m.label + ' verified · funds received');
    },
    DIRECTOR_EXCEPTION(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first'); const m = milestone(s, a.id); must(!m.verified, 'Already verified');
      const scope = a.scope === 'cutting' ? 'cutting' : 'install';
      const zones = (a.zones || []).filter((z) => zoneOf(s, z)); must(zones.length, 'Choose the zones this covers');
      if (scope === 'cutting') must(m.unlocks.cutting, 'This milestone does not gate cutting');
      else for (const z of zones) must(m.unlocks.cutting || (m.unlocks.zones || []).includes(z), m.label + ' does not gate ' + z);
      const reason = text(a.reason); must(reason.length >= 5, 'Write the reason');
      for (const z of zones) must(!s.exceptions.some((e) => e.milestoneId === m.id && e.scope === scope && e.zones.includes(z)), 'Exception already exists for ' + z);
      const ex = { id: 'EX-' + nextId(s, 'ex'), milestoneId: m.id, label: m.label, scope, zones, reason, by: ctx.actor, at: ctx.iso, outstanding: round2(m.amount - received(m)) };
      s.exceptions.push(ex);
      log(s, ctx, 'Director exception ' + ex.id + ' · ' + m.label + ' · ' + scope + ' · ' + zones.join(', ') + ' · RM ' + ex.outstanding + ' outstanding');
    },

    PLAN_SOURCE(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first'); const p = piece(s, a.windowId); must(!s.amendments.some((am) => am.windowId === p.windowId && am.status === 'pending'), 'Window paused · Director amendment pending'); must(['to_cut', 'reserved'].includes(pieceStatus(p)), 'Already cut');
      if (!a.code) { p.plan = null; return; }
      must(suggestSources(s, p.windowId).some((x) => x.code === a.code) || (p.reservation && p.reservation.code === a.code), 'Source does not fit this piece');
      p.plan = { kind: a.code.includes('-R') ? 'roll' : 'leftover', code: a.code, by: ctx.actor, at: ctx.iso };
      log(s, ctx, 'Planned ' + p.windowId + ' from ' + a.code);
    },
    RESERVE_LEFTOVER(s, a, ctx) {
      const p = piece(s, a.windowId); must(!s.amendments.some((am) => am.windowId === p.windowId && am.status === 'pending'), 'Window paused · Director amendment pending'); const g = gate(s, p.zoneId, 'cutting'); must(g.open, 'Cutting locked · ' + g.reason);
      must(pieceStatus(p) === 'to_cut', p.reservation ? 'Already reserved · ' + p.reservation.code : 'Already cut');
      const l = leftover(s, a.code);
      must(l.status === 'available', l.code + ' is ' + l.status + (l.reservedFor ? ' for ' + l.reservedFor : ''));
      must(l.series === p.series, 'Series mismatch');
      must(leftoverFits(l, p.w, p.h), l.code + ' is too small');
      Object.assign(l, { status: 'reserved', reservedFor: p.windowId, reservedBy: ctx.actor });
      p.reservation = { code: l.code, by: ctx.actor, at: ctx.iso };
      log(s, ctx, 'Reserved ' + l.code + ' for ' + p.windowId);
    },
    CANCEL_RESERVATION(s, a, ctx) {
      const p = piece(s, a.windowId);
      must(!p.cut, 'Already cut · consumed film cannot be restored');
      must(p.reservation, 'No reservation');
      if (USERS[ctx.actor].role !== 'head') must(p.reservation.by === ctx.actor, 'Only Garage Head can release another person\'s reservation');
      const code = p.reservation.code; releaseReservation(s, p);
      log(s, ctx, 'Released ' + code + ' from ' + p.windowId);
    },
    REASSIGN_RESERVATION(s, a, ctx) {
      const from = piece(s, a.windowId); const to = piece(s, a.toWindowId); must(!s.amendments.some((am) => am.windowId === to.windowId && am.status === 'pending'), 'Target window paused · amendment pending');
      must(from.reservation, 'No reservation'); must(!from.cut, 'Already cut');
      must(pieceStatus(to) === 'to_cut', a.toWindowId + ' is not waiting to cut');
      const g = gate(s, to.zoneId, 'cutting'); must(g.open, 'Cutting locked · ' + g.reason);
      const l = leftover(s, from.reservation.code);
      must(l.series === to.series && leftoverFits(l, to.w, to.h), l.code + ' does not fit ' + to.windowId);
      to.reservation = { code: l.code, by: ctx.actor, at: ctx.iso }; from.reservation = null;
      Object.assign(l, { reservedFor: to.windowId, reservedBy: ctx.actor });
      log(s, ctx, 'Reassigned ' + l.code + ' · ' + from.windowId + ' → ' + to.windowId);
    },
    CONFIRM_CUT(s, a, ctx) {
      const p = piece(s, a.windowId); must(!s.amendments.some((am) => am.windowId === p.windowId && am.status === 'pending'), 'Window paused · Director amendment pending'); const g = gate(s, p.zoneId, 'cutting'); must(g.open, 'Cutting locked · ' + g.reason);
      must(!p.cut, 'Already cut · no second stock deduction');
      must(['to_cut', 'reserved'].includes(pieceStatus(p)), 'Not waiting to cut');
      const c = a.checks || {}; must(c.id && c.series && c.dims, 'Confirm Window ID, series and size');
      const src = a.source || {}; let detail;
      if (src.kind === 'leftover') {
        must(p.reservation && p.reservation.code === src.code, 'Reserve ' + src.code + ' first');
        const l = leftover(s, src.code);
        must(l.status === 'reserved' && l.reservedFor === p.windowId, l.code + ' not reserved for this piece');
        Object.assign(l, { status: 'consumed', consumedFor: p.windowId + ' r' + p.rev, consumedAt: ctx.iso });
        p.reservation = null; detail = 'leftover ' + l.code;
      } else if (src.kind === 'roll') {
        must(!p.reservation, 'Cancel reservation ' + (p.reservation && p.reservation.code) + ' first');
        const r = s.stock.rolls.find((x) => x.code === src.code); must(r, 'Choose a roll');
        must(r.series === p.series, 'Series mismatch');
        const use = rollUse(r, p.w, p.h); must(use !== null, 'Piece wider than roll'); must(use <= r.length, r.code + ' has only ' + r.length + ' in left');
        r.length = round2(r.length - use); detail = 'roll ' + r.code + ' · ' + use + ' in';
      } else fail('Choose a material source');
      p.cut = { by: ctx.actor, at: ctx.iso, source: { kind: src.kind, code: src.code }, rev: p.rev };
      s.stock.ledger.unshift({ id: 'LG-' + nextId(s, 'lg'), kind: 'cut', windowId: p.windowId, rev: p.rev, source: src.code, sqft: p.area, by: ctx.actor, at: ctx.iso });
      log(s, ctx, 'Cut ' + p.windowId + (p.rev > 1 ? ' r' + p.rev : '') + ' · ' + detail + ' · ID/series/size checked');
    },
    REPORT_OFFCUT(s, a, ctx) {
      const r = s.stock.rolls.find((x) => x.code === a.fromRoll); must(r, 'Choose the source roll');
      const w = posNum(a.w); const h = posNum(a.h); must(w && h, 'Enter offcut size');
      const id = 'OC-' + nextId(s, 'oc');
      s.stock.offcuts.unshift({ id, series: r.series, w, h, fromRoll: r.code, by: ctx.actor, at: ctx.iso, status: 'pending' });
      log(s, ctx, 'Offcut ' + w + '×' + h + ' reported from ' + r.code);
    },
    CLASSIFY_OFFCUT(s, a, ctx) {
      const o = s.stock.offcuts.find((x) => x.id === a.id); must(o && o.status === 'pending', 'Offcut not pending');
      if (a.decision === 'reusable') {
        const code = nextLeftoverCode(s, o.series);
        s.stock.leftovers.push({ code, series: o.series, w: o.w, h: o.h, fromRoll: o.fromRoll, status: 'available' });
        o.status = 'reusable'; o.code = code; log(s, ctx, 'Offcut kept as ' + code + ' · write code on packaging');
      } else if (a.decision === 'wastage') {
        o.status = 'wastage'; s.stock.ledger.unshift({ id: 'LG-' + nextId(s, 'lg'), kind: 'offcut wastage', source: o.fromRoll, sqft: round2(rectSqft(o.w, o.h)), by: ctx.actor, at: ctx.iso });
        log(s, ctx, 'Offcut ' + o.id + ' classed as wastage');
      } else fail('Choose reusable or wastage');
      o.decidedBy = ctx.actor;
    },
    REGISTER_ROLL(s, a, ctx) {
      must(SERIES[a.series], 'Choose a series'); const w = posNum(a.width); const l = posNum(a.length); must(w && l, 'Enter width and length');
      const n = s.stock.rolls.filter((r) => r.series === a.series).length + 1;
      const code = a.series + '-R' + pad3(n);
      s.stock.rolls.push({ code, series: a.series, width: w, length: l, original: l, by: ctx.actor, at: ctx.iso });
      log(s, ctx, 'Roll ' + code + ' registered + confirmed');
    },
    REPORT_STOCK_MISMATCH(s, a, ctx) {
      const l = leftover(s, a.code); must(['available', 'reserved'].includes(l.status), l.code + ' is ' + l.status);
      const w = posNum(a.w); const h = posNum(a.h); must(w && h, 'Enter actual size');
      must(text(a.reason), 'Reason required'); must(text(a.evidence), 'Evidence photo required');
      if (l.status === 'reserved') { const p = s.pieces[l.reservedFor]; if (p) releaseReservation(s, p); }
      l.status = 'held';
      const d = { id: 'SD-' + nextId(s, 'sd'), code: l.code, original: { w: l.w, h: l.h }, actual: { w, h }, reason: text(a.reason), evidence: text(a.evidence), by: ctx.actor, at: ctx.iso, status: 'pending_head', directorReview: null };
      s.stock.discrepancies.unshift(d);
      log(s, ctx, 'Stock mismatch ' + d.id + ' · ' + l.code + ' ' + l.w + '×' + l.h + ' → ' + w + '×' + h);
    },
    VERIFY_STOCK_ADJUST(s, a, ctx) {
      const d = s.stock.discrepancies.find((x) => x.id === a.id); must(d && d.status === 'pending_head', 'Not pending');
      const l = leftover(s, d.code); l.w = d.actual.w; l.h = d.actual.h; l.status = 'available';
      Object.assign(d, { status: 'adjusted', verifiedBy: ctx.actor, verifiedAt: ctx.iso });
      log(s, ctx, 'Stock adjusted ' + d.id + ' · original kept in record');
    },
    DIRECTOR_REVIEW_DISCREPANCY(s, a, ctx) {
      const d = s.stock.discrepancies.find((x) => x.id === a.id); must(d && d.status === 'adjusted', 'Garage Head must verify first');
      must(!d.directorReview, 'Already reviewed'); must(text(a.note), 'Add a note');
      d.directorReview = { by: ctx.actor, at: ctx.iso, note: text(a.note) }; log(s, ctx, 'Director reviewed ' + d.id);
    },
    APPROVE_BUNDLE(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first');
      const cands = piecesList(s).filter((p) => p.roomId === a.roomId && !p.dispatched && !p.bundleId && !p.installed);
      must(cands.length, 'Nothing to bundle in ' + a.roomId);
      const notCut = cands.filter((p) => !p.cut); must(!notCut.length, 'Not cut yet: ' + notCut.map((p) => p.windowId).join(', '));
      const id = 'B-' + a.roomId + '-' + nextId(s, 'b' + a.roomId);
      const spot = (a.spotCheck || []).filter((w) => cands.some((p) => p.windowId === w));
      s.bundles.push({ id, roomId: a.roomId, pieces: cands.map((p) => p.windowId + (p.rev > 1 ? ' r' + p.rev : '')), windowIds: cands.map((p) => p.windowId), approvedBy: ctx.actor, approvedAt: ctx.iso, spotCheck: spot, dispatchedAt: null });
      cands.forEach((p) => { p.bundleId = id; });
      log(s, ctx, 'Bundle ' + id + ' approved · ' + cands.length + ' pieces' + (spot.length ? ' · spot-checked ' + spot.join(', ') : ''));
    },
    DISPATCH_BUNDLE(s, a, ctx) {
      const b = s.bundles.find((x) => x.id === a.bundleId); must(b, 'Unknown bundle'); must(!b.dispatchedAt, 'Already dispatched');
      b.dispatchedAt = ctx.iso; b.dispatchedBy = ctx.actor;
      b.windowIds.forEach((w) => { const p = s.pieces[w]; if (p && p.bundleId === b.id) p.dispatched = true; });
      log(s, ctx, 'Dispatched ' + b.id + ' · counts as received at site');
    },

    ASSIGN_TEAM(s, a, ctx) {
      const members = (a.members || []).filter((m) => USERS[m] && USERS[m].role === 'installer');
      must(members.length, 'Choose at least one installer');
      s.team.members = members; log(s, ctx, 'Site team · ' + members.map(userName).join(', ') + ' · site presence on');
    },
    SET_TARGETS(s, a, ctx) {
      const mp = Math.round(num(a.manpower)); const days = posNum(a.days); must(mp >= 1 && days, 'Enter manpower and days');
      s.team.targets = { manpower: mp, days, by: ctx.actor }; log(s, ctx, 'Target · ' + mp + ' people · ' + days + ' day(s)');
    },
    CHECK_IN(s, a, ctx) {
      must(s.agreement, 'No signed project'); must(s.team.members.includes(ctx.actor), 'Not on this site team');
      must(s.project.pin.confirmed, 'Site pin not confirmed');
      must(!s.team.presence.some((r) => r.user === ctx.actor && !r.out), 'Already on site');
      s.team.presence.push({ id: 'PR-' + nextId(s, 'pr'), user: ctx.actor, in: ctx.iso, out: null });
      log(s, ctx, 'Arrived on site (approx.)');
    },
    CHECK_OUT(s, a, ctx) {
      const r = s.team.presence.find((x) => x.user === ctx.actor && !x.out); must(r, 'Not checked in');
      r.out = ctx.iso; log(s, ctx, 'Left site (approx.)');
    },
    CLAIM_PANEL(s, a, ctx) {
      const p = piece(s, a.windowId);
      must(s.team.members.includes(ctx.actor), 'Not on this site team');
      must(s.team.presence.some((r) => r.user === ctx.actor && !r.out), 'Check in on site first');
      const g = gate(s, p.zoneId, 'install'); must(g.open, p.zoneId + ' locked · ' + g.reason);
      must(pieceStatus(p) === 'on_site', p.dispatched ? 'Not available · ' + pieceStatus(p) : 'Film not dispatched yet');
      p.claim = { by: ctx.actor, at: ctx.iso }; zoneOf(s, p.zoneId).started = true;
      log(s, ctx, 'Claimed ' + p.windowId);
    },
    RELEASE_CLAIM(s, a, ctx) {
      const p = piece(s, a.windowId); must(p.claim && p.claim.by === ctx.actor, 'Not your claim');
      p.claim = null; log(s, ctx, 'Released ' + p.windowId);
    },
    MARK_INSTALLED(s, a, ctx) {
      /* Allowed while paused: current work may reach a safe stopping point. */
      const p = piece(s, a.windowId); must(p.claim && p.claim.by === ctx.actor, 'Claim this window first');
      p.installed = { by: ctx.actor, at: ctx.iso }; p.claim = null;
      log(s, ctx, 'Installed ' + p.windowId);
    },
    REPORT_ISSUE(s, a, ctx) {
      const p = piece(s, a.windowId); must(!p.issue, 'Issue already open');
      must(p.dispatched, 'Film not at site yet');
      must(ISSUE_KIND[a.kind], 'Choose issue type'); must(text(a.evidence), 'Photo evidence required for this window');
      p.issue = { kind: a.kind, note: text(a.note), evidence: text(a.evidence), by: ctx.actor, at: ctx.iso, status: a.kind === 'measurement' ? 'needs_amendment' : 'awaiting_head' };
      p.claim = null; resetZone(s, p.zoneId);
      if (a.kind === 'measurement') alertTo(s, ctx, s.project.salesman, 'Measurement amendment needed · ' + p.windowId, p.windowId);
      alertTo(s, ctx, 'ravi', ISSUE_KIND[a.kind] + ' · ' + p.windowId, p.windowId);
      log(s, ctx, ISSUE_KIND[a.kind] + ' reported · ' + p.windowId);
    },
    AUTHORIZE_REPLACEMENT(s, a, ctx) {
      const p = piece(s, a.windowId); must(p.issue, 'No open issue');
      must(p.issue.status === 'awaiting_head', p.issue.status === 'needs_amendment' ? 'Needs Salesman amendment + Director approval first' : 'Not ready');
      p.history.push({ rev: p.rev, w: p.w, h: p.h, cut: p.cut, bundleId: p.bundleId, installed: p.installed, issue: p.issue, closedAt: ctx.iso });
      s.losses.unshift({ id: 'LS-' + nextId(s, 'ls'), windowId: p.windowId, rev: p.rev, kind: p.issue.kind, sqft: p.cut ? p.area : 0, reportedBy: p.issue.by, at: ctx.iso, headNote: '', decision: null });
      Object.assign(p, { rev: p.rev + 1, plan: null, reservation: null, cut: null, bundleId: null, dispatched: false, claim: null, installed: null, issue: null });
      resetZone(s, p.zoneId);
      log(s, ctx, 'Replacement cut authorized · ' + p.windowId + ' r' + p.rev + ' · original history kept');
    },
    REPORT_WASTAGE(s, a, ctx) {
      must(s.agreement, 'No signed project'); const v = posNum(a.sqft); must(v, 'Enter sqft'); must(text(a.reason), 'Reason required');
      if (a.windowId) piece(s, a.windowId);
      const id = 'WS-' + nextId(s, 'ws');
      s.wastage.unshift({ id, windowId: a.windowId || null, sqft: v, reason: text(a.reason), by: ctx.actor, at: ctx.iso, review: null });
      s.stock.ledger.unshift({ id: 'LG-' + nextId(s, 'lg'), kind: 'wastage', windowId: a.windowId || null, sqft: v, ref: id, by: ctx.actor, at: ctx.iso });
      log(s, ctx, 'Wastage ' + v + ' sqft logged · ' + text(a.reason));
    },
    REVIEW_WASTAGE(s, a, ctx) {
      const w = s.wastage.find((x) => x.id === a.id); must(w && !w.review, 'Not pending');
      const corr = a.correctedSqft === undefined || a.correctedSqft === '' ? w.sqft : num(a.correctedSqft);
      must(Number.isFinite(corr) && corr >= 0, 'Bad corrected sqft');
      w.review = { by: ctx.actor, at: ctx.iso, from: w.sqft, to: corr, note: text(a.note) };
      if (corr !== w.sqft) s.stock.ledger.unshift({ id: 'LG-' + nextId(s, 'lg'), kind: 'wastage correction', ref: w.id, sqft: round2(corr - w.sqft), by: ctx.actor, at: ctx.iso });
      log(s, ctx, 'Wastage ' + w.id + ' reviewed' + (corr !== w.sqft ? ' · corrected ' + w.sqft + ' → ' + corr : ''));
    },
    ADD_ZONE_PHOTO(s, a, ctx) {
      must(s.agreement, 'No signed project'); const r = roomOf(s, a.roomId); must(r, 'Unknown room');
      s.photos.push({ id: 'PH-' + nextId(s, 'ph'), roomId: r.id, label: text(a.label) || 'Completion photo (placeholder)', by: ctx.actor, at: ctx.iso });
      const z = zoneOf(s, r.zoneId);
      if (z.inspection && z.inspection.status === 'photos_requested') { z.inspection.status = 'pending'; z.inspection.resubmittedAt = ctx.iso; log(s, ctx, z.id + ' photos added · back to inspection'); }
      else log(s, ctx, 'Photo added · ' + r.id);
    },
    CONFIRM_ZONE(s, a, ctx) {
      const z = zoneOf(s, a.zoneId); must(z, 'Unknown zone'); must(!z.inspection, 'Already submitted');
      const ps = zonePieces(s, z.id); must(ps.length && ps.every((p) => pieceStatus(p) === 'installed'), 'All windows in ' + z.id + ' must be installed');
      const inv = involved(s, z.id); must(inv.includes(ctx.actor), 'Only installers who worked on ' + z.id + ' confirm');
      const miss = roomsMissingPhoto(s, z.id); must(!miss.length, 'Completion photo needed · ' + miss.join(', '));
      must(!z.confirmations[ctx.actor], 'Already confirmed');
      z.confirmations[ctx.actor] = ctx.iso; log(s, ctx, 'Confirmed own work · ' + z.id);
      if (inv.every((u) => z.confirmations[u])) {
        z.inspection = { status: 'pending', at: ctx.iso };
        alertTo(s, ctx, 'ravi', z.id + ' ready for inspection', z.id);
        s.audit.unshift({ at: ctx.iso, by: 'system', role: 'system', text: z.id + ' · all confirmed · Pending inspection' });
      }
    },
    APPROVE_ZONE(s, a, ctx) {
      const z = zoneOf(s, a.zoneId); must(z && z.inspection && z.inspection.status === 'pending', 'Not pending inspection');
      Object.assign(z.inspection, { status: 'approved', by: ctx.actor, approvedAt: ctx.iso });
      log(s, ctx, z.id + ' approved');
    },
    REQUEST_PHOTOS(s, a, ctx) {
      const z = zoneOf(s, a.zoneId); must(z && z.inspection && z.inspection.status === 'pending', 'Not pending inspection');
      Object.assign(z.inspection, { status: 'photos_requested', note: text(a.note) || 'More photos', requestedAt: ctx.iso });
      log(s, ctx, z.id + ' · more photos requested');
    },

    REQUEST_AMENDMENT(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first'); const p = piece(s, a.windowId);
      const st = pieceStatus(p);
      must((p.issue && p.issue.status === 'needs_amendment') || st === 'to_cut' || st === 'reserved', 'Amend measurements before cutting, or after a measurement issue is reported');
      must(!s.amendments.some((x) => x.windowId === p.windowId && x.status === 'pending'), 'Amendment already pending');
      const w = posNum(a.w); const h = posNum(a.h); must(w && h, 'Enter corrected size'); must(text(a.reason), 'Reason required');
      must(w !== p.w || h !== p.h, 'Size unchanged');
      const am = { id: 'AM-' + nextId(s, 'am'), windowId: p.windowId, rev: p.rev, original: { w: p.w, h: p.h }, proposed: { w, h }, reason: text(a.reason), by: ctx.actor, at: ctx.iso, status: 'pending', customerCharge: 0 };
      s.amendments.unshift(am); alertTo(s, ctx, 'lim', 'Approve amendment ' + am.id, am.id);
      log(s, ctx, 'Amendment ' + am.id + ' · ' + p.windowId + ' ' + p.w + '×' + p.h + ' → ' + w + '×' + h + ' · no customer charge');
    },
    APPROVE_AMENDMENT(s, a, ctx) {
      const am = s.amendments.find((x) => x.id === a.id); must(am && am.status === 'pending', 'Not pending');
      const p = piece(s, am.windowId);
      must(am.rev === p.rev && (!p.cut || (p.issue && p.issue.status === 'needs_amendment')), 'Window changed · review amendment again');
      p.history.push({ rev: p.rev, type: 'measurement', from: am.original, to: am.proposed, amendment: am.id, at: ctx.iso });
      releaseReservation(s, p); p.plan = null;
      p.w = am.proposed.w; p.h = am.proposed.h; p.area = round2(rectSqft(p.w, p.h));
      if (p.issue && p.issue.status === 'needs_amendment') p.issue.status = 'awaiting_head';
      Object.assign(am, { status: 'approved', decidedBy: ctx.actor, decidedAt: ctx.iso });
      log(s, ctx, 'Amendment ' + am.id + ' approved · price unchanged');
    },
    REJECT_AMENDMENT(s, a, ctx) {
      const am = s.amendments.find((x) => x.id === a.id); must(am && am.status === 'pending', 'Not pending'); must(text(a.note), 'Add a note');
      Object.assign(am, { status: 'rejected', decidedBy: ctx.actor, decidedAt: ctx.iso, note: text(a.note) });
      log(s, ctx, 'Amendment ' + am.id + ' rejected');
    },
    HEAD_LOSS_NOTE(s, a, ctx) {
      const l = s.losses.find((x) => x.id === a.id); must(l, 'Unknown'); must(!l.decision, 'Already decided'); must(text(a.note), 'Add findings');
      l.headNote = text(a.note); l.headBy = ctx.actor; log(s, ctx, 'Investigation note · ' + l.id);
    },
    DIRECTOR_LOSS_DECISION(s, a, ctx) {
      const l = s.losses.find((x) => x.id === a.id); must(l, 'Unknown'); must(l.headNote, 'Garage Head investigates first'); must(!l.decision, 'Already decided');
      must(['company_absorbs', 'employee_followup'].includes(a.decision), 'Choose a decision');
      l.decision = { value: a.decision, by: ctx.actor, at: ctx.iso, note: text(a.note) };
      log(s, ctx, 'Loss ' + l.id + ' · ' + (a.decision === 'company_absorbs' ? 'company absorbs' : 'employee follow-up') + ' · no payroll deduction');
    },
    REQUEST_CANCELLATION(s, a, ctx) {
      must(s.agreement, 'Nothing signed to cancel'); must(!s.handover, 'Already handed over');
      must(!isPaused(s), 'Cancellation already open'); must(text(a.reason), 'Reason required');
      s.cancellation = { status: 'review', reason: text(a.reason), by: ctx.actor, at: ctx.iso, summary: cancellationSummary(s) };
      alertTo(s, ctx, 'lim', 'Cancellation review', 'cancel');
      log(s, ctx, 'Cancellation requested · new zones, cutting and reservations paused');
    },
    DIRECTOR_CANCELLATION(s, a, ctx) {
      must(s.cancellation && s.cancellation.status === 'review', 'No cancellation in review'); must(text(a.note), 'Add review note');
      if (a.decision === 'withdraw') { Object.assign(s.cancellation, { status: 'withdrawn', decidedBy: ctx.actor, decidedAt: ctx.iso, note: text(a.note) }); log(s, ctx, 'Cancellation withdrawn · work resumes'); }
      else if (a.decision === 'confirm') {
        piecesList(s).forEach((p) => { if (!p.cut) releaseReservation(s, p); });
        Object.assign(s.cancellation, { status: 'confirmed', decidedBy: ctx.actor, decidedAt: ctx.iso, note: text(a.note), summary: cancellationSummary(s) });
        log(s, ctx, 'Cancellation confirmed · unused reservations released · settlement outside demo');
      } else fail('Choose withdraw or confirm');
    },
    DELEGATE_HANDOVER(s, a, ctx) {
      must(s.agreement && !s.handover, 'Delegate before handover');
      if (!a.installer) { s.delegation = null; log(s, ctx, 'Handover delegation revoked'); return; }
      must(s.zones.some((z) => involved(s, z.id).includes(a.installer)), 'Choose an installer who worked on this project');
      s.delegation = { installer: a.installer, by: ctx.actor, at: ctx.iso };
      log(s, ctx, 'Handover delegated to ' + userName(a.installer) + ' · accountable Salesman ' + userName(s.project.salesman));
    },
    CASH_RECEIVED(s, a, ctx) {
      must(s.agreement, 'Sign the agreement first');
      must(ctx.actor === s.project.salesman || (s.delegation && ctx.actor === s.delegation.installer), 'Salesman must delegate cash collection to you');
      const amount = posNum(a.amount); must(amount, 'Enter amount received');
      const receipt = 'RCPT-DEMO-' + pad3(nextId(s, 'cash'));
      s.cash.push({ id: receipt, amount, holder: ctx.actor, receivedBy: ctx.actor, salesman: s.project.salesman, at: ctx.iso, status: ctx.actor === s.project.salesman ? 'with_salesman' : 'pending', checks: [] });
      log(s, ctx, receipt + ' · RM ' + amount + ' cash held by ' + userName(ctx.actor) + ' · payment not verified');
    },
    ACK_CASH(s, a, ctx) {
      const c = s.cash.find((r) => r.id === a.id); must(c && c.status !== 'with_salesman', 'No pending cash handoff');
      const amount = num(a.amount); must(Number.isFinite(amount) && amount >= 0, 'Enter counted amount');
      c.checks.push({ amount, by: ctx.actor, at: ctx.iso });
      if (amount !== c.amount) { c.status = 'mismatch'; log(s, ctx, c.id + ' cash mismatch · recorded ' + c.amount + ', counted ' + amount + ' · custody unchanged'); return; }
      c.holder = ctx.actor; c.status = 'with_salesman'; c.acknowledgedAt = ctx.iso;
      log(s, ctx, c.id + ' acknowledged by original Salesman · no payment verification');
    },
    HANDOVER_SIGN(s, a, ctx) {
      must(ctx.actor === s.project.salesman || (s.delegation && ctx.actor === s.delegation.installer), 'Salesman must delegate handover to you');
      must(!s.handover, 'Already handed over');
      const bad = handoverChecks(s).filter((c) => !c.ok); must(!bad.length, 'Not ready · ' + bad.map((c) => c.label).join('; '));
      must(text(a.photo), 'Delivery photo required'); must(text(a.signer), 'Enter the signer name');
      must(typeof a.signature === 'string' && a.signature.length > 20, 'Customer signature required');
      const issues = (a.issues || []).map(text).filter(Boolean);
      issues.forEach((t) => s.corrections.push({ id: 'CR-' + nextId(s, 'cr'), text: t, status: 'open', at: ctx.iso }));
      s.handover = { status: issues.length ? 'conditional' : 'completed', signer: text(a.signer), signature: a.signature, photo: text(a.photo), photoKind: a.photoKind === 'site' ? 'site' : 'customer', by: ctx.actor, accountableSalesman: s.project.salesman, at: ctx.iso, ack: null };
      log(s, ctx, issues.length ? 'Conditional handover signed · ' + issues.length + ' issue(s) open' : 'Handover signed · project completed');
    },
    RESOLVE_CORRECTION(s, a, ctx) {
      const c = s.corrections.find((x) => x.id === a.id); must(c && c.status === 'open', 'Not open'); must(text(a.note), 'Describe the fix');
      Object.assign(c, { status: 'resolved', by: ctx.actor, resolvedAt: ctx.iso, note: text(a.note) }); log(s, ctx, 'Correction ' + c.id + ' resolved');
    },
    CUSTOMER_ACK(s, a, ctx) {
      must(ctx.actor === s.project.salesman || (s.delegation && ctx.actor === s.delegation.installer), 'Not delegated for handover');
      must(s.handover && s.handover.status === 'conditional', 'No conditional handover');
      must(s.corrections.every((c) => c.status === 'resolved'), 'Resolve all corrections first');
      must(text(a.signer), 'Enter the signer name'); must(typeof a.signature === 'string' && a.signature.length > 20, 'Customer signature required');
      s.handover.ack = { signer: text(a.signer), signature: a.signature, at: ctx.iso, by: ctx.actor }; s.handover.status = 'completed';
      log(s, ctx, 'Customer acknowledged corrections · project completed');
    },
  };

  function apply(state, action, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const ctx = { actor: action.actor, now: t, iso: new Date(t).toISOString() };
    try {
      must(USERS[ctx.actor], 'Unknown user');
      const h = HANDLERS[action.type]; must(h, 'Unknown action ' + action.type);
      const role = USERS[ctx.actor].role;
      must(PERM[action.type].includes(role), ROLE_LABEL[role] + ' cannot do this · ' + PERM[action.type].map((r) => ROLE_LABEL[r]).join(' / ') + ' only');
      if (role === 'salesman') must(ctx.actor === state.project.salesman, 'Only the project Salesman');
      if (state.handover && state.handover.status === 'completed' && action.type !== 'DIRECTOR_REVIEW_DISCREPANCY' && action.type !== 'DIRECTOR_LOSS_DECISION' && action.type !== 'HEAD_LOSS_NOTE' && action.type !== 'ACK_CASH')
        fail('Project completed');
      if (state.cancellation && state.cancellation.status === 'confirmed' && !['DIRECTOR_REVIEW_DISCREPANCY', 'DIRECTOR_LOSS_DECISION', 'HEAD_LOSS_NOTE', 'RECORD_RECEIPT', 'ACK_CASH'].includes(action.type))
        fail('Project cancelled');
      const s = clone(state); if (!Array.isArray(s.cash)) s.cash = [];
      const result = h(s, action, ctx) || {};
      if (QUOTE_ACTIONS.has(action.type)) s.quote.dirty = true;
      refresh(s, ctx);
      return { ok: true, state: s, result };
    } catch (e) {
      if (e instanceof DemoError) return { ok: false, state, error: e.message };
      throw e;
    }
  }

  /* Run a list of actions; stops on first failure. Used by presets and tests. */
  function run(state, actions, start) {
    let s = state; let t = start || Date.parse('2026-10-19T09:00:00Z');
    for (const a of actions) {
      t += 60000;
      const r = apply(s, a, t);
      if (!r.ok) return { ok: false, state: s, error: r.error, failed: a };
      s = r.state;
    }
    return { ok: true, state: s };
  }

  const SIG = 'data:image/png;base64,DEMO-SIGNATURE-PLACEHOLDER-0000';
  const SCRIPTS = {
    signed: [
      { type: 'CONFIRM_PIN', actor: 'alex', address: 'No. 1, Jalan Demo 1, Taman Demo' },
      { type: 'SIGN_AGREEMENT', actor: 'alex', signer: 'Ms. Demo', signerTitle: 'Director, Demo Holdings', signature: SIG, accept: true },
    ],
    deposit: [
      { type: 'RECORD_RECEIPT', actor: 'mei', id: 'M1', amount: 6000, ref: 'DEMO-TRX-1' },
      { type: 'VERIFY_MILESTONE', actor: 'mei', id: 'M1' },
    ],
    cutZ1: [
      { type: 'RESERVE_LEFTOVER', actor: 'jay', windowId: '1A-W1-1', code: 'A-001' },
      { type: 'CONFIRM_CUT', actor: 'jay', windowId: '1A-W1-1', source: { kind: 'leftover', code: 'A-001' }, checks: { id: true, series: true, dims: true } },
      ...['1A-W1-2', '1A-W1-3', '1A-S1-1', '1A-S1-2', '1A-S1-3', '1A-S1-4'].map((w) => ({ type: 'CONFIRM_CUT', actor: 'jay', windowId: w, source: { kind: 'roll', code: 'A-R001' }, checks: { id: true, series: true, dims: true } })),
      ...['1B-W1-1', '1B-W1-2'].map((w) => ({ type: 'CONFIRM_CUT', actor: 'lee', windowId: w, source: { kind: 'roll', code: 'B-R001' }, checks: { id: true, series: true, dims: true } })),
      { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '1A', spotCheck: ['1A-S1-2'] },
      { type: 'APPROVE_BUNDLE', actor: 'ravi', roomId: '1B' },
      { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-1A-1' },
      { type: 'DISPATCH_BUNDLE', actor: 'ravi', bundleId: 'B-1B-1' },
      { type: 'ASSIGN_TEAM', actor: 'ravi', members: ['jay', 'lee'] },
      { type: 'SET_TARGETS', actor: 'ravi', manpower: 2, days: 2 },
    ],
  };
  const z1Install = () => {
    const list = [{ type: 'CHECK_IN', actor: 'jay' }, { type: 'CHECK_IN', actor: 'lee' }];
    const jay = ['1A-W1-1', '1A-W1-2', '1A-W1-3', '1A-S1-1', '1A-S1-2']; const lee = ['1A-S1-3', '1A-S1-4', '1B-W1-1', '1B-W1-2'];
    jay.forEach((w) => list.push({ type: 'CLAIM_PANEL', actor: 'jay', windowId: w }, { type: 'MARK_INSTALLED', actor: 'jay', windowId: w }));
    lee.forEach((w) => list.push({ type: 'CLAIM_PANEL', actor: 'lee', windowId: w }, { type: 'MARK_INSTALLED', actor: 'lee', windowId: w }));
    list.push({ type: 'ADD_ZONE_PHOTO', actor: 'jay', roomId: '1A', label: 'Living done (placeholder)' }, { type: 'ADD_ZONE_PHOTO', actor: 'lee', roomId: '1B', label: 'Dining done (placeholder)' },
      { type: 'CONFIRM_ZONE', actor: 'jay', zoneId: 'Z1' }, { type: 'CONFIRM_ZONE', actor: 'lee', zoneId: 'Z1' }, { type: 'APPROVE_ZONE', actor: 'ravi', zoneId: 'Z1' });
    return list;
  };
  const PRESETS = {
    fresh: { label: 'Quote draft', actions: () => [] },
    signed: { label: 'Signed · awaiting deposit', actions: () => SCRIPTS.signed },
    deposit: { label: 'Deposit verified', actions: () => SCRIPTS.signed.concat(SCRIPTS.deposit) },
    onsite: { label: 'Zone 1 on site', actions: () => SCRIPTS.signed.concat(SCRIPTS.deposit, SCRIPTS.cutZ1) },
    z1done: { label: 'Zone 1 approved · progress due', actions: () => SCRIPTS.signed.concat(SCRIPTS.deposit, SCRIPTS.cutZ1, z1Install()) },
  };
  function preset(name) {
    const p = PRESETS[name]; if (!p) throw new Error('Unknown preset');
    const r = run(createDemo(), p.actions());
    if (!r.ok) throw new Error('Preset failed: ' + r.error);
    return r.state;
  }

  const api = {
    USERS, ROLE_LABEL, SERIES, ISSUE_KIND, PERM, PRESETS,
    createDemo, apply, run, preset, SCRIPTS,
    rectSqft, panelSqft, round2, allPanels, quoteSqft, pieceStatus, gate, received, milestoneStatus, zoneStatus, involved,
    roomsMissingPhoto, suggestSources, leftoverFits, rollUse, totalSqft, installedSqft, handoverChecks, projectStatus,
    cancellationSummary, productivity, isPaused, userName, findPanel,
  };
  root.BuildingLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
