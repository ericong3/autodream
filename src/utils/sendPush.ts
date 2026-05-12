import { supabase } from '../lib/supabase';

export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  url = '/',
) {
  if (!userIds.length) return;
  try {
    await supabase.functions.invoke('send-push', {
      body: { userIds, title, body, url },
    });
  } catch {
    // Silently fail — notifications are best-effort
  }
}
