import { supabase } from '../lib/supabase';

export async function notifyUsers(userIds: string[], title: string, body: string, url = '/') {
  if (!userIds.length) return;
  try {
    await supabase.functions.invoke('send-push', {
      body: { userIds, title, body, url },
    });
  } catch (e) {
    console.error('Push notification failed:', e);
  }
}
