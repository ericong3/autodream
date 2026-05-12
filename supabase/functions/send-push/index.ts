import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_JWK = Deno.env.get('VAPID_PRIVATE_JWK')!;
const VAPID_SUBJECT = 'mailto:megustaaa95@gmail.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function makeVapidJwt(audience: string): Promise<string> {
  const jwk = JSON.parse(VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, key_ops: ['sign'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const header  = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64u(sig)}`;
}

// ── AES-128-GCM encryption for web push ──────────────────────────────────────

async function encryptPayload(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const recipientPub = await crypto.subtle.importKey(
    'raw', b64uDecode(sub.keys.p256dh),
    { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
  const serverKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey));
  const sharedBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPub }, serverKP.privateKey, 256,
  ));
  const authSecret = b64uDecode(sub.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF PRK from auth
  const prkKey = await crypto.subtle.importKey('raw', authSecret, 'HKDF', false, ['deriveBits']);
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const prk = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: sharedBits, info: authInfo }, prkKey, 256,
  ));

  const prkKey2 = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
  const keyInfo = concat(
    new TextEncoder().encode('Content-Encoding: aesgcm\0'),
    new Uint8Array([0]),
    b64uDecode(sub.keys.p256dh),
    serverPubRaw,
  );
  const nonceInfo = concat(
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    new Uint8Array([0]),
    b64uDecode(sub.keys.p256dh),
    serverPubRaw,
  );
  const cekBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: keyInfo }, prkKey2, 128,
  ));
  const nonceBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey2, 96,
  ));
  const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits }, cek, new TextEncoder().encode(payload),
  ));
  return { ciphertext, salt, serverPublicKey: serverPubRaw };
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}

async function sendWebPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<Response> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJwt(audience);
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(sub, payload);

  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${b64u(salt)}`,
      'Crypto-Key': `dh=${b64u(serverPublicKey)};p256ecdsa=${VAPID_PUBLIC_KEY}`,
      'Authorization': `WebPush ${jwt}`,
      TTL: '86400',
    },
    body: ciphertext,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { userIds, title, body, url } = await req.json();

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rows } = await admin
      .from('push_subscriptions')
      .select('subscription, endpoint')
      .in('user_id', userIds);

    if (!rows?.length) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const payload = JSON.stringify({ title, body, url: url ?? '/' });
    let sent = 0;

    await Promise.all(rows.map(async ({ subscription, endpoint }) => {
      const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
      if (!sub?.endpoint || !sub?.keys) return;
      try {
        const res = await sendWebPush(sub, payload);
        if (res.ok || res.status === 201) { sent++; }
        else if (res.status === 410 || res.status === 404) {
          await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
        } else {
          console.error('Push failed:', res.status, await res.text());
        }
      } catch (e) {
        console.error('Push error:', e);
      }
    }));

    return new Response(JSON.stringify({ sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Handler error:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
