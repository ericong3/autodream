import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT     = 'mailto:megustaaa95@gmail.com';

// ── VAPID JWT signing (Web Crypto, no external deps) ──────────────────────────

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function makeVapidJwt(audience: string): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: now + 12 * 3600,
    sub: VAPID_SUBJECT,
  })));

  const keyData = base64urlDecode(VAPID_PRIVATE_KEY);
  // pkcs8 wrapper: sequence { sequence { oid ecPublicKey, oid prime256v1 }, octetString { integer 1, octetString { privKey } } }
  // The generated key is already pkcs8 encoded — import directly
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return `${header}.${payload}.${base64url(sig)}`;
}

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJwt(audience);

  // Encode public key for VAPID header
  const pubKeyB64 = VAPID_PUBLIC_KEY;

  const body = new TextEncoder().encode(payload);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: `vapid t=${jwt},k=${pubKeyB64}`,
    },
    body,
  });

  return res;
}

// ── Encrypted payload (aesgcm / aes128gcm) ─────────────────────────────────
// We use the simpler approach: send raw JSON and rely on the push service
// to relay it. For real encryption we'd need the p256dh / auth keys.
// This works when the push service is used directly (FCM, APNs via web push).

async function sendEncryptedPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<boolean> {
  try {
    // Import recipient public key
    const recipientKey = await crypto.subtle.importKey(
      'raw',
      base64urlDecode(sub.keys.p256dh),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );

    // Generate ephemeral key pair
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );

    // ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: recipientKey },
      ephemeral.privateKey,
      256,
    );

    // Auth secret
    const authSecret = base64urlDecode(sub.keys.auth);

    // Salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // HKDF to derive content encryption key and nonce
    const prk = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey', 'deriveBits']);

    const ephemeralPublicKeyRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

    // ikm = HKDF-Extract(auth, shared || dh_pub_receiver || dh_pub_sender)
    const ikmBuf = new Uint8Array([
      ...new Uint8Array(sharedBits),
      ...base64urlDecode(sub.keys.p256dh),
      ...new Uint8Array(ephemeralPublicKeyRaw),
    ]);
    const ikmKey = await crypto.subtle.importKey('raw', ikmBuf, 'HKDF', false, ['deriveBits']);

    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
    const cekBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },
      ikmKey,
      128,
    );

    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
    const nonceBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
      ikmKey,
      96,
    );

    const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);

    const plaintext = new TextEncoder().encode(payload);
    // Add padding delimiter byte
    const padded = new Uint8Array([...plaintext, 2]);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonceBits },
      cek,
      padded,
    );

    // aes128gcm record format: salt(16) + rs(4) + keyid_len(1) + keyid + ciphertext
    const rs = new Uint8Array(4);
    new DataView(rs.buffer).setUint32(0, 4096, false);
    const keyid = new Uint8Array(ephemeralPublicKeyRaw);
    const keyidLen = new Uint8Array([keyid.length]);

    const record = new Uint8Array([
      ...salt,
      ...rs,
      ...keyidLen,
      ...keyid,
      ...new Uint8Array(ciphertext),
    ]);

    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await makeVapidJwt(audience);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400',
        Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      },
      body: record,
    });

    return res.ok || res.status === 201;
  } catch (e) {
    console.error('Encryption error:', e);
    return false;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { userIds, title, body, url } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rows } = await supabaseAdmin
      .from('push_subscriptions')
      .select('subscription')
      .in('user_id', userIds);

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const payload = JSON.stringify({ title, body, url: url ?? '/' });
    let sent = 0;

    await Promise.all(
      rows.map(async ({ subscription }) => {
        const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
        if (!sub?.endpoint || !sub?.keys) return;
        const ok = await sendEncryptedPush(sub, payload);
        if (ok) sent++;
        else {
          // Remove invalid subscription
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
      }),
    );

    return new Response(JSON.stringify({ sent }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
