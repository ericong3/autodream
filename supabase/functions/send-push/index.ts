import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @deno-types="npm:@types/web-push"
import webpush from 'npm:web-push';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

webpush.setVapidDetails(
  'mailto:megustaaa95@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

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

    const { data: rows, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('subscription, endpoint')
      .in('user_id', userIds);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const payload = JSON.stringify({ title, body, url: url ?? '/' });
    let sent = 0;

    await Promise.all(
      rows.map(async ({ subscription, endpoint }) => {
        const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
        if (!sub?.endpoint || !sub?.keys) return;
        try {
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (e: any) {
          console.error('Push failed for endpoint:', endpoint, e?.statusCode, e?.message);
          // Remove expired/invalid subscriptions
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint);
          }
        }
      }),
    );

    return new Response(JSON.stringify({ sent }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('send-push error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
