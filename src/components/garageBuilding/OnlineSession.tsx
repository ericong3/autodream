// Garage online saving gate. In online mode the building pages need a
// server-verified session; staff re-confirm their existing password here.
// Local mode never renders any of this.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CloudOff, KeyRound } from 'lucide-react';
import { useStore } from '../../store';
import { BuildingStorageError, buildingStorageMode, getOnlineSession, signInOnline, signOutOnline, type OnlineSession } from '../../lib/garageBuildingProjects';

export type OnlineStatus = 'local' | 'checking' | 'signedIn' | 'signedOut' | 'error';
const MISMATCH = 'Online saving on this browser belonged to another staff account and has been signed out. Sign in as yourself.';

// When the app user logs out or switches account, end their Garage online
// session too, so the next person on a shared PC can't use it.
let watching = false;
function watchAppLogout() {
  if (watching || buildingStorageMode() !== 'online') return;
  watching = true;
  useStore.subscribe((state, prev) => {
    if (prev.currentUser && state.currentUser?.id !== prev.currentUser.id) signOutOnline().catch(() => undefined);
  });
}

export function useBuildingOnlineSession(user: { id: string; username: string } | null) {
  const online = buildingStorageMode() === 'online';
  const [status, setStatus] = useState<OnlineStatus>(online ? 'checking' : 'local');
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;

  const check = useCallback(async () => {
    if (!online || !user) return;
    const mine = ++seq.current;
    setStatus('checking');
    try {
      const s = await getOnlineSession();
      if (mine !== seq.current) return;
      if (s && s.user.id !== user.id) {
        await signOutOnline().catch(() => undefined);
        setSession(null); setNotice(MISMATCH); setStatus('signedOut');
      } else {
        setSession(s); setStatus(s ? 'signedIn' : 'signedOut');
      }
    } catch (e) {
      if (mine !== seq.current) return;
      setNotice(e instanceof Error ? e.message : 'Garage online saving is unavailable.');
      setStatus('error');
    }
  }, [online, user?.id]);

  useEffect(() => { watchAppLogout(); void check(); }, [check]);

  const signIn = useCallback(async (password: string) => {
    if (!user) throw new BuildingStorageError('AUTH', 'Sign in to AutoDream first.');
    const s = await signInOnline(user.username, password);
    if (currentUserId.current !== user.id) {
      await signOutOnline().catch(() => undefined);
      throw new BuildingStorageError('AUTH', 'The app account changed. Sign in again.');
    }
    if (s.user.id !== user.id) {
      await signOutOnline().catch(() => undefined);
      throw new BuildingStorageError('AUTH', 'That sign-in belongs to a different account than the one using AutoDream.');
    }
    seq.current++;
    setSession(s); setNotice(''); setStatus('signedIn');
  }, [user?.id, user?.username]);

  const signOut = useCallback(async () => {
    seq.current++;
    await signOutOnline().catch(() => undefined);
    setSession(null); setNotice(''); setStatus('signedOut');
  }, []);

  // Called when a request comes back 401 mid-use (expired / revoked).
  const markSignedOut = useCallback((reason: string) => {
    seq.current++;
    setSession(null); setNotice(reason); setStatus('signedOut');
  }, []);

  return { online, status, session, notice, check, signIn, signOut, markSignedOut };
}

interface SignInProps {
  username: string;
  notice?: string;
  onSignIn: (password: string) => Promise<void>;
  onCancel?: () => void;
  overlay?: boolean;
}

export function OnlineSignIn({ username, notice, onSignIn, onCancel, overlay }: SignInProps) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError('');
    try { await onSignIn(password); }
    catch (err) {
      const wait = err instanceof BuildingStorageError && err.retryAfter ? ` (about ${Math.ceil(err.retryAfter / 60)} min)` : '';
      setError((err instanceof Error ? err.message : 'Sign-in failed.') + wait);
    } finally { setPassword(''); setBusy(false); }
  }
  const form = <form onSubmit={submit} className="garage-building w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0d0e0c] p-6 text-white" aria-labelledby="gb-online-title">
    <div className="flex items-center gap-3"><KeyRound size={20} className="text-gold-400" /><h3 id="gb-online-title" className="text-lg font-semibold">Garage online saving</h3></div>
    <p className="text-sm text-white/60">Enter your Garage online password to open shared building projects on this PC.</p>
    {notice && <p role="status" className="text-sm text-gold-200">{notice}</p>}
    <label className="gb-label">Username<input className="gb-input" value={username} readOnly autoComplete="username" /></label>
    <label className="gb-label">Password<input className="gb-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus maxLength={256} required /></label>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    <div className="flex gap-2"><button type="submit" disabled={busy || !password} className="gb-primary flex-1">{busy ? 'Checking…' : 'Sign in'}</button>{onCancel && <button type="button" disabled={busy} onClick={onCancel} className="gb-secondary">Not now</button>}</div>
  </form>;
  if (!overlay) return <div className="flex justify-center py-8">{form}</div>;
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">{form}</div>;
}

export function OnlineStatusLine({ status, session, onSignOut, onSignIn }: { status: OnlineStatus; session: OnlineSession | null; onSignOut: () => void; onSignIn: () => void }) {
  if (status === 'local') return null;
  if (status === 'signedIn' && session) return <p className="text-xs text-white/50">Shared online saving · {session.user.name} · <button type="button" className="text-gold-300 underline" onClick={onSignOut}>Sign out of online saving</button></p>;
  if (status === 'checking') return <p className="text-xs text-white/40">Checking online saving…</p>;
  return <p className="flex items-center gap-1 text-xs text-gold-200/80"><CloudOff size={12} />Online saving needs sign-in · <button type="button" className="text-gold-300 underline" onClick={onSignIn}>Sign in</button></p>;
}
