/* AutoDream Garage · Building tint trial UI. Renders window.BuildingLogic state; every change goes through BuildingLogic.apply.
   Local prototype: fictional data, localStorage only, no backend. */
(function () {
  'use strict';
  const BL = window.BuildingLogic;
  const KEY = 'autodream-building-review-v3';
  const openPanels={};
  const LABELS={Overview:'Now',Quote:'Windows',Agreement:'Agreement',Payments:'Payments',Cutting:'Cutting',Install:'Install',Stock:'Stock',Issues:'Issues',Handover:'Handover',Activity:'History'};
  const PRIMARY={salesman:['Quote','Agreement'],finance:['Payments','Activity'],director:['Payments','Issues'],head:['Cutting','Install'],installer:['Install','Cutting']};
  const TABS = ['Overview', 'Quote', 'Agreement', 'Payments', 'Cutting', 'Install', 'Stock', 'Issues', 'Handover', 'Activity'];
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '');
  const who = (id) => BL.userName(id);

  let S = BL.createDemo(); let actor = 'alex'; let tab = 'Overview'; let ui = { room: '1A', asm: null, pin: null };
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.v === 1 && c.state && c.state.schema === 1) { S = c.state; actor = BL.USERS[c.actor] ? c.actor : 'alex'; tab = TABS.includes(c.tab) ? c.tab : 'Overview'; }
  } catch (e) { /* ignore broken cache */ }
  if(new URLSearchParams(location.search).get('view')==='overview')tab='Overview';
  const save = () => localStorage.setItem(KEY, JSON.stringify({ v: 1, state: S, actor, tab }));

  const role = () => BL.USERS[actor].role;
  const can = (type) => BL.PERM[type].includes(role()) && (role() !== 'salesman' || actor === S.project.salesman) && (!['HANDOVER_SIGN','CUSTOMER_ACK','CASH_RECEIVED'].includes(type) || role() !== 'installer' || (S.delegation && S.delegation.installer === actor));
  /* Demo clock never runs behind the last recorded event (presets are stamped in the future). */
  const clock = () => Math.max(Date.now(), (S.audit[0] ? Date.parse(S.audit[0].at) : 0) + 60000);

  function say(text, err) { const m = $('message'); m.textContent = text; m.className = err ? 'err' : ''; }
  function act(action) {
    const r = BL.apply(S, Object.assign({ actor }, action), clock());
    if (!r.ok) { say(r.error, true); return false; }
    S = r.state; save(); say('Done · ' + (S.audit[0] ? S.audit[0].text : action.type)); render(); return true;
  }

  /* ---------- small builders ---------- */
  const B = (label, type, p, cls) => `<button class="${cls || ''}" data-a="${type}" data-p="${esc(JSON.stringify(p || {}))}" ${can(type) ? '' : 'disabled title="' + esc(BL.PERM[type].map((r) => BL.ROLE_LABEL[r]).join(' / ')) + ' only"'}>${label}</button>`;
  const pill = (t, k) => `<span class="pill ${k || ''}">${esc(t)}</span>`;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(l)}</option>`;
  const inp = (name, val, extra) => `<input name="${name}" value="${esc(val == null ? '' : val)}" ${extra || ''}>`;
  const chg = (type, p, name, val, extra) => `<input data-c="${type}" data-p="${esc(JSON.stringify(p))}" name="${name}" value="${esc(val)}" ${can(type) && !S.agreement ? '' : 'disabled'} ${extra || ''}>`;
  const zoneChecks = (name, sel, dis) => S.zones.map((z) => `<label class="check"><input type="checkbox" name="${name}" data-multi value="${z.id}" ${sel.includes(z.id) ? 'checked' : ''} ${dis ? 'disabled' : ''}>${z.id}</label>`).join('');
  const sigPad = (name) => `<label>Customer signature · on this device<canvas class="sig" name="${name}" width="700" height="170"></canvas></label><button type="button" class="ghost" data-clear>Clear</button>`;

  const PIECE = { to_cut: ['To cut', ''], reserved: ['Reserved', 'warn'], cut: ['Cut', 'warn'], bundled: ['Bundled', 'warn'], on_site: ['On site', 'warn'], installing: ['Installing', 'warn'], installed: ['Installed', 'ok'], issue: ['Issue', 'bad'] };
  const ZONE = { quote: ['Quote', ''], locked: ['Locked', 'bad'], open: ['Open', 'warn'], in_progress: ['In progress', 'warn'], confirming: ['Team confirming', 'warn'], pending_inspection: ['Head review', 'warn'], photos_requested: ['Photos requested', 'bad'], approved: ['Approved', 'ok'] };
  const MS = { scheduled: ['Scheduled', ''], due: ['Due', 'warn'], requested: ['Requested', 'warn'], partial: ['Part received', 'warn'], received: ['Received · verify', 'warn'], verified: ['Verified', 'ok'] };
  const PROJ = { quote: 'Quotation', awaiting_deposit: 'Awaiting deposit', in_progress: 'In progress', ready_handover: 'Ready for handover', conditional: 'Conditional handover', completed: 'Completed', cancel_review: 'Cancellation review', cancelled: 'Cancelled' };
  const pp = (p) => { const s = BL.pieceStatus(p); return pill(PIECE[s][0], PIECE[s][1]); };
  const trigText = (t) => t.type === 'signing' ? 'On signing' : t.type === 'zones_approved' ? 'When ' + (t.zones || []).join(' + ') + ' approved' : t.type === 'progress' ? 'At ' + t.pct + '% installed' : 'On ' + (t.date || '—');
  const unlockText = (u) => [u.cutting ? 'cutting' : '', (u.zones || []).length ? 'install ' + u.zones.join(', ') : '', u.handover ? 'handover' : ''].filter(Boolean).join(' · ') || '—';
  const pieces = () => Object.values(S.pieces);
  const roomName = (id) => { const r = S.rooms.find((x) => x.id === id); return r ? r.id + ' · ' + r.name : id; };

  /* ---------- Quote ---------- */
  function planSvg(room) {
    const W = room.w, D = room.d, m = 30, asms = S.assemblies.filter((a) => a.roomId === room.id);
    const pt = (a) => { const len = Math.min(a.wall === 'N' || a.wall === 'S' ? W : D, a.panels.reduce((t, p) => t + p.w, 0));
      if (a.wall === 'N' || a.wall === 'S') { const x = m + a.pos * W, y = a.wall === 'N' ? m : m + D; return [x - len / 2, y, x + len / 2, y, x, y + (a.wall === 'N' ? -10 : 18)]; }
      const y = m + a.pos * D, x = a.wall === 'W' ? m : m + W; return [x, y - len / 2, x, y + len / 2, x + (a.wall === 'W' ? -6 : 6), y]; };
    const marks = asms.map((a) => { const [x1, y1, x2, y2, tx, ty] = pt(a); const sel = ui.asm === a.id;
      return `<g data-asm="${a.id}" style="cursor:pointer"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${sel ? '#fff' : '#D4A017'}" stroke-width="${sel ? 8 : 6}"/><text x="${tx}" y="${ty}" fill="#efd17d" font-size="11" text-anchor="${a.wall === 'W' ? 'end' : a.wall === 'E' ? 'start' : 'middle'}">${esc(a.id)}</text></g>`; }).join('');
    return `<svg class="plan" id="plan" viewBox="0 0 ${W + m * 2} ${D + m * 2}" data-w="${W}" data-d="${D}" data-m="${m}"><rect x="${m}" y="${m}" width="${W}" height="${D}" fill="#ffffff06" stroke="#ffffff70" stroke-width="2"/>
      <text x="${m + W / 2}" y="${m + D / 2}" fill="#b7b4ae" font-size="13" text-anchor="middle">${esc(room.name)}</text>
      <text x="${m + W / 2}" y="${m + D + 25}" fill="#8f8b84" font-size="10" text-anchor="middle">${W} in</text>
      <text x="${m + W + 4}" y="${m + D / 2 + 14}" fill="#8f8b84" font-size="10">${D} in</text>${marks}</svg>`;
  }

  function quoteTab() {
    const locked = !!S.agreement; const room = S.rooms.find((r) => r.id === ui.room) || S.rooms[0];
    if (room) ui.room = room.id;
    const rooms = S.floors.map((f) => `<div class="muted" style="margin-top:8px">${esc(f.name)}</div><div class="row">${S.rooms.filter((r) => r.floorId === f.id).map((r) => `<button class="${r.id === ui.room ? '' : 'ghost'}" data-room="${r.id}">${esc(r.id)} · ${esc(r.name)} <small>${BL.quoteSqft(S, (x) => x.room && x.room.id === r.id)} sqft</small></button>`).join('') || '<span class="muted">No rooms</span>'}</div>`).join('');
    const asmCards = room ? S.assemblies.filter((a) => a.roomId === room.id).map((a) => `<div class="card ${ui.asm === a.id ? 'sel' : ''}">
      <div class="row" style="justify-content:space-between"><strong>${esc(a.id)} · ${esc(a.label)}</strong><span class="muted">${esc(BL.SERIES[a.series])} · wall ${a.wall} · ${a.panels.length} panel(s)</span></div>
      <div class="row" style="margin-top:8px"><label>Label${chg('UPDATE_ASSEMBLY', { assemblyId: a.id }, 'label', a.label)}</label>
      <label>Series<select data-c="UPDATE_ASSEMBLY" data-p="${esc(JSON.stringify({ assemblyId: a.id }))}" name="series" ${locked ? 'disabled' : ''}>${Object.keys(BL.SERIES).map((k) => opt(k, BL.SERIES[k], k === a.series)).join('')}</select></label>
      <label>Wall<select data-c="UPDATE_ASSEMBLY" data-p="${esc(JSON.stringify({ assemblyId: a.id }))}" name="wall" ${locked ? 'disabled' : ''}>${['N', 'E', 'S', 'W'].map((w) => opt(w, w, w === a.wall)).join('')}</select></label>
      <label>Position %${chg('UPDATE_ASSEMBLY', { assemblyId: a.id }, 'pos', Math.round(a.pos * 100), 'type="number" class="n" min="5" max="95" data-pct')}</label></div>
      <table style="margin-top:8px"><tr><th>Panel</th><th>W in</th><th>H in</th><th>Sqft</th>${a.kind === 'custom' ? '<th>Verified sqft · photo · note</th>' : ''}<th></th></tr>${a.panels.map((p) => `<tr><td>${esc(p.id)}</td>
        <td>${chg('UPDATE_PANEL', { panelId: p.id }, 'w', p.w, 'type="number" class="n" step="0.125" min="0"')}</td><td>${chg('UPDATE_PANEL', { panelId: p.id }, 'h', p.h, 'type="number" class="n" step="0.125" min="0"')}</td>
        <td>${BL.round2(BL.panelSqft(p))}</td>${a.kind === 'custom' ? `<td class="row">${chg('UPDATE_PANEL', { panelId: p.id }, 'verifiedSqft', p.verifiedSqft || 0, 'type="number" class="n" step="0.1"')}${chg('UPDATE_PANEL', { panelId: p.id }, 'photo', p.photo || '', 'placeholder="Reference photo (demo)"')}${chg('UPDATE_PANEL', { panelId: p.id }, 'note', p.note || '', 'placeholder="Shape note"')}</td>` : ''}
        <td>${locked ? '' : B('×', 'REMOVE_PANEL', { panelId: p.id }, 'ghost')}</td></tr>`).join('')}</table>
      ${locked ? '' : `<div class="actions">${B('+ Panel', 'ADD_PANEL', { assemblyId: a.id }, 'ghost')}<button class="ghost" data-sel="${a.id}">Place on plan</button>${B('Remove', 'REMOVE_ASSEMBLY', { assemblyId: a.id }, 'danger')}</div>`}</div>`).join('') : '';
    /* Unchecked count only when the version recorded it; older versions say Unknown rather than guess. */
    const unchecked = (v) => { const m = v.measurement; return m && Number.isFinite(m.approx) && Number.isFinite(m.unknown) ? (m.approx + m.unknown) + ' unchecked' : 'Unchecked: unknown'; };
    const versions = S.quote.versions.map((v) => `<div class="stat"><span>v${v.v} · ${esc(v.note || '—')} · ${who(v.by)}</span><span>${v.sqft} sqft · ${v.panels} panels · ${unchecked(v)} · ${when(v.at)}</span></div>`).join('') || '<p class="muted">No saved version yet.</p>';
    const source = S.context && S.context.source === 'sketch' ? `<p class="muted">Loaded from the building sketch · ${when(S.context.handedOffAt)}</p>` : '';
    const ms = S.milestones.map((m) => `<div class="card" data-ms="${m.id}"><div class="row">
      <label>Label<input data-mk name="label" value="${esc(m.label)}" ${locked ? 'disabled' : ''}></label><label>Amount (RM)<input data-mk name="amount" type="number" class="n" min="0" value="${m.amount}" ${locked ? 'disabled' : ''}></label>
      <label>Trigger<select data-mk name="ttype" ${locked ? 'disabled' : ''}>${[['signing', 'On signing'], ['zones_approved', 'Zones approved'], ['progress', 'Progress %'], ['date', 'Date']].map(([v, l]) => opt(v, l, m.trigger.type === v)).join('')}</select></label>
      ${m.trigger.type === 'zones_approved' ? `<div><div class="label">Trigger zones</div><div class="row">${zoneChecks('tzones', m.trigger.zones || [], locked).replace(/<input /g, '<input data-mk ')}</div></div>` : ''}
      ${m.trigger.type === 'progress' ? `<label>%<input data-mk name="pct" type="number" class="n" min="1" max="100" value="${esc(m.trigger.pct || '')}" ${locked ? 'disabled' : ''}></label>` : ''}
      ${m.trigger.type === 'date' ? `<label>Date<input data-mk name="date" type="date" value="${esc(m.trigger.date || '')}" ${locked ? 'disabled' : ''}></label>` : ''}</div>
      <div class="row" style="margin-top:8px"><span class="label">Unlocks</span><label class="check"><input data-mk type="checkbox" name="ucut" ${m.unlocks.cutting ? 'checked' : ''} ${locked ? 'disabled' : ''}>Cutting</label>${zoneChecks('uzones', m.unlocks.zones || [], locked).replace(/<input /g, '<input data-mk ')}<label class="check"><input data-mk type="checkbox" name="uhand" ${m.unlocks.handover ? 'checked' : ''} ${locked ? 'disabled' : ''}>Handover</label>
      ${locked ? '' : B('Remove', 'REMOVE_MILESTONE', { id: m.id }, 'ghost')}</div></div>`).join('');
    const total = S.milestones.reduce((t, m) => t + Number(m.amount || 0), 0);
    return `<section class="panel box"><h3>Rooms</h3>${source}${locked ? '<div class="notice">Agreement signed · quote is locked. Use Issues → amendment for size changes.</div>' : ''}${rooms}
      ${locked ? '' : `<div class="actions">${B('+ Floor', 'ADD_FLOOR', {}, 'ghost')}${B('+ Zone', 'ADD_ZONE', {}, 'ghost')}</div>
      <div class="card" data-form style="margin-top:12px"><div class="row"><label>Floor<select name="floorId">${S.floors.map((f) => opt(f.id, f.name)).join('')}</select></label><label>Zone<select name="zoneId">${S.zones.map((z) => opt(z.id, z.name)).join('')}</select></label>
      <label>Name${inp('name', '', 'placeholder="Study"')}</label><label>Width in${inp('w', 180, 'type="number" class="n"')}</label><label>Depth in${inp('d', 150, 'type="number" class="n"')}</label>${B('Add room', 'ADD_ROOM')}</div></div>`}</section>
      ${room ? `<section class="panel box"><div class="row" style="justify-content:space-between"><h3>${esc(room.id)} · ${esc(room.name)} · 2D plan</h3>${locked ? '' : B('Remove room', 'REMOVE_ROOM', { roomId: room.id }, 'danger')}</div>
      <div class="row" style="margin:6px 0 12px"><label>Name${chg('UPDATE_ROOM', { roomId: room.id }, 'name', room.name)}</label><label>Width in${chg('UPDATE_ROOM', { roomId: room.id }, 'w', room.w, 'type="number" class="n"')}</label><label>Depth in${chg('UPDATE_ROOM', { roomId: room.id }, 'd', room.d, 'type="number" class="n"')}</label>
      <label>Zone<select data-c="UPDATE_ROOM" data-p="${esc(JSON.stringify({ roomId: room.id }))}" name="zoneId" ${locked ? 'disabled' : ''}>${S.zones.map((z) => opt(z.id, z.name, z.id === room.zoneId)).join('')}</select></label></div>
      ${planSvg(room)}<p class="muted">${ui.asm ? 'Click a wall to place ' + esc(ui.asm) + '.' : 'Select a window, then click a wall to place it.'} Sizes are measured dimensions used as entered · no allowance added.</p>
      ${asmCards}
      ${locked ? '' : `<div class="card" data-form><div class="row"><label>Type<select name="kind">${opt('window', 'Window')}${opt('sliding', 'Sliding door')}${opt('custom', 'Custom glass')}</select></label><label>Label${inp('label', '', 'placeholder="Window"')}</label>
      <label>Series<select name="series">${Object.keys(BL.SERIES).map((k) => opt(k, BL.SERIES[k])).join('')}</select></label><label>Wall<select name="wall">${['N', 'E', 'S', 'W'].map((w) => opt(w, w)).join('')}</select></label>
      <label>Panels${inp('count', 2, 'type="number" class="n" min="1" max="24"')}</label><label>W in${inp('w', 24, 'type="number" class="n" step="0.125"')}</label><label>H in${inp('h', 60, 'type="number" class="n" step="0.125"')}</label>${B('Add window', 'ADD_ASSEMBLY', { roomId: room.id })}</div></div>`}</section>` : ''}
      <section class="panel box"><h3>Quote · ${BL.quoteSqft(S)} sqft</h3>${versions}${locked ? '' : `<div class="row" data-form style="margin-top:10px"><label>Version note${inp('note', '', 'placeholder="Site visit 1"')}</label>${B('Save version', 'SAVE_VERSION')}${S.quote.dirty ? pill('Unsaved changes', 'warn') : ''}</div>`}</section>
      <section class="panel box"><h3>Payment schedule · ${rm(total)}</h3><p class="muted">Each milestone says what it unlocks. One must unlock cutting (deposit).</p>${ms}${locked ? '' : `<div class="actions">${B('+ Milestone', 'ADD_MILESTONE', {}, 'ghost')}</div>`}</section>`;
  }

  /* ---------- Agreement ---------- */
  /* Information only: signing is not blocked. Shown when the panes carry measurement flags (sketch data). */
  function measureWarning() {
    const panes = BL.allPanels(S).map((x) => x.panel);
    if (!(S.context && S.context.source === 'sketch') && !panes.some((p) => 'measured' in p)) return '';
    const approx = panes.filter((p) => p.measured === false).length, unknown = panes.filter((p) => p.measured !== true && p.measured !== false).length;
    return approx + unknown ? `<div class="notice">${approx + unknown} of ${panes.length} panes are not marked as measurement-checked${approx ? ' (' + approx + ' approximate)' : ''}. Review sizes before signing.</div>` : '';
  }
  function agreementTab() {
    const pin = ui.pin || S.project.pin; const ag = S.agreement;
    const pinBox = `<section class="panel box" data-form><h3>Site pin ${S.project.pin.confirmed ? pill('Confirmed', 'ok') : pill('Not confirmed', 'warn')}</h3>
      <div class="map" id="map"><i style="left:${pin.x * 100}%;top:${pin.y * 100}%"></i></div><p class="muted">Fictional map · click to move pin. Used for approximate site presence only.</p>
      <div class="row"><label style="flex:1">Site address${inp('address', S.project.address)}</label>${B('Confirm pin', 'CONFIRM_PIN', { x: pin.x, y: pin.y })}</div></section>`;
    if (ag) return pinBox + `<section class="panel box"><h3>Agreement signed ${pill(S.project.mwo, 'ok')}</h3>
      <div class="stat"><span>Signer</span><span>${esc(ag.signer)}${ag.signerTitle ? ' · ' + esc(ag.signerTitle) : ''}</span></div><div class="stat"><span>Signed</span><span>${when(ag.signedAt)} · ${esc(ag.method)} · ${who(ag.collectedBy)}</span></div>
      <div class="stat"><span>Quote</span><span>v${ag.quoteVersion} · ${ag.totalSqft} sqft</span></div>${ag.milestones.map((m) => `<div class="stat"><span>${esc(m.label)} · ${rm(m.amount)}</span><span class="muted">${esc(trigText(m.trigger))} → ${esc(unlockText(m.unlocks))}</span></div>`).join('')}
      ${ag.signature.startsWith('data:image/png;base64,iVBOR') ? `<img class="sig" src="${esc(ag.signature)}" alt="Customer signature">` : '<p class="muted">Signature recorded (preset placeholder).</p>'}</section>`;
    return pinBox + `<section class="panel box" data-form><h3>Customer agreement · in person</h3>
      <div class="stat"><span>Customer</span><span>${esc(S.project.customer)}</span></div><div class="stat"><span>Scope</span><span>${S.rooms.length} rooms · ${BL.allPanels(S).length} panels · ${BL.quoteSqft(S)} sqft</span></div>
      ${S.milestones.map((m) => `<div class="stat"><span>${esc(m.label)} · ${rm(m.amount)}</span><span class="muted">${esc(trigText(m.trigger))} → ${esc(unlockText(m.unlocks))}</span></div>`).join('')}
      ${measureWarning()}<div class="notice">No cutting until the deposit is received and verified by Finance. Measurements as signed; changes need Director approval.</div>
      <div class="grid2"><label>Signer name${inp('signer', S.project.contact)}</label><label>Title${inp('signerTitle', '', 'placeholder="Director"')}</label></div>
      ${sigPad('signature')}<label class="check"><input type="checkbox" name="accept">Customer read and accepts the agreement</label>
      <div class="actions">${B('Sign agreement · demo', 'SIGN_AGREEMENT')}</div><p class="muted">Signing saves the quote version, creates the job number and window IDs.</p></section>`;
  }

  /* ---------- Payments ---------- */
  function gateTable() {
    return `<table><tr><th>Zone</th><th>Cutting</th><th>Install</th></tr>${S.zones.map((z) => { const c = BL.gate(S, z.id, 'cutting'), i = BL.gate(S, z.id, 'install');
      const g = (x) => x.open ? pill(x.viaException.length ? 'Open · exception' : 'Open', x.viaException.length ? 'warn' : 'ok') : pill(x.reason, 'bad');
      return `<tr><td>${z.id}</td><td>${g(c)}</td><td>${g(i)}</td></tr>`; }).join('')}</table>`;
  }
  function paymentsTab() {
    if (!S.agreement) return '<section class="panel box"><h3>Payments</h3><p class="muted">Payments start after the agreement is signed.</p></section>';
    const cards = S.milestones.map((m) => { const st = BL.milestoneStatus(m); const got = BL.received(m);
      const draft = `Hi ${S.project.contact}, ${m.label} of ${rm(m.amount)} for ${S.project.mwo} (${S.project.title}) is now due. Outstanding: ${rm(m.amount - got)}. Bank: Demo Bank 000-0000000 (fictional). Thank you · ${who(S.project.salesman)}, AutoDream Garage`;
      return `<div class="card"><div class="row" style="justify-content:space-between"><strong>${esc(m.label)} · ${rm(m.amount)}</strong>${pill(MS[st][0], MS[st][1])}</div>
      <p class="muted">${esc(trigText(m.trigger))} → unlocks ${esc(unlockText(m.unlocks))}<br>Received ${rm(got)} of ${rm(m.amount)}${m.dueAt ? ' · due since ' + when(m.dueAt) : ''}${m.requestSentAt ? ' · request sent ' + when(m.requestSentAt) : ''}</p>
      ${m.receipts.map((r) => `<div class="stat"><span>${rm(r.amount)} · ref ${esc(r.ref || '—')}</span><span class="muted">${who(r.by)} · ${when(r.at)}</span></div>`).join('')}
      ${m.verified ? `<p class="muted">Verified by ${who(m.verified.by)} · ${when(m.verified.at)}</p>` : `
      ${m.dueAt && !m.requestSentAt ? `<label>WhatsApp draft · not sent by app<textarea rows="3" readonly>${esc(draft)}</textarea></label><div class="actions"><button class="ghost" data-copy="${esc(draft)}">Copy draft</button>${B('Mark sent (outside app)', 'MARK_REQUEST_SENT', { id: m.id })}</div>` : ''}
      <div class="row" data-form style="margin-top:10px"><label>Amount received${inp('amount', BL.round2(m.amount - got), 'type="number" class="n" min="0"')}</label><label>Bank / receipt ref${inp('ref', '', 'placeholder="DEMO-TRX-2"')}</label>${B('Record receipt', 'RECORD_RECEIPT', { id: m.id })}${B('Verify funds received', 'VERIFY_MILESTONE', { id: m.id })}</div>`}</div>`; }).join('');
    const unverified = S.milestones.filter((m) => !m.verified);
    return `<section class="panel box"><h3>Milestones</h3><p class="muted">Finance records the actual amount received, then verifies. Only verified funds open gates.</p>${cards}</section>
      <section class="panel box"><h3>Work status</h3>${gateTable()}</section>
      <section class="panel box" data-form><h3>Director exception</h3><p class="muted">Opens a gate for named zones while money is outstanding. Recorded with reason.</p>
      ${unverified.length ? `<div class="row"><label>Milestone<select name="id">${unverified.map((m) => opt(m.id, m.label)).join('')}</select></label><label>Scope<select name="scope">${opt('install', 'Install')}${opt('cutting', 'Cutting')}</select></label><div class="row">${zoneChecks('zones', [])}</div></div>
      <label>Reason${inp('reason', '', 'placeholder="Customer is long-term client; balance promised Friday"')}</label><div class="actions">${B('Grant exception', 'DIRECTOR_EXCEPTION')}</div>` : '<p class="muted">All milestones verified.</p>'}
      ${S.exceptions.map((e) => `<div class="notice">${esc(e.id)} · ${esc(e.label)} · ${e.scope} · ${e.zones.join(', ')} · ${rm(e.outstanding)} outstanding<br><span class="muted">${esc(e.reason)} · ${who(e.by)} · ${when(e.at)}</span></div>`).join('')}</section>`;
  }

  /* ---------- Cutting ---------- */
  function cutRow(p) {
    const st = BL.pieceStatus(p); const checks = `<label class="check"><input type="checkbox" name="checks.id">ID</label><label class="check"><input type="checkbox" name="checks.series">Series</label><label class="check"><input type="checkbox" name="checks.dims">Size</label>`;
    let body = '';
    if (st === 'to_cut') {
      const sug = BL.suggestSources(S, p.windowId);
      body = (sug.length ? sug.map((x, i) => `<div class="row" data-form style="margin-top:6px"><span class="muted" style="min-width:230px">${i === 0 ? '★ ' : ''}${esc(x.label)}${x.kind === 'leftover' ? ' · spare ' + x.spare + ' sqft' : ' · uses ' + x.use + ' in'}</span>
        ${x.kind === 'leftover' ? B('Reserve', 'RESERVE_LEFTOVER', { windowId: p.windowId, code: x.code }, 'ghost') : checks + B('Cut from roll', 'CONFIRM_CUT', { windowId: p.windowId, source: { kind: 'roll', code: x.code } })}</div>`).join('') : '<p class="muted">No fitting stock · register a roll.</p>')
        + (sug.length ? `<div class="row" style="margin-top:6px"><label>Head plan<select data-c2="PLAN_SOURCE" data-p="${esc(JSON.stringify({ windowId: p.windowId }))}" name="code" ${can('PLAN_SOURCE') ? '' : 'disabled'}>${opt('', '—', !p.plan)}${sug.map((x) => opt(x.code, x.code, p.plan && p.plan.code === x.code)).join('')}</select></label></div>` : '');
    } else if (st === 'reserved') {
      const others = pieces().filter((q) => q.windowId !== p.windowId && BL.pieceStatus(q) === 'to_cut' && q.series === p.series);
      body = `<div class="row" data-form style="margin-top:6px"><span class="muted">${esc(p.reservation.code)} reserved by ${who(p.reservation.by)}</span>${checks}${B('Cut from ' + esc(p.reservation.code), 'CONFIRM_CUT', { windowId: p.windowId, source: { kind: 'leftover', code: p.reservation.code } })}${B('Release', 'CANCEL_RESERVATION', { windowId: p.windowId }, 'ghost')}</div>
        ${others.length ? `<div class="row" data-form style="margin-top:6px"><label>Reassign to<select name="toWindowId">${others.map((q) => opt(q.windowId, q.windowId)).join('')}</select></label>${B('Reassign', 'REASSIGN_RESERVATION', { windowId: p.windowId }, 'ghost')}</div>` : ''}`;
    } else if (p.cut) body = `<span class="muted">Cut by ${who(p.cut.by)} · ${esc(p.cut.source.code)} · ${when(p.cut.at)}</span>`;
    return `<div class="card"><div class="row" style="justify-content:space-between"><strong>${esc(p.windowId)}${p.rev > 1 ? ' r' + p.rev : ''}</strong><span class="muted">${esc(BL.SERIES[p.series])} · ${p.w}×${p.h} in · ${p.area} sqft ${p.plan ? '· plan ' + esc(p.plan.code) : ''}</span>${pp(p)}</div>${body}</div>`;
  }
  function cuttingTab() {
    if (!S.agreement) return '<section class="panel box"><h3>Cutting</h3><p class="muted">Window IDs are created at signing.</p></section>';
    const byRoom = S.rooms.map((r) => { const ps = pieces().filter((p) => p.roomId === r.id); if (!ps.length) return '';
      const g = BL.gate(S, r.zoneId, 'cutting'); const ready = ps.filter((p) => !p.dispatched && !p.bundleId && !p.installed);
      return `<section class="panel box"><div class="row" style="justify-content:space-between"><h3>${esc(roomName(r.id))} · ${r.zoneId}</h3>${g.open ? pill('Cutting open', 'ok') : pill(g.reason, 'bad')}</div>
        ${ps.map(cutRow).join('')}
        ${ready.length ? `<div class="card" data-form><div class="row"><span class="label">Bundle approval · spot-check</span>${ready.map((p) => `<label class="check"><input type="checkbox" name="spotCheck" data-multi value="${p.windowId}">${esc(p.windowId)}</label>`).join('')}${B('Approve bundle', 'APPROVE_BUNDLE', { roomId: r.id })}</div></div>` : ''}</section>`; }).join('');
    const bundles = S.bundles.map((b) => `<div class="stat"><span>${esc(b.id)} · ${b.pieces.length} pcs · ${who(b.approvedBy)}${b.spotCheck.length ? ' · spot ' + b.spotCheck.join(', ') : ''}</span><span>${b.dispatchedAt ? pill('Dispatched ' + when(b.dispatchedAt), 'ok') : B('Dispatch', 'DISPATCH_BUNDLE', { bundleId: b.id })}</span></div>`).join('') || '<p class="muted">No bundles yet.</p>';
    return byRoom + `<section class="panel box"><h3>Delivery bundles</h3>${bundles}<p class="muted">Dispatch counts as received at site. Rooms can go out separately.</p></section>`;
  }

  /* ---------- Install ---------- */
  function installTab() {
    if (!S.agreement) return '<section class="panel box"><h3>Install</h3><p class="muted">Available after signing.</p></section>';
    const me = actor; const onSite = S.team.presence.some((r) => r.user === me && !r.out); const pr = BL.productivity(S, clock());
    const installers = Object.keys(BL.USERS).filter((u) => BL.USERS[u].role === 'installer');
    const team = `<section class="panel box"><h3>Site team</h3><div class="row" data-form>${installers.map((u) => `<label class="check"><input type="checkbox" name="members" data-multi value="${u}" ${S.team.members.includes(u) ? 'checked' : ''}>${who(u)}</label>`).join('')}${B('Assign team', 'ASSIGN_TEAM')}</div>
      <div class="row" data-form style="margin-top:10px"><label>Manpower${inp('manpower', S.team.targets ? S.team.targets.manpower : 2, 'type="number" class="n"')}</label><label>Days${inp('days', S.team.targets ? S.team.targets.days : 2, 'type="number" class="n"')}</label>${B('Set target', 'SET_TARGETS')}</div>
      <div class="actions">${onSite ? B('Leave site', 'CHECK_OUT') : B('Arrive on site', 'CHECK_IN')}</div>
      <div class="stat"><span>On site now</span><span>${pr.onSite.map(who).join(', ') || '—'}</span></div><div class="stat"><span>Installed</span><span>${pr.installed} / ${pr.total} sqft</span></div>
      ${pr.targets ? `<div class="stat"><span>Target pace</span><span>${BL.round2(pr.total / pr.targets.days)} sqft/day · day ${pr.elapsedDays} of ${pr.targets.days}</span></div>` : ''}
      ${Object.entries(pr.minutes).map(([u, m]) => `<div class="stat"><span>${who(u)} · on site</span><span>${Math.floor(m / 60)}h ${m % 60}m</span></div>`).join('')}
      <p class="muted">Approximate site presence against the pin · demo only. Not GPS tracking, punchcard or payroll.</p></section>`;
    const zones = S.zones.map((z) => { const zs = BL.zoneStatus(S, z.id); const g = BL.gate(S, z.id, 'install'); const ps = pieces().filter((p) => p.zoneId === z.id);
      const inv = BL.involved(S, z.id); const miss = BL.roomsMissingPhoto(S, z.id);
      const rows = ps.map((p) => { const st = BL.pieceStatus(p); let a = '';
        if (st === 'on_site') a = B('Claim', 'CLAIM_PANEL', { windowId: p.windowId });
        if (st === 'installing' && p.claim.by === me) a = B('Mark installed', 'MARK_INSTALLED', { windowId: p.windowId }) + B('Release', 'RELEASE_CLAIM', { windowId: p.windowId }, 'ghost');
        return `<tr><td>${esc(p.windowId)}${p.rev > 1 ? ' r' + p.rev : ''}</td><td>${p.w}×${p.h}</td><td>${pp(p)}</td><td class="muted">${p.claim ? who(p.claim.by) : p.installed ? who(p.installed.by) : ''}</td><td>${a}</td></tr>`; }).join('');
      const rooms = S.rooms.filter((r) => r.zoneId === z.id).map((r) => `<div class="row" data-form style="margin-top:6px"><span class="muted" style="min-width:150px">${esc(roomName(r.id))} · ${S.photos.filter((ph) => ph.roomId === r.id).length} photo(s)</span>${inp('label', '', 'placeholder="Completion photo (demo)"')}${B('Add photo', 'ADD_ZONE_PHOTO', { roomId: r.id }, 'ghost')}</div>`).join('');
      return `<section class="panel box"><div class="row" style="justify-content:space-between"><h3>${esc(z.name)}</h3>${pill(ZONE[zs][0], ZONE[zs][1])}</div>${g.open ? '' : `<div class="notice">Install locked · ${esc(g.reason)}</div>`}
        <table><tr><th>Window</th><th>Size</th><th>Status</th><th>By</th><th></th></tr>${rows}</table>${rooms}
        <div class="stat" style="margin-top:10px"><span>Team confirmations</span><span>${inv.map((u) => who(u) + (z.confirmations[u] ? ' ✓' : ' …')).join(' · ') || '—'}</span></div>
        ${miss.length ? `<p class="muted">Completion photo needed · ${miss.join(', ')}</p>` : ''}
        <div class="actions">${B('Confirm my work', 'CONFIRM_ZONE', { zoneId: z.id })}</div>
        ${z.inspection ? `<div class="card" data-form style="margin-top:10px"><strong>Head review</strong> ${pill(z.inspection.status, z.inspection.status === 'approved' ? 'ok' : 'warn')}${z.inspection.note ? '<p class="muted">' + esc(z.inspection.note) + '</p>' : ''}
          ${z.inspection.status === 'pending' ? `<div class="row" style="margin-top:8px">${B('Approve zone', 'APPROVE_ZONE', { zoneId: z.id })}<label>Note${inp('note', '', 'placeholder="Need close-up of 1A-S1"')}</label>${B('Request photos', 'REQUEST_PHOTOS', { zoneId: z.id }, 'ghost')}</div>` : ''}</div>` : ''}</section>`; }).join('');
    return team + zones;
  }

  /* ---------- Stock ---------- */
  function stockTab() {
    const st = S.stock; const LS = { available: 'ok', reserved: 'warn', consumed: '', held: 'bad' };
    return `<section class="panel box"><h3>Rolls</h3><table><tr><th>Code</th><th>Series</th><th>Width</th><th>Left</th></tr>${st.rolls.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(BL.SERIES[r.series])}</td><td>${r.width} in</td><td>${r.length} / ${r.original} in</td></tr>`).join('')}</table>
      <div class="row" data-form style="margin-top:10px"><label>Series<select name="series">${Object.keys(BL.SERIES).map((k) => opt(k, BL.SERIES[k])).join('')}</select></label><label>Width in${inp('width', 60, 'type="number" class="n"')}</label><label>Length in${inp('length', 600, 'type="number" class="n"')}</label>${B('Register roll', 'REGISTER_ROLL')}</div></section>
      <section class="panel box"><h3>Leftovers</h3><table><tr><th>Code</th><th>Size</th><th>Status</th><th></th></tr>${st.leftovers.map((l) => `<tr><td>${esc(l.code)}</td><td>${l.w}×${l.h} in</td><td>${pill(l.status, LS[l.status])} <span class="muted">${l.reservedFor ? esc(l.reservedFor) + ' · ' + who(l.reservedBy) : l.consumedFor ? esc(l.consumedFor) : ''}</span></td><td>${['available', 'reserved'].includes(l.status) ? `<details><summary class="muted" style="padding:0">Size wrong?</summary><div class="row" data-form><label>Actual W${inp('w', l.w, 'type="number" class="n"')}</label><label>H${inp('h', l.h, 'type="number" class="n"')}</label><label>Reason${inp('reason', '')}</label><label>Evidence${inp('evidence', '', 'placeholder="photo (demo)"')}</label>${B('Report mismatch', 'REPORT_STOCK_MISMATCH', { code: l.code }, 'ghost')}</div></details>` : ''}</td></tr>`).join('')}</table></section>
      <section class="panel box"><h3>Offcuts</h3><div class="row" data-form><label>From roll<select name="fromRoll">${st.rolls.map((r) => opt(r.code, r.code)).join('')}</select></label><label>W in${inp('w', '', 'type="number" class="n"')}</label><label>H in${inp('h', '', 'type="number" class="n"')}</label>${B('Report offcut', 'REPORT_OFFCUT')}</div>
      ${st.offcuts.map((o) => `<div class="stat"><span>${esc(o.id)} · ${o.w}×${o.h} · ${esc(o.fromRoll)} · ${who(o.by)}</span><span>${o.status === 'pending' ? B('Keep as leftover', 'CLASSIFY_OFFCUT', { id: o.id, decision: 'reusable' }) + ' ' + B('Wastage', 'CLASSIFY_OFFCUT', { id: o.id, decision: 'wastage' }, 'ghost') : pill(o.status + (o.code ? ' · ' + o.code : ''), o.status === 'reusable' ? 'ok' : '')}</span></div>`).join('')}</section>
      <section class="panel box"><h3>Stock mismatches</h3>${st.discrepancies.map((d) => `<div class="card" data-form><strong>${esc(d.id)} · ${esc(d.code)}</strong> ${pill(d.status)}<p class="muted">${d.original.w}×${d.original.h} → ${d.actual.w}×${d.actual.h} · ${esc(d.reason)} · ${esc(d.evidence)} · ${who(d.by)}</p>
        ${d.status === 'pending_head' ? B('Verify + adjust', 'VERIFY_STOCK_ADJUST', { id: d.id }) : d.directorReview ? `<p class="muted">Director: ${esc(d.directorReview.note)}</p>` : `<div class="row"><label>Director note${inp('note', '')}</label>${B('Review', 'DIRECTOR_REVIEW_DISCREPANCY', { id: d.id })}</div>`}</div>`).join('') || '<p class="muted">None.</p>'}</section>
      <section class="panel box"><h3>Wastage</h3>${S.agreement ? `<div class="row" data-form><label>Window<select name="windowId">${opt('', 'General')}${pieces().map((p) => opt(p.windowId, p.windowId)).join('')}</select></label><label>Sqft${inp('sqft', '', 'type="number" class="n" step="0.1"')}</label><label>Reason${inp('reason', '')}</label>${B('Log wastage', 'REPORT_WASTAGE')}</div>` : ''}
        ${S.wastage.map((w) => `<div class="row" data-form style="margin-top:8px"><span class="muted" style="min-width:240px">${esc(w.id)} · ${w.sqft} sqft · ${esc(w.reason)} · ${who(w.by)}</span>${w.review ? pill('Reviewed ' + w.review.from + ' → ' + w.review.to, 'ok') : `<label>Corrected${inp('correctedSqft', w.sqft, 'type="number" class="n" step="0.1"')}</label><label>Note${inp('note', '')}</label>${B('Review', 'REVIEW_WASTAGE', { id: w.id })}`}</div>`).join('')}</section>
      <section class="panel box"><h3>Stock ledger</h3>${st.ledger.map((l) => `<div class="stat"><span>${esc(l.kind)} · ${esc(l.windowId || l.ref || '')}${l.rev > 1 ? ' r' + l.rev : ''} · ${esc(l.source || '')}</span><span class="muted">${l.sqft} sqft · ${who(l.by)} · ${when(l.at)}</span></div>`).join('') || '<p class="muted">No movements yet.</p>'}</section>`;
  }

  /* ---------- Issues / amendments / cancellation ---------- */
  function issuesTab() {
    if (!S.agreement) return '<section class="panel box"><h3>Issues</h3><p class="muted">Available after signing.</p></section>';
    const ps = pieces(); const atSite = ps.filter((p) => p.dispatched && !p.issue); const open = ps.filter((p) => p.issue);
    const amendable = ps.filter((p) => ['to_cut', 'reserved'].includes(BL.pieceStatus(p)) || (p.issue && p.issue.status === 'needs_amendment'));
    const c = S.cancellation;
    return `<section class="panel box"><h3>Report window issue</h3>${atSite.length ? `<div class="row" data-form><label>Window<select name="windowId">${atSite.map((p) => opt(p.windowId, p.windowId)).join('')}</select></label><label>Type<select name="kind">${Object.keys(BL.ISSUE_KIND).map((k) => opt(k, BL.ISSUE_KIND[k])).join('')}</select></label><label>Note${inp('note', '')}</label><label>Evidence${inp('evidence', '', 'placeholder="photo (demo)"')}</label>${B('Report', 'REPORT_ISSUE')}</div>` : '<p class="muted">No dispatched windows.</p>'}
      ${open.map((p) => `<div class="card"><strong>${esc(p.windowId)}</strong> ${pill(BL.ISSUE_KIND[p.issue.kind], 'bad')} ${pill(p.issue.status === 'needs_amendment' ? 'Needs amendment' : 'Awaiting Head')}<p class="muted">${esc(p.issue.note)} · ${esc(p.issue.evidence)} · ${who(p.issue.by)} · ${when(p.issue.at)}</p>${B('Authorize replacement cut', 'AUTHORIZE_REPLACEMENT', { windowId: p.windowId })}</div>`).join('')}</section>
      <section class="panel box"><h3>Measurement amendments</h3><p class="muted">Before cutting, or after a measurement issue. Director approves. No customer charge in demo.</p>
      ${amendable.length ? `<div class="row" data-form><label>Window<select name="windowId">${amendable.map((p) => opt(p.windowId, p.windowId + ' · ' + p.w + '×' + p.h)).join('')}</select></label><label>W in${inp('w', '', 'type="number" class="n" step="0.125"')}</label><label>H in${inp('h', '', 'type="number" class="n" step="0.125"')}</label><label>Reason${inp('reason', '')}</label>${B('Request', 'REQUEST_AMENDMENT')}</div>` : ''}
      ${S.amendments.map((a) => `<div class="card" data-form><strong>${esc(a.id)} · ${esc(a.windowId)}</strong> ${pill(a.status, a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : 'warn')}<p class="muted">${a.original.w}×${a.original.h} → ${a.proposed.w}×${a.proposed.h} · ${esc(a.reason)}${a.note ? ' · ' + esc(a.note) : ''}</p>
        ${a.status === 'pending' ? `<div class="row">${B('Approve', 'APPROVE_AMENDMENT', { id: a.id })}<label>Note${inp('note', '')}</label>${B('Reject', 'REJECT_AMENDMENT', { id: a.id }, 'ghost')}</div>` : ''}</div>`).join('')}</section>
      <section class="panel box"><h3>Loss review</h3>${S.losses.map((l) => `<div class="card" data-form><strong>${esc(l.id)} · ${esc(l.windowId)} r${l.rev}</strong> ${pill(BL.ISSUE_KIND[l.kind])} <span class="muted">${l.sqft} sqft</span>
        ${l.headNote ? `<p class="muted">Head: ${esc(l.headNote)}</p>` : `<div class="row"><label>Findings${inp('note', '')}</label>${B('Save note', 'HEAD_LOSS_NOTE', { id: l.id })}</div>`}
        ${l.decision ? pill(l.decision.value === 'company_absorbs' ? 'Company absorbs' : 'Employee follow-up', 'ok') : l.headNote ? `<div class="row"><label>Decision<select name="decision">${opt('company_absorbs', 'Company absorbs')}${opt('employee_followup', 'Employee follow-up')}</select></label><label>Note${inp('note', '')}</label>${B('Decide', 'DIRECTOR_LOSS_DECISION', { id: l.id })}</div>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}<p class="muted">No payroll deduction in this demo.</p></section>
      <section class="panel box" data-form><h3>Cancellation</h3>${!c || c.status === 'withdrawn' ? `${c ? '<p class="muted">Previous request withdrawn.</p>' : ''}<label>Reason${inp('reason', '')}</label><div class="actions">${B('Request cancellation', 'REQUEST_CANCELLATION', {}, 'danger')}</div><p class="muted">Pauses new zones, cutting and reservations until the Director decides.</p>`
        : `${pill(c.status === 'review' ? 'In review' : 'Confirmed', 'bad')}<p class="muted">${esc(c.reason)} · ${who(c.by)} · ${when(c.at)}</p>
        <div class="stat"><span>Agreement</span><span>${esc(c.summary.agreement)}</span></div><div class="stat"><span>Cut</span><span>${c.summary.cutPieces} pcs · ${c.summary.cutSqft} sqft</span></div><div class="stat"><span>Installed</span><span>${c.summary.installedPieces} pcs · ${c.summary.installedSqft} sqft</span></div><div class="stat"><span>Reserved leftovers</span><span>${c.summary.reserved}</span></div><div class="stat"><span>Received</span><span>${rm(c.summary.receivedTotal)}</span></div>
        ${c.status === 'review' ? `<div class="row"><label>Review note${inp('note', '')}</label>${B('Withdraw · resume', 'DIRECTOR_CANCELLATION', { decision: 'withdraw' }, 'ghost')}${B('Confirm cancellation', 'DIRECTOR_CANCELLATION', { decision: 'confirm' }, 'danger')}</div>` : '<p class="muted">Settlement / charges are outside this demo (on hold).</p>'}`}</section>`;
  }

  /* ---------- Handover ---------- */
  function handoverTab() {
    const h = S.handover; const checks = BL.handoverChecks(S);
    const workers = [...new Set(S.zones.flatMap((z) => BL.involved(S, z.id)))];
    const delegate = '<section class="panel box"><h3>Handover team</h3><p class="muted">Accountable Salesman: ' + esc(who(S.project.salesman)) + (S.delegation ? ' · Delegated to ' + esc(who(S.delegation.installer)) : '') + '</p>' + (!h ? '<div class="row" data-form><label>Working installer<select name="installer">' + opt('', 'Salesman handles handover') + workers.map((id) => opt(id, who(id), S.delegation && S.delegation.installer === id)).join('') + '</select></label>' + B('Save delegation', 'DELEGATE_HANDOVER') + '</div>' : '') + '</section>';
    const cash = '<section class="panel box"><h3>Cash custody</h3>' + (!h ? '<div class="row" data-form><label>Amount (RM)' + inp('amount', '', 'type="number" min="0.01" step="0.01"') + '</label>' + B('Record demo receipt', 'CASH_RECEIVED') + '</div>' : '') + (S.cash || []).map((c) => '<div class="card" data-form><strong>' + esc(c.id) + ' · ' + rm(c.amount) + '</strong><p class="muted">Held by ' + esc(who(c.holder)) + ' · ' + esc(c.status) + '</p>' + (c.status !== 'with_salesman' ? '<label>Counted amount (RM)' + inp('amount', '', 'type="number" min="0"') + '</label>' + B('Alex received cash', 'ACK_CASH', {id:c.id}) : '') + '</div>').join('') + '<p class="muted">Installer keeps custody until original Salesman acknowledges. This does not verify payment. Reconciliation deadline is undecided.</p></section>';
    const custody = delegate + cash;
    const list = checks.map((c) => `<div class="stat"><span>${esc(c.label)}</span><span>${c.ok ? pill('✓', 'ok') : pill('—', 'bad')}</span></div>`).join('');
    const corr = S.corrections.map((c) => `<div class="row" data-form style="margin-top:6px"><span class="muted" style="min-width:220px">${esc(c.id)} · ${esc(c.text)}</span>${c.status === 'resolved' ? pill('Resolved · ' + c.note, 'ok') : `<label>Fix${inp('note', '')}</label>${B('Resolve', 'RESOLVE_CORRECTION', { id: c.id })}`}</div>`).join('');
    if (h) return custody + `<section class="panel box"><h3>Handover ${pill(h.status === 'completed' ? 'Completed' : 'Conditional', h.status === 'completed' ? 'ok' : 'warn')}</h3>
      <div class="stat"><span>Signer</span><span>${esc(h.signer)} · ${when(h.at)}</span></div><div class="stat"><span>Photo</span><span>${esc(h.photo)} · ${h.photoKind === 'site' ? 'site only' : 'with customer'}</span></div>
      ${h.signature.startsWith('data:image/png;base64,iVBOR') ? `<img class="sig" src="${esc(h.signature)}" alt="Signature">` : ''}${corr}
      ${h.status === 'conditional' ? `<div class="card" data-form style="margin-top:12px"><strong>Customer acknowledges corrections</strong><label>Signer${inp('signer', S.project.contact)}</label>${sigPad('signature')}<div class="actions">${B('Record acknowledgement', 'CUSTOMER_ACK')}</div></div>` : ''}
      <p class="muted">Warranty / HQ API is on hold · no warranty registered.</p></section>`;
    return custody + `<section class="panel box"><h3>Handover checks</h3>${list}</section><section class="panel box" data-form><h3>Customer handover</h3>
      <div class="grid2"><label>Delivery photo${inp('photo', '', 'placeholder="Handover photo (demo)"')}</label><label>Photo type<select name="photoKind">${opt('customer', 'With customer')}${opt('site', 'Site only · customer declined')}</select></label></div>
      <label>Signer${inp('signer', S.project.contact)}</label>${sigPad('signature')}
      <label>Open issues · one per line (makes it conditional)<textarea name="issues" data-lines rows="2"></textarea></label>
      <div class="actions">${B('Sign handover', 'HANDOVER_SIGN')}</div><p class="muted">Warranty / HQ API is on hold.</p></section>`;
  }

  function activityTab() {
    const mine = S.alerts.filter((a) => !a.done);
    return `<section class="panel box"><h3>Alerts</h3>${mine.map((a) => `<div class="log">${esc(a.msg)}<br><small>To ${who(a.to)} · ${when(a.at)}</small></div>`).join('') || '<p class="muted">No open alerts.</p>'}</section>
      <section class="panel box"><h3>Activity</h3>${S.audit.map((e) => `<div class="log">${esc(e.text)}<br><small>${e.by === 'system' ? 'System' : who(e.by) + ' · ' + BL.ROLE_LABEL[e.role]} · ${when(e.at)}</small></div>`).join('') || '<p class="muted">No activity yet.</p>'}</section>`;
  }

  function overviewTab() {
    const v=window.GarageOverview.build(BL,S,actor);
    const fold=(id,title,content)=>'<details class="simple-fold" data-fold="'+id+'" '+(openPanels[id]?'open':'')+'><summary>'+title+'</summary><div class="fold-body">'+content+'</div></details>';
    return '<section class="panel box next-step"><span class="muted">'+esc(who(actor))+'</span><h3>'+esc(v.next.title)+'</h3><p class="muted">'+esc(v.next.detail)+'</p><button data-tab="'+v.next.tab+'" data-focus="'+(v.next.tab==='Quote'?'windows':v.next.title.toLowerCase().includes('cash')?'cash':'')+'">Continue</button></section>'+
    fold('job','Job details','<div class="stat"><span>Cut</span><strong>'+v.cut+' / '+v.pieceCount+'</strong></div><div class="stat"><span>Installed</span><strong>'+v.installed+' / '+v.pieceCount+'</strong></div>'+v.zones.map(z=>'<div class="stat"><span>'+esc(z.name)+'</span>'+pill(ZONE[z.status][0],ZONE[z.status][1])+'</div><p class="muted">'+esc(z.cutting.open?'Cutting payment cleared':z.cutting.reason)+' · '+esc(z.install.open?'Install payment cleared':z.install.reason)+'</p>').join('')+S.milestones.map(m=>'<div class="stat"><span>'+esc(m.label)+'</span>'+pill(S.agreement?MS[BL.milestoneStatus(m)][0]:'Scheduled',S.agreement?MS[BL.milestoneStatus(m)][1]:'')+'</div>').join(''))+
    fold('updates','Your updates'+(v.mine.length?' ('+v.mine.length+')':''),v.mine.map(a=>'<div class="log">'+esc(a.msg)+'</div>').join('')||'<p class="muted">No updates.</p>');
  }

  /* ---------- shell ---------- */
  function render() {
    const views = { Overview: overviewTab, Quote: quoteTab, Agreement: agreementTab, Payments: paymentsTab, Cutting: cuttingTab, Install: installTab, Stock: stockTab, Issues: issuesTab, Handover: handoverTab, Activity: activityTab };
    $('actor').innerHTML = Object.keys(BL.USERS).map((u) => opt(u, who(u) + ' · ' + BL.ROLE_LABEL[BL.USERS[u].role], u === actor)).join('');
    $('app').innerHTML = `<section class="panel overview"><div class="heading"><div><div class="sub">${esc(S.project.id)} · Building tint</div><h2>${esc(S.project.title)}</h2><div class="sub">${esc(S.project.customer)}</div></div><span class="tag">${esc(PROJ[BL.projectStatus(S)])}</span></div></section>
      ${simpleNavigation()}
      <div class="columns"><div class="stack">${views[tab]()}</div></div>`;
    simplifySections();
    bind();
  }

  function simpleNavigation(){const main=['Overview',...(PRIMARY[role()]||[])],other=TABS.filter(t=>!main.includes(t));return '<nav class="simple-nav" aria-label="Job navigation">'+main.map(t=>'<button data-tab="'+t+'" aria-current="'+(tab===t)+'">'+LABELS[t]+'</button>').join('')+'<details class="nav-more" data-fold="more" '+(openPanels.more?'open':'')+'><summary>More'+(!main.includes(tab)?' · '+LABELS[tab]:'')+'</summary><div>'+other.map(t=>'<button data-tab="'+t+'" aria-current="'+(tab===t)+'">'+LABELS[t]+'</button>').join('')+'</div></details></nav>';}
  function simplifySections(){if(tab==='Overview')return;if(tab==='Quote'){const first=document.querySelector('#app .stack > section'),card=first?.querySelector(':scope > .card[data-form]');if(card){const d=document.createElement('details');d.className='simple-fold';d.dataset.fold='add-room';d.open=!!openPanels['add-room'];const title=document.createElement('summary');title.textContent='Add room';d.append(title);const actions=first.querySelector(':scope > .actions');if(actions)d.append(actions);card.before(d);d.append(card);}}const sections=[...document.querySelectorAll('#app .stack > section')];sections.forEach((section,index)=>{if(index===0||section.querySelector('canvas.sig'))return;const heading=section.querySelector(':scope > h3, :scope > .row > h3');if(!heading)return;const key=tab==='Quote'&&index===1?'Quote-windows':tab+'-'+heading.textContent.split('·')[0].trim(),details=document.createElement('details');details.className='simple-fold';details.dataset.fold=key;details.open=!!openPanels[key];const summary=document.createElement('summary');summary.textContent=heading.textContent;section.before(details);details.append(summary,section);heading.hidden=true;});}
  function collect(scope) {
    const out = {}; if (!scope) return out;
    scope.querySelectorAll('[name]').forEach((el) => {
      const n = el.getAttribute('name'); let v;
      if (el.tagName === 'CANVAS') v = el.dataset.drawn ? el.toDataURL('image/png') : '';
      else if (el.type === 'checkbox' && el.hasAttribute('data-multi')) { out[n] = out[n] || []; if (el.checked) out[n].push(el.value); return; }
      else if (el.type === 'checkbox') v = el.checked;
      else if (el.hasAttribute('data-lines')) v = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
      else v = el.value;
      const path = n.split('.'); let o = out; while (path.length > 1) { const k = path.shift(); o = o[k] = o[k] || {}; } o[path[0]] = v;
    });
    return out;
  }
  function msUpdate(card) {
    const f = collect(card); const t = { type: f.ttype };
    if (t.type === 'zones_approved') t.zones = f.tzones || []; if (t.type === 'progress') t.pct = Number(f.pct) || 50; if (t.type === 'date') t.date = f.date || '';
    act({ type: 'UPDATE_MILESTONE', id: card.dataset.ms, label: f.label, amount: f.amount, trigger: t, unlocks: { cutting: !!f.ucut, zones: f.uzones || [], handover: !!f.uhand } });
  }

  function bind() {
    document.querySelectorAll('[data-fold]').forEach(d=>d.ontoggle=()=>{openPanels[d.dataset.fold]=d.open;});
    document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab;if(b.dataset.focus==='windows')openPanels['Quote-windows']=true;if(b.dataset.focus==='cash')openPanels['Handover-Cash custody']=true;openPanels.more=false; save(); say(''); render(); }; });
    document.querySelectorAll('[data-room]').forEach((b) => { b.onclick = () => { ui.room = b.dataset.room; ui.asm = null; openPanels['Quote-windows']=true; render(); }; });
    document.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = () => { ui.asm = b.dataset.sel; render(); }; });
    document.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => act(Object.assign({ type: b.dataset.a }, collect(b.closest('[data-form]')), JSON.parse(b.dataset.p))); });
    document.querySelectorAll('[data-c],[data-c2]').forEach((el) => { el.onchange = () => {
      let v = el.value; if (el.hasAttribute('data-pct')) v = Number(v) / 100;
      act(Object.assign({ type: el.dataset.c || el.dataset.c2 }, JSON.parse(el.dataset.p), { [el.getAttribute('name')]: v })); }; });
    document.querySelectorAll('[data-ms]').forEach((card) => card.querySelectorAll('[data-mk]').forEach((el) => { el.onchange = () => msUpdate(card); }));
    document.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.copy) : Promise.reject()).then(() => say('Draft copied · send it yourself in WhatsApp'), () => say('Copy blocked · select the text manually', true)); }; });
    const plan = $('plan');
    if (plan) {
      plan.querySelectorAll('[data-asm]').forEach((g) => { g.onclick = (e) => { e.stopPropagation(); ui.asm = g.dataset.asm; render(); }; });
      plan.onclick = (e) => {
        if (!ui.asm || S.agreement) return;
        const p = plan.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(plan.getScreenCTM().inverse());
        const W = +plan.dataset.w, D = +plan.dataset.d, m = +plan.dataset.m; const x = q.x - m, y = q.y - m;
        const dist = { N: Math.abs(y), S: Math.abs(D - y), W: Math.abs(x), E: Math.abs(W - x) };
        const wall = Object.keys(dist).sort((a, b) => dist[a] - dist[b])[0];
        const pos = wall === 'N' || wall === 'S' ? x / W : y / D;
        act({ type: 'UPDATE_ASSEMBLY', assemblyId: ui.asm, wall, pos });
      };
    }
    const map = $('map');
    if (map) map.onclick = (e) => { const r = map.getBoundingClientRect(); ui.pin = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; render(); };
    document.querySelectorAll('canvas.sig').forEach((cv) => {
      const ctx = cv.getContext('2d'); ctx.strokeStyle = '#161616'; ctx.lineWidth = 2.5; let drawing = false;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
      cv.onpointerdown = (e) => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
      cv.onpointermove = (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); cv.dataset.drawn = '1'; };
      cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
      const clr = cv.parentElement.nextElementSibling; if (clr && clr.hasAttribute('data-clear')) clr.onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); delete cv.dataset.drawn; };
    });
  }

  $('preset').innerHTML = Object.keys(BL.PRESETS).map((k) => opt(k, BL.PRESETS[k].label)).join('');
  $('actor').onchange = () => { actor = $('actor').value; tab='Overview'; save(); say('Viewing as ' + who(actor)); render(); };
  $('load').onclick = () => { if (!window.confirm('Replace this local demo with the preset?')) return; S = BL.preset($('preset').value); ui = { room: '1A', asm: null, pin: null }; save(); say('Preset loaded · ' + BL.PRESETS[$('preset').value].label); render(); };
  $('reset').onclick = () => { if (!window.confirm('Reset this local demo only?')) return; S = BL.createDemo(); actor = 'alex'; tab = 'Overview'; ui = { room: '1A', asm: null, pin: null }; localStorage.removeItem(KEY); say('Demo reset.'); render(); };
  render();
})();
