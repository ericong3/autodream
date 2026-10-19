import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, ArrowRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { OnlineSignIn, OnlineStatusLine, useBuildingOnlineSession } from '../components/garageBuilding/OnlineSession';
import { useStore } from '../store';
import { buildingStorageMode, isBuildingAuthError, listBuildingProjects } from '../lib/garageBuildingProjects';
import { projectArea } from '../utils/garageBuilding';
import type { BuildingProject } from '../types/garageBuilding';

export default function GarageBuildingProjects() {
  const user = useStore(s => s.currentUser), navigate = useNavigate();
  const online = useBuildingOnlineSession(user);
  const [projects, setProjects] = useState<BuildingProject[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ready = online.status === 'local' || online.status === 'signedIn';
  useEffect(() => {
    let active = true;
    if (!user || !ready) return;
    setLoading(true); setError('');
    listBuildingProjects(user).then(rows => { if (active) setProjects(rows); }).catch(e => { if (!active) return; if (isBuildingAuthError(e)) online.markSignedOut(e.message); else setError(e instanceof Error ? e.message : 'Could not load building projects.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, ready]);
  const gate = online.online && !ready;
  return <GarageShell title="Building tint" showBack backTo="/garage/sales-tools">
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold text-white">Building projects</h2><p className="mt-1 text-sm text-white/50">Customers, windows and measurements.</p></div><button type="button" onClick={() => navigate('/garage/building/new')} className="inline-flex items-center gap-2 rounded-xl bg-gold-400 px-4 py-3 text-sm font-semibold text-black"><Plus size={17} />New project</button></div>
      {buildingStorageMode() === 'local' && <p className="rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-3 text-sm text-gold-200">Device storage · Projects are saved in this browser for your account. Shared database saving is not enabled yet.</p>}
      <OnlineStatusLine status={online.status} session={online.session} onSignOut={() => { setProjects([]); void online.signOut(); }} onSignIn={() => online.markSignedOut('')} />
      {gate && user && online.status === 'signedOut' && <OnlineSignIn username={user.username} notice={online.notice} onSignIn={online.signIn} />}
      {gate && online.status === 'error' && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">{online.notice} <button type="button" className="ml-2 text-gold-300 underline" onClick={() => void online.check()}>Try again</button></p>}
      {gate && online.status === 'checking' && <p className="py-12 text-center text-white/50">Checking online saving…</p>}
      {!gate && error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">{error}</p>}
      {!gate && (loading ? <p className="py-12 text-center text-white/50">Loading projects…</p> : !error && projects.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/[.03] p-12 text-center"><Building2 className="mx-auto mb-4 text-gold-400" size={32} strokeWidth={1.5} /><p className="text-white">Start your first building project</p><p className="mt-2 text-sm text-white/40">Add a customer, sketch the rooms, then measure the glass.</p></div> : <div className="space-y-3">{projects.map(p => <button key={p.id} type="button" onClick={() => navigate(`/garage/building/${p.id}`)} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[.03] p-5 text-left transition-colors hover:border-gold-400/40"><Building2 size={22} className="shrink-0 text-gold-400" /><div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-white">{p.title || 'Untitled building'}</h3><p className="mt-1 truncate text-sm text-white/50">{p.customerName || 'Customer not entered'} · {p.windows.length} windows · {projectArea(p).toFixed(2)} sqft</p><p className="mt-1 text-xs text-white/30">Saved {new Date(p.updatedAt).toLocaleString('en-MY')}{p.versions.length ? ` · Quote v${p.versions.length}` : ''}</p></div><ArrowRight size={18} className="text-white/40" /></button>)}</div>)}
    </div>
  </GarageShell>;
}
