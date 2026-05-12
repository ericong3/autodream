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
  bytes.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
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
  const header = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64u(sig)}`;
}

// ── aes128gcm encryption per RFC 8291 + RFC 8188 ────────────────────────────

async function encryptPayload(
  sub: { keys: { p256dh: string; auth: string } },
  plaintext: string,
): Promise<Uint8Array> {
  const receiverPubRaw = b64uDecode(sub.keys.p256dh);
  const authSecret = b64uDecode(sub.keys.auth);

  // Generate ephemeral sender key pair
  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

  // ECDH shared secret
  const receiverPub = await crypto.subtle.importKey(
    'raw', receiverPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const ecdhBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPub }, senderKP.privateKey, 256,
  );

  // IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0"||receiver_pub||sender_pub, L=32)
  const keyInfo = concat(
    new TextEncoder().encode('WebPush: info\x00'),
    receiverPubRaw,
    senderPubRaw,
  );
  const ecdhKey = await crypto.subtle.importKey('raw', ecdhBits, 'HKDF', false, ['deriveBits']);
  const ikm = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo },
    ecdhKey, 256,
  );

  // Random salt for content encryption key derivation
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);

  // CEK = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: aes128gcm\0", L=16)
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\x00') },
    ikmKey, 128,
  );
  // Nonce = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: nonce\0", L=12)
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\x00') },
    ikmKey, 96,
  );

  // Encrypt: plaintext + 0x02 delimiter (last-record marker per RFC 8188)
  const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const record = concat(new TextEncoder().encode(plaintext), new Uint8Array([2]));
  const ciphertextAB = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits }, cek, record,
  );

  // RFC 8188 header: salt(16) | rs(4 BE) | idlen(1) | sender_pub(65)
  const hdr = new Uint8Array(86);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, 4096, false);
  hdr[20] = 65;
  hdr.set(senderPubRaw, 21);

  return concat(hdr, new Uint8Array(ciphertextAB));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function sendWebPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<Response> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJwt(audience);
  const body = await encryptPayload(sub, payload);

  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      TTL: '86400',
    },
    body,
  });
}

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
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({ title, body, url: url ?? '/' });
    let sent = 0;

    await Promise.all(rows.map(async ({ subscription, endpoint }) => {
      const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
      if (!sub?.endpoint || !sub?.keys) return;
      try {
        const res = await sendWebPush(sub, payload);
        if (res.ok || res.status === 201) {
          sent++;
        } else if (res.status === 410 || res.status === 404) {
          await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
        } else {
          console.error('Push failed:', res.status, await res.text());
        }
      } catch (e) {
        console.error('Push error:', e);
      }
    }));

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Handler error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
