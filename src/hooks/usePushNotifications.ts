/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store';

const VAPID_PUBLIC_KEY = 'BP_Mna_M9YyaO3gGTnu0L_PXwg8-xm257hFGnKNTbzISjTIKoJYpjU7ZmErgGuyhyBt23OIFfmjl_POe5VMkduA';

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

async function swReady(timeout = 8000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Service worker timeout')), timeout)
    ),
  ]);
}

async function doSubscribe(userId: string): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unavailable';
  if (!VAPID_PUBLIC_KEY) return 'unavailable';
  try {
    const reg = await swReady();
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await saveSubscription(userId, existing);
      return 'granted';
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
    });
    await saveSubscription(userId, sub);
    return 'granted';
  } catch (e) {
    console.error('Push subscription error:', e);
    alert('Notification setup failed: ' + String(e));
    return 'unavailable';
  }
}

export function usePushNotifications() {
  const currentUser = useStore(s => s.currentUser);
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'unavailable'>('idle');

  useEffect(() => {
    if (!currentUser) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setStatus('unavailable'); return; }
    if (!VAPID_PUBLIC_KEY) { setStatus('unavailable'); return; }
    if (Notification.permission === 'granted') {
      swReady().then(async (reg) => {
        const existing = await reg.pushManager.getSubscription();
        if (existing) { await saveSubscription(currentUser.id, existing); setStatus('granted'); }
      }).catch(() => setStatus('unavailable'));
    } else if (Notification.permission === 'denied') {
      setStatus('denied');
    }
  }, [currentUser?.id]);

  const requestPermission = async () => {
    if (!currentUser) return;
    const result = await doSubscribe(currentUser.id);
    setStatus(result);
  };

  return { status, requestPermission };
}
