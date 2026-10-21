import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { garageSessionRequest, secureGarageLoginEnabled, type GarageIdentity } from '../lib/garageSession';
import { BUSINESS_LABELS, STAFF_ROLE_LABELS } from '../lib/staffAccounts';

export default function AccountSignInCheck() {
  const [params] = useSearchParams();
  const [username, setUsername] = useState(params.get('username') || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<GarageIdentity | null>(null);
  const [result, setResult] = useState<GarageIdentity | null>(null);

  async function finish(user: GarageIdentity) {
    await garageSessionRequest('DELETE');
    setPending(null);
    setResult(user);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const user = await garageSessionRequest('POST', { username: username.trim(), password });
      if (!user) throw new Error('Could not check this account.');
      setPending(user);
      await finish(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function retryFinish() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try { await finish(pending); }
    catch { setError('Could not sign out of the test session. Please try again.'); }
    finally { setBusy(false); }
  }

  // This page is only for the staged rollout. Normal shared login takes over later.
  if (secureGarageLoginEnabled()) return <Navigate to="/login" replace />;

  return <div className="min-h-screen relative bg-obsidian-950 flex items-center justify-center p-6">
    <div className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/garage-bg.png')" }} />
    <div className="fixed inset-0 bg-black/80" />
    <main className="relative w-full max-w-md bg-black/60 border border-white/10 rounded-2xl p-7 backdrop-blur-xl">
      <p className="font-display text-gold-400 mb-5">AutoDream</p>
      <h1 className="text-white text-2xl font-semibold mb-3">Check your password</h1>
      <p className="text-white/60 text-sm mb-6">Test your new login. The test session signs out afterward.</p>
      {result ? <div role="status" className="space-y-3 text-white/80">
        <p className="font-semibold text-white">Your new password works.</p>
        <p>{result.name} · {result.username}</p>
        <p>{STAFF_ROLE_LABELS[result.role]} · {BUSINESS_LABELS[result.businessAccess]}</p>
        <p className="text-white/50 text-sm">Test complete. You are signed out of the test session.</p>
      </div> : pending ? <div className="space-y-4">
        <p className="text-white/80">Your password works. Finish signing out of the test session.</p>
        <button type="button" className="btn-gold w-full rounded-xl py-3" disabled={busy} onClick={retryFinish}>{busy ? 'Please wait…' : 'Finish check'}</button>
      </div> : <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm text-white/70">Username<input className="input mt-2" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" maxLength={100} required /></label>
        <label className="block text-sm text-white/70">Password<input className="input mt-2" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" maxLength={72} required /></label>
        <button className="btn-gold w-full rounded-xl py-3" disabled={busy}>{busy ? 'Checking…' : 'Check password'}</button>
      </form>}
      {error && <p role="alert" className="text-red-300 text-sm mt-4">{error}</p>}
      {!pending && <Link className="block text-white/50 text-sm mt-6" to="/login">Back to AutoDream</Link>}
    </main>
  </div>;
}
