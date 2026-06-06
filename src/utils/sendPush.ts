import { supabase } from '../lib/supabase';

export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  url = '/',
  referenceId?: string,
) {
  if (!userIds.length) return;
  try {
    await supabase.functions.invoke('send-push', {
      body: { userIds, title, body, url },
    });
  } catch {
    // Silently fail — push is best-effort
  }
  try {
    const rows = userIds.map(userId => ({
      user_id: userId,
      title,
      body: body ?? null,
      url: url ?? '/',
      reference_id: referenceId ?? null,
      is_read: false,
    }));
    await supabase.from('notifications').insert(rows);
  } catch {
    // Silently fail
  }
}
