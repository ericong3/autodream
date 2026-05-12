/// <reference types="vite/client" />
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store';

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '') as string;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function saveSubscription(userId: string, sub: PushSubscription) {
  await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, subscription: sub.toJSON() },
    { onConflict: 'endpoint' },
  );
}

export function usePushNotifications() {
  const currentUser = useStore(s => s.currentUser);

  useEffect(() => {
    if (!currentUser) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!VAPID_PUBLIC_KEY) return;

    navigator.serviceWorker.ready.then(async (reg) => {
      // If already subscribed, just refresh the record in Supabase
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await saveSubscription(currentUser.id, existing);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      await saveSubscription(currentUser.id, subscription);
    });
  }, [currentUser?.id]);
}
