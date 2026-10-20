// Service-role data access for the Garage building bridge. Server only:
// the service-role key bypasses RLS, so it must never reach the browser.
// Tables/functions come from the prepared migrations
// 20261020000000_garage_building_projects.sql and
// 20261020010000_garage_building_online_sessions.sql.
// First-time setup also uses 20261020020000_garage_building_activation.sql.
import { createClient } from '@supabase/supabase-js';

const USER_COLUMNS = 'id, name, username, password, role, business_access, enabled';
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
    async findUserByUsername(username) {
      // Same exact-match lookup as the app login. Duplicate usernames are
      // treated as "no such user" rather than guessing which one.
      const rows = check(await sb.from('garage_building_staff').select(USER_COLUMNS).eq('username', username).limit(2));
      return rows?.length === 1 ? rows[0] : null;
    },
    async findUserById(id) {
      return check(await sb.from('garage_building_staff').select(USER_COLUMNS).eq('id', id).maybeSingle());
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
