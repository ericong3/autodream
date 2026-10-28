// Service-role data access for the Garage building bridge. Server only:
// the service-role key bypasses RLS, so it must never reach the browser.
// Tables/functions come from the prepared migrations
// 20261020000000_garage_building_projects.sql and
// 20261020010000_garage_building_online_sessions.sql.
// First-time setup also uses 20261020020000_garage_building_activation.sql.
import { createClient } from '@supabase/supabase-js';

const SESSION_COLUMNS = 'user_id, credential_fingerprint, expires_at, last_seen_at';

let cached = null;

export function supabaseRepo(config) {
  if (!cached || cached.url !== config.supabaseUrl || cached.key !== config.serviceKey) {
    cached = {
      url: config.supabaseUrl,
      key: config.serviceKey,
      client: createClient(config.supabaseUrl, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  const sb = cached.client;
  const check = ({ data, error }) => { if (error) throw error; return data; };

  return {
    async homeOrders(user) {
      const worker=['garage_installer','garage_detailer','garage_spray'].includes(user.role);
      const manager=['director','shareholder','garage_head'].includes(user.role);
      if(!worker&&!manager&&user.role!=='garage_salesman')throw Error('NOT_ALLOWED');
      let query=sb.from('garage_invoices').select('id,invoice_number,vehicle_id,created_by,service,work_status,created_at,delivered_at').not('work_status','in','(closed,draft)').order('created_at',{ascending:true}).limit(51);
      if(!manager&&!worker)query=query.eq('created_by',user.id);
      if(worker)query=query.eq('service','tinted').is('delivered_at',null);
      let found,sourceMore=false;
      if(worker){
        // Assigned work comes before the shared queue, even with a large backlog.
        const ownPieces=check(await sb.from('garage_tint_installation_pieces').select('invoice_id').eq('installer_id',user.id).order('created_at',{ascending:false}).limit(1001))||[];
        const availablePieces=check(await sb.from('garage_tint_installation_pieces').select('invoice_id').is('installer_id',null).neq('status','installed').order('created_at',{ascending:false}).limit(1001))||[];
        const ownIds=[...new Set(ownPieces.slice(0,1000).map(p=>p.invoice_id))],availableIds=[...new Set(availablePieces.slice(0,1000).map(p=>p.invoice_id))];
        const active=()=>sb.from('garage_invoices').select('id,invoice_number,vehicle_id,created_by,service,work_status,created_at,delivered_at').eq('service','tinted').is('delivered_at',null).not('work_status','in','(closed,draft)').order('created_at',{ascending:true}).limit(51);
        const own=ownIds.length?check(await active().in('id',ownIds))||[]:[];
        const shared=availableIds.length?check(await active().in('id',availableIds))||[]:[];
        found=[...new Map([...own,...shared].map(i=>[i.id,i])).values()];sourceMore=ownPieces.length>1000||availablePieces.length>1000;
      }else found=check(await query)||[];
      const invoices=found.slice(0,50),ids=invoices.map(i=>i.id);
      if(!ids.length)return {invoices,jobs:[],reviews:[],pieces:[],vehicles:[],users:[],hasMore:false};
      const rows=await Promise.all([
        sb.from('garage_installer_jobs').select('id,invoice_id,status').in('invoice_id',ids),
        sb.from('garage_installation_reviews').select('invoice_id,state,confirmations').in('invoice_id',ids),
        sb.from('garage_tint_installation_pieces').select('invoice_id,id,position,installer_id,status,needs_correction').in('invoice_id',ids),
        sb.from('garage_vehicles').select('id,registration_no,make,model').in('id',[...new Set(invoices.map(i=>i.vehicle_id))]),
        manager?sb.from('garage_building_staff').select('id,name').in('id',[...new Set(invoices.map(i=>i.created_by).filter(Boolean))]):Promise.resolve({data:[],error:null}),
      ]);
      const [jobs,reviews,pieces,vehicles,users]=rows.map(r=>check(r)||[]);
      return {invoices,jobs,reviews,pieces,vehicles,users,hasMore:sourceMore||found.length>50};
    },
    async findUserByUsername(username) {
      // Same exact-match lookup as the app login. Duplicate usernames are
      // treated as "no such user" rather than guessing which one.
      const rows = check(await sb.from('garage_building_staff').select('*').eq('username', username).limit(2));
      return rows?.length === 1 ? rows[0] : null;
    },
    async findUserById(id) {
      return check(await sb.from('garage_building_staff').select('*').eq('id', id).maybeSingle());
    },
    async createSession(s) {
      check(await sb.from('garage_building_sessions').insert({
        token_hash: s.tokenHash, user_id: s.userId, credential_fingerprint: s.fingerprint,
        created_at: s.createdAt, last_seen_at: s.lastSeenAt, expires_at: s.expiresAt,
      }));
    },
    async findSession(tokenHash) {
      const row = check(await sb.from('garage_building_sessions').select(SESSION_COLUMNS).eq('token_hash', tokenHash).maybeSingle());
      return row ? { userId: row.user_id, fingerprint: row.credential_fingerprint, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at } : null;
    },
    async touchSession(tokenHash, lastSeenAt) {
      check(await sb.from('garage_building_sessions').update({ last_seen_at: lastSeenAt }).eq('token_hash', tokenHash));
    },
    async deleteSession(tokenHash) {
      check(await sb.from('garage_building_sessions').delete().eq('token_hash', tokenHash));
    },
    async deleteExpiredSessions(userId, nowIso) {
      check(await sb.from('garage_building_sessions').delete().eq('user_id', userId).lt('expires_at', nowIso));
    },
    async uploadPaymentProof(path,bytes,mime) {
      const result=await sb.storage.from('garage-payment-proofs').upload(path,bytes,{contentType:mime,upsert:false});
      if(result.error&&String(result.error.statusCode)!=='409')throw result.error;
    },
    async paymentProofUrl(path) {
      return check(await sb.storage.from('garage-payment-proofs').createSignedUrl(path,60)).signedUrl;
    },
    async throttleHit(key, limit, windowSeconds) {
      const data = check(await sb.rpc('garage_building_auth_throttle_hit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds }));
      const row = Array.isArray(data) ? data[0] : data;
      return { allowed: row?.allowed === true, retryAfter: Number(row?.retry_after) || windowSeconds };
    },
    async throttleClear(key) {
      check(await sb.rpc('garage_building_auth_throttle_clear', { p_key: key }));
    },
    async activateStaff(tokenHash, username, passwordHash) {
      return check(await sb.rpc('garage_building_activate_staff', {
        p_token_hash: tokenHash, p_username: username, p_password_hash: passwordHash,
      })) === true;
    },
    async canActivateStaff(tokenHash, username) {
      return check(await sb.rpc('garage_building_check_invite', {p_token_hash:tokenHash,p_username:username})) === true;
    },
    rpc(fn, args) {
      return sb.rpc(fn, args);
    },
  };
}
