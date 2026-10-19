import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Plus, Copy, Trash2, Printer, Check, ArrowRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import BuildingPlan from '../components/garageBuilding/BuildingPlan';
import { OnlineSignIn, OnlineStatusLine, useBuildingOnlineSession } from '../components/garageBuilding/OnlineSession';
import { useStore } from '../store';
import { searchGarageCustomers } from '../lib/garageCustomers';
import { buildingStorageMode, getBuildingProject, isBuildingAuthError, saveBuildingProject } from '../lib/garageBuildingProjects';
import { createBuildingProject, paneArea, windowArea, projectArea, measurementIssues, updateBuildingPane, duplicateBuildingWindow, removeBuildingRoom, removeBuildingWindow, saveBuildingVersion, resizeBuildingPanels, canEditBuildingProject, validateBuildingProject, BUILDING_FILMS, BUILDING_LIMITS, newBuildingId } from '../utils/garageBuilding';
import type { BuildingProject, BuildingRoom, BuildingWindow, BuildingPane, BuildingWall } from '../types/garageBuilding';
import type { GarageCustomer } from '../types';
import '../components/garageBuilding/building.css';

const steps = ['Customer', 'Rooms', 'Windows', 'Check', 'Quote'];
const films = BUILDING_FILMS;
const walls: [BuildingWall, string][] = [['N', 'Back'], ['E', 'Right'], ['S', 'Front'], ['W', 'Left']];
const field = 'gb-input';
const id = () => newBuildingId('item');
function errorText(e: unknown) { return e instanceof Error ? e.message : 'The change could not be saved.'; }

export default function GarageBuildingProject() {
  const { projectId } = useParams<{ projectId: string }>(), navigate = useNavigate();
  const user = useStore(s => s.currentUser);
  const [project, setProject] = useState<BuildingProject | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [step, setStep] = useState(0), [floorId, setFloorId] = useState(''), [roomId, setRoomId] = useState<string | null>(null), [windowId, setWindowId] = useState<string | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [undo, setUndo] = useState<BuildingProject | null>(null);
  const [search, setSearch] = useState(''), [customers, setCustomers] = useState<GarageCustomer[]>([]), [searching, setSearching] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const searchSeq = useRef(0);
  const online = useBuildingOnlineSession(user);
  // Online: opening a saved project needs a session; a new draft doesn't
  // (sign-in is asked for at save time). Once loaded, a session expiring
  // never reloads the page, so unsaved edits stay in memory.
  const [signInOpen, setSignInOpen] = useState(false), [resumeSave, setResumeSave] = useState(false);
  const loadedKey = useRef('');
  const canLoad = !online.online || !projectId || online.status === 'signedIn';
  useEffect(() => {
    let active = true;
    if (!user || !canLoad) return;
    const key = `${user.id}:${projectId ?? 'new'}`;
    if (loadedKey.current === key) return;
    setLoading(true); setProject(null); setError(''); setDirty(false);
    const task = !projectId ? Promise.resolve(createBuildingProject(user.id)) : getBuildingProject(projectId, user);
    task.then(p => { if (!active) return; if (!p) throw new Error('Project not found or you do not have access.'); loadedKey.current = key; setProject(p); setFloorId(p.floors[0]?.id ?? ''); }).catch(e => { if (!active) return; if (isBuildingAuthError(e)) online.markSignedOut(e.message); else setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, user?.id, canLoad]);
  useEffect(() => {
    if (resumeSave && online.status === 'signedIn') { setResumeSave(false); setSignInOpen(false); void save(); }
  }, [resumeSave, online.status]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const seq = ++searchSeq.current, query = search.trim();
    if (query.length < 2) { setCustomers([]); setSearching(false); return; }
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchGarageCustomers(query).then(rows => { if (searchSeq.current === seq) setCustomers(rows); }).catch(() => { if (searchSeq.current === seq) setError('Customer search is unavailable. You can enter the name and contact details for this building draft.'); }).finally(() => { if (searchSeq.current === seq) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); searchSeq.current++; };
  }, [search]);
  const editable = !!(project && user && canEditBuildingProject(project, user));
  function edit(next: BuildingProject) { if (!editable || saving) return;const problems=validateBuildingProject(next);if(problems.length){setError(problems[0]);return;} setProject({ ...next, updatedAt: new Date().toISOString() }); setDirty(true); setUndo(null); setError(''); setMessage(''); }
  function change(fn: () => BuildingProject) { try { edit(fn()); } catch (e) { setError(errorText(e)); } }
  async function save() {
    if (!project || !user || !editable || saving) return;
    if (online.online && online.status !== 'signedIn') { setResumeSave(true); setSignInOpen(true); return; }
    setSaving(true); setError('');
    try { const saved = await saveBuildingProject(project, user); loadedKey.current = `${user.id}:${saved.id}`; setProject(saved); setDirty(false); setUndo(null); setMessage(buildingStorageMode() === 'local' ? 'Saved on this device.' : 'Saved to Garage online.'); if (!projectId) navigate(`/garage/building/${saved.id}`, { replace: true }); }
    catch (e) {
      // Session expired or revoked: keep the draft, ask to sign in, then retry.
      if (isBuildingAuthError(e)) { online.markSignedOut(errorText(e)); setResumeSave(true); setSignInOpen(true); }
      else setError(errorText(e));
    } finally { setSaving(false); }
  }
  function addRoom() {
    if (!project) return;
    const at = floorId === 'all' ? project.floors[0]?.id : floorId, count = project.rooms.filter(r => r.floorId === at).length;
    if (!at) return;
    const r: BuildingRoom = { id: id(), floorId: at, name: `Room ${project.rooms.length + 1}`, width: 180, depth: 150, x: (count % 3) * 240, z: Math.floor(count / 3) * 210 };
    edit({ ...project, rooms: [...project.rooms, r] }); setRoomId(r.id); setWindowId(null);
  }
  function addWindow(tall = false) {
    if (!project || !roomId) return;
    const room = project.rooms.find(r => r.id === roomId); if (!room) return;
    const upper = project.floors[project.floors.findIndex(f => f.id === room.floorId) + 1];
    if (tall && !upper) { setError('Add an upper floor before adding tall glass.'); return; }
    const w: BuildingWindow = { id: id(), roomId, label: tall ? 'Tall glass' : 'Window', kind: 'window', wall: 'N', position: .5, film: 'eco', panes: Array.from({ length: tall ? 1 : 2 }, () => ({ id: id(), width: tall ? 72 : 24, height: tall ? 240 : 60, measured: false, shape: 'rect' as const, ...(tall ? { row: 0, col: 0 } : {}) })), ...(tall ? { span: { toFloorId: upper.id, rows: 1, cols: 1, bottom: 12 } } : {}) };
    edit({ ...project, windows: [...project.windows, w] }); setWindowId(w.id); setStep(2);
  }
  function selectRoom(rid: string, wid?: string) {
    const r = project?.rooms.find(r => r.id === rid);
    if (r && floorId !== 'all') setFloorId(r.floorId);
    setRoomId(rid); setWindowId(wid ?? null); if (wid) setStep(2); else if (step !== 1 && step !== 2) setStep(1);
  }
  function go(next: number) {
    setStep(next); setError('');
    if ((next === 1 || next === 2) && project && !roomId) { const r = project.rooms.find(r => floorId === 'all' || r.floorId === floorId) ?? project.rooms[0]; if (r) { setRoomId(r.id); if (floorId !== 'all') setFloorId(r.floorId); } }
  }
  if (!project && user && !canLoad) return <GarageShell title="Building tint" showBack backTo="/garage/building">
    {online.status === 'signedOut' && <OnlineSignIn username={user.username} notice={online.notice} onSignIn={online.signIn} />}
    {online.status === 'checking' && <p className="py-20 text-center text-white/50">Checking online saving…</p>}
    {online.status === 'error' && <p role="alert" className="text-red-200">{online.notice} <button type="button" className="ml-2 text-gold-300 underline" onClick={() => void online.check()}>Try again</button></p>}
  </GarageShell>;
  if (loading) return <GarageShell title="Building tint" showBack backTo="/garage/building"><p className="py-20 text-center text-white/50">Loading project…</p></GarageShell>;
  if (!project || !user) return <GarageShell title="Building tint" showBack backTo="/garage/building"><p role="alert" className="text-red-200">{error || 'Project unavailable.'}</p></GarageShell>;
  const currentProject = project;
  const room = project.rooms.find(r => r.id === roomId), chosenWindow = project.windows.find(w => w.id === windowId);
  const allPanes = project.windows.flatMap(w => w.panes), unchecked = allPanes.filter(p => measurementIssues(p).length).length;
  function patchRoom(patch: Partial<BuildingRoom>) { if (room) edit({ ...currentProject, rooms: currentProject.rooms.map(r => r.id === room.id ? { ...r, ...patch } : r) }); }
  function roomDimension(key: 'width' | 'depth', input: HTMLInputElement) { if(!room)return;const value=Number(input.value);if(!Number.isFinite(value)||value<48||value>BUILDING_LIMITS.maxRoomInches){input.value=String(room[key]);setError('Room layout sizes must be between 48 and '+BUILDING_LIMITS.maxRoomInches+' inches.');return;}if(value!==room[key])patchRoom({[key]:value}); }
  function patchWindow(patch: Partial<BuildingWindow>) { if (chosenWindow) edit({ ...currentProject, windows: currentProject.windows.map(w => w.id === chosenWindow.id ? { ...w, ...patch } : w) }); }
  return <GarageShell title="Building tint" showBack backTo="/garage/building" onBack={() => {if(dirty&&!confirm('Leave without saving this draft?'))return;navigate('/garage/building');}}>
    <div className="garage-building -mx-1 space-y-5 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">{project.title || 'New building'}</h2><p className="mt-1 text-sm text-white/40">{project.customerName || 'Customer not entered'} · {dirty ? 'Unsaved changes' : project.revision ? 'Saved' : 'New project'}</p></div><button type="button" disabled={saving || !editable || planBusy} onClick={save} className="gb-primary inline-flex items-center gap-2"><Save size={16} />{saving ? 'Saving…' : 'Save project'}</button></div>
      {buildingStorageMode() === 'local' && <p className="text-xs text-gold-200/80">Device storage · This project stays in this browser until shared saving is enabled.</p>}
      <OnlineStatusLine status={online.status} session={online.session} onSignOut={() => void online.signOut()} onSignIn={() => setSignInOpen(true)} />
      {signInOpen && online.status !== 'signedIn' && <OnlineSignIn overlay username={user.username} notice={online.notice || (dirty ? 'Your unsaved changes stay on this screen while you sign in.' : '')} onSignIn={online.signIn} onCancel={() => { setSignInOpen(false); setResumeSave(false); if (dirty) setMessage('Not saved yet. Your changes are still on this screen.'); }} />}
      {!editable && <p role="alert" className="text-red-200">You do not have permission to edit this project.</p>}
      {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200">{error}</p>}
      {message && <p role="status" className="text-sm text-gold-200">{message}</p>}
      {undo && <p className="text-sm text-white/60">Removed from this draft. <button type="button" disabled={!editable || saving || planBusy} onClick={() => { setProject(undo); setUndo(null); setDirty(true); }} className="text-gold-300 underline">Undo</button></p>}
      <nav aria-label="Building quote steps" className="grid grid-cols-5 gap-1 sm:gap-2">{steps.map((label, index) => <button type="button" key={label} disabled={saving || planBusy} aria-current={step === index ? 'step' : undefined} onClick={() => go(index)} className={`rounded-xl border px-1 py-3 text-xs transition-colors sm:px-3 sm:text-sm ${step === index ? 'border-gold-400/60 bg-gold-400/15 text-gold-200' : 'border-white/10 bg-black/30 text-white/50'}`}><span className="hidden sm:inline">{index + 1}. </span>{label}</button>)}</nav>
      <div className={`grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px] ${saving ? 'pointer-events-none opacity-70' : ''}`}>
        <BuildingPlan readOnly={!editable || saving} onBusyChange={setPlanBusy} project={project} onChange={edit} roomId={roomId} windowId={windowId} onSelect={selectRoom} floorId={floorId} onFloor={f => { setFloorId(f); setRoomId(null); setWindowId(null); }} />
        <fieldset disabled={!editable || saving || planBusy} className="min-w-0 space-y-4 rounded-2xl border border-white/10 bg-black/50 p-5">
          {step === 0 && <>
            <h3 className="text-lg font-semibold">Customer</h3>
            <label className="gb-label">Find existing customer<input className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or registration number" /></label>
            {searching && <p className="text-xs text-white/40">Searching…</p>}
            {customers.length > 0 && <div className="max-h-40 space-y-1 overflow-auto">{customers.map(c => <button type="button" key={c.id} className="w-full rounded-lg border border-white/10 p-2 text-left text-sm hover:border-gold-400/40" onClick={() => { edit({ ...project, customerId: c.id, customerName: c.name, phone: c.phone }); setSearch(''); setCustomers([]); }}>{c.name}<span className="block text-xs text-white/40">{c.phone}</span></button>)}</div>}
            <label className="gb-label">Customer name<input className={field} value={project.customerName} onChange={e => edit({ ...project, customerName: e.target.value, customerId: undefined })} /></label>
            <label className="gb-label">Phone<input className={field} value={project.phone} onChange={e => edit({ ...project, phone: e.target.value })} /></label>
            <label className="gb-label">Project name<input className={field} value={project.title} onChange={e => edit({ ...project, title: e.target.value })} placeholder="House or building name" /></label>
            <label className="gb-label">Site address<textarea className={field} rows={3} value={project.address} onChange={e => edit({ ...project, address: e.target.value })} /></label>
            <p className="text-xs text-white/40">New names are saved with this building draft. Existing customer profiles are not changed.</p>
            <button type="button" className="gb-primary w-full" onClick={() => go(1)}>Rooms <ArrowRight size={15} /></button>
          </>}
          {step === 1 && <>
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Rooms</h3><button type="button" className="gb-secondary" onClick={addRoom}><Plus size={14} />Room</button></div>
            <p className="text-xs text-white/40">Drag to place. Pull gold handles to resize the layout.</p>
            {project.rooms.filter(r => floorId === 'all' || r.floorId === floorId).map(r => <button type="button" key={r.id} className={`gb-pick ${r.id === roomId ? 'border-gold-400/50' : ''}`} onClick={() => selectRoom(r.id)}>{r.name}</button>)}
            {room && <details className="gb-details"><summary>Room options</summary><div className="space-y-3 pt-3"><label className="gb-label">Name<input key={`${room.id}-${room.name}`} defaultValue={room.name} className={field} onBlur={e => patchRoom({ name: e.target.value.trim() || room.name })} /></label><div className="grid grid-cols-2 gap-2"><label className="gb-label">Width (in)<input key={`${room.id}-width-${room.width}`} type="number" defaultValue={room.width} min={48} className={field} onBlur={e => roomDimension('width',e.currentTarget)} /></label><label className="gb-label">Depth (in)<input key={`${room.id}-depth-${room.depth}`} type="number" defaultValue={room.depth} min={48} className={field} onBlur={e => roomDimension('depth',e.currentTarget)} /></label></div><button type="button" className="gb-danger" onClick={() => { if (!confirm(`Delete ${room.name} and its windows? You can undo until the next edit.`)) return; const before = project; change(() => removeBuildingRoom(project, room.id)); setUndo(before); setRoomId(null); setWindowId(null); }}><Trash2 size={14} />Delete room</button></div></details>}
            <details className="gb-details"><summary>Floors</summary><div className="space-y-2 pt-3">{project.floors.map(f => <label key={`${f.id}-${f.name}`} className="gb-label">Floor name<input className={field} defaultValue={f.name} onBlur={e => edit({ ...project, floors: project.floors.map(x => x.id === f.id ? { ...x, name: e.target.value.trim() || x.name } : x) })} /></label>)}<button type="button" className="gb-secondary" onClick={() => { const f = { id: id(), name: `Level ${project.floors.length + 1}` }; edit({ ...project, floors: [...project.floors, f] }); setFloorId(f.id); setRoomId(null); }}><Plus size={14} />Floor</button></div></details>
            <button type="button" className="gb-primary w-full" onClick={() => go(2)}>Windows <ArrowRight size={15} /></button>
          </>}
          {step === 2 && <>
            <h3 className="text-lg font-semibold">{chosenWindow ? chosenWindow.label : 'Windows'}</h3>
            {!room && <p className="text-sm text-white/50">Choose or add a room first.</p>}
            {room && <>
              <label className="gb-label">Room<select className={field} value={room.id} onChange={e => selectRoom(e.target.value)}>{project.rooms.map(r => <option key={r.id} value={r.id}>{r.name} · {project.floors.find(f => f.id === r.floorId)?.name}</option>)}</select></label>
              {project.windows.filter(w => w.roomId === room.id).map(w => <button type="button" key={w.id} className={`gb-pick ${w.id === windowId ? 'border-gold-400/50' : ''}`} onClick={() => setWindowId(w.id)}><span>{w.label}<small className="block text-xs text-white/40">{w.panes.length} panes{w.span ? ' · Tall glass' : ''}</small></span><span>›</span></button>)}
              <div className="flex flex-wrap gap-2"><button type="button" className="gb-secondary" onClick={() => addWindow()}><Plus size={14} />Window</button><button type="button" className="gb-secondary" onClick={() => addWindow(true)}><Plus size={14} />Tall glass</button></div>
            </>}
            {chosenWindow && <WindowEditor key={chosenWindow.id} window={chosenWindow} project={project} onPane={(paneId, patch, whole) => change(() => updateBuildingPane(project, chosenWindow.id, paneId, patch, whole))} onPatch={patchWindow} onCount={(count, width, height) => change(() => resizeBuildingPanels(project, chosenWindow.id, count, width, height))} onDuplicate={(target, wall) => { try { const next = duplicateBuildingWindow(project, chosenWindow.id, target, wall); edit(next); const copy = next.windows[next.windows.length - 1]; selectRoom(copy.roomId, copy.id); } catch (e) { setError(errorText(e)); } }} onDelete={() => { if (!confirm(`Delete ${chosenWindow.label} and its ${chosenWindow.panes.length} panes? You can undo until the next edit.`)) return; const before = project; change(() => removeBuildingWindow(project, chosenWindow.id)); setUndo(before); setWindowId(null); }} />}
            <button type="button" className="gb-primary w-full" onClick={() => go(3)}>Check sizes <ArrowRight size={15} /></button>
          </>}
          {step === 3 && <>
            <h3 className="text-lg font-semibold">Check sizes</h3><p className="text-sm text-white/50">{unchecked ? `${unchecked} of ${allPanes.length} panes need checking.` : allPanes.length ? 'All pane measurements are checked.' : 'Add glass before checking measurements.'}</p>
            {project.rooms.map(r => <details className="gb-details" key={r.id}><summary>{r.name}<small className="ml-2 text-white/40">{project.windows.filter(w => w.roomId === r.id).flatMap(w => w.panes).filter(p => measurementIssues(p).length).length} to check</small></summary><div className="space-y-2 pt-3">{project.windows.filter(w => w.roomId === r.id).map(w => <button type="button" className="gb-pick" key={w.id} onClick={() => selectRoom(r.id, w.id)}>{w.label}<small className="text-white/40">{w.panes.length} panes · {windowArea(w).toFixed(2)} sqft</small></button>)}{!project.windows.some(w => w.roomId === r.id) && <p className="text-xs text-white/40">No glass entered.</p>}</div></details>)}
            <button type="button" className="gb-primary w-full" onClick={() => go(4)}>Review quote <ArrowRight size={15} /></button>
          </>}
          {step === 4 && <>
            <h3 className="text-lg font-semibold">Quote scope</h3><p className="text-sm text-white/70">{project.customerName || 'Customer name missing'}</p><p className="text-xs text-white/40">{project.address || 'Site address missing'}</p><div className="gb-stat"><span>Windows</span><strong>{project.windows.length}</strong></div><div className="gb-stat"><span>Panes</span><strong>{allPanes.length}</strong></div><div className="gb-stat"><span>{unchecked ? 'Draft area' : 'Tint area'}</span><strong>{projectArea(project).toFixed(2)} sqft</strong></div>
            {unchecked > 0 && <p className="text-sm text-gold-200">{unchecked} panes still need checking. This snapshot will keep that status.</p>}
            <label className="gb-label">Version note<input className={field} maxLength={80} value={versionNote} onChange={e => setVersionNote(e.target.value)} placeholder="Optional" /></label>
            <button type="button" className="gb-primary w-full" onClick={() => { try { edit(saveBuildingVersion(project, versionNote)); setVersionNote(''); setMessage('Snapshot added. Save the project to keep it.'); } catch (e) { setError(errorText(e)); } }}>Save quote version</button>
            <button type="button" className="gb-secondary w-full justify-center" onClick={() => window.print()}><Printer size={15} />Measurement sheet</button>
            <p className="text-xs text-white/40">Measurement scope only. Building prices, agreements and work-order conversion are not connected yet.</p>
            {project.versions.length > 0 && <details className="gb-details"><summary>Saved versions ({project.versions.length})</summary><div className="space-y-3 pt-3">{[...project.versions].reverse().map(v => <div key={v.id} className="text-sm"><strong>v{v.number} · {v.sqft.toFixed(2)} sqft</strong><p className="text-xs text-white/40">{v.note || 'No note'} · {v.unchecked} unchecked<br />{new Date(v.createdAt).toLocaleString('en-MY')}</p></div>)}</div></details>}
          </>}
        </fieldset>
      </div>
      <section className="gb-print" aria-label="Building measurement sheet"><h1>AutoDream Garage · Building measurements</h1><h2>{project.title}</h2><p>{project.customerName} · {project.address}</p><p>{projectArea(project).toFixed(2)} sqft · {unchecked} panes to check · Dimensions in inches</p><table><thead><tr><th>Room</th><th>Window / pane</th><th>W × H</th><th>Film</th><th>Sqft</th><th>Status</th></tr></thead><tbody>{project.windows.flatMap(w => w.panes.map((p, i) => <tr key={p.id}><td>{project.rooms.find(r => r.id === w.roomId)?.name}</td><td>{w.label} · {i + 1}{w.span ? ' (tall glass)' : ''}</td><td>{p.width} × {p.height}</td><td>{w.film}</td><td>{paneArea(p).toFixed(2)}</td><td>{measurementIssues(p).join(', ') || 'Checked'}</td></tr>))}</tbody></table><p>Measured scope only · Not an invoice or signed agreement</p></section>
    </div>
  </GarageShell>;
}

interface WindowEditorProps { window: BuildingWindow; project: BuildingProject; onPane: (id: string, patch: Partial<BuildingPane>, whole: boolean) => void; onPatch: (patch: Partial<BuildingWindow>) => void; onCount: (count: number | { rows: number; cols: number }, width: number, height: number) => void; onDuplicate: (roomId: string, wall: BuildingWall) => void; onDelete: () => void }
function WindowEditor({ window: w, project, onPane, onPatch, onCount, onDuplicate, onDelete }: WindowEditorProps) {
  const [paneId, setPaneId] = useState(w.panes[0]?.id), [whole, setWhole] = useState(false), [target, setTarget] = useState(w.roomId), [wall, setWall] = useState<BuildingWall>(w.wall);
  const pane = w.panes.find(p => p.id === paneId) ?? w.panes[0];
  const [count, setCount] = useState(w.panes.length), [rows, setRows] = useState(w.span?.rows ?? 1), [cols, setCols] = useState(w.span?.cols ?? 1);
  useEffect(() => { setCount(w.panes.length); setRows(w.span?.rows ?? 1); setCols(w.span?.cols ?? 1); }, [w.panes.length, w.span?.rows, w.span?.cols]);
  if (!pane) return null;
  const fieldNumber = (key: 'width' | 'height', input: HTMLInputElement) => { const number = Number(input.value);if(number===Number(input.defaultValue))return;if(!Number.isFinite(number)||number<=0||number>BUILDING_LIMITS.maxPaneInches)input.value=String(pane[key]);onPane(pane.id, { [key]: number }, whole); };
  return <div className="space-y-4 border-t border-white/10 pt-4">
    <div className="flex flex-wrap gap-1" aria-label="Select a pane">{w.panes.map((p, index) => <button type="button" key={p.id} aria-pressed={p.id === pane.id} onClick={() => setPaneId(p.id)} className={`rounded-lg border px-3 py-2 text-xs ${p.id === pane.id ? 'border-gold-400/50 bg-gold-400/15 text-gold-200' : 'border-white/10 text-white/50'}`}>{w.span ? `${(p.row ?? 0) + 1}–${(p.col ?? 0) + 1}` : index + 1}</button>)}</div>
    <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={whole} onChange={e => setWhole(e.target.checked)} className="accent-gold-400" />Apply to whole set</label>
    <div className="grid grid-cols-2 gap-2"><label className="gb-label">Width (in)<input key={`${pane.id}-w-${pane.width}`} type="number" min=".125" step="any" className={field} defaultValue={pane.width} onBlur={e => fieldNumber('width', e.currentTarget)} /></label><label className="gb-label">Height (in)<input key={`${pane.id}-h-${pane.height}`} type="number" min=".125" step="any" className={field} defaultValue={pane.height} onBlur={e => fieldNumber('height', e.currentTarget)} /></label></div>
    {pane.shape === 'custom' && <><label className="gb-label">Verified area (sqft)<input key={`${pane.id}-area-${pane.verifiedArea ?? ''}`} type="number" step="any" min="0" className={field} defaultValue={pane.verifiedArea ?? ''} onBlur={e => {const value=Number(e.currentTarget.value);if(!e.currentTarget.value.trim()||value<=0){e.currentTarget.value='';onPane(pane.id,{verifiedArea:undefined},false);}else{if(!Number.isFinite(value)||value>BUILDING_LIMITS.maxVerifiedSqft)e.currentTarget.value=String(pane.verifiedArea??'');onPane(pane.id,{verifiedArea:value},false);}}} /></label><label className="gb-label">Photo reference<input key={`${pane.id}-photo-${pane.photoReference ?? ''}`} className={field} defaultValue={pane.photoReference ?? ''} onBlur={e => onPane(pane.id, { photoReference: e.target.value }, false)} /></label><label className="gb-label">Shape note<input key={`${pane.id}-note-${pane.note ?? ''}`} className={field} defaultValue={pane.note ?? ''} onBlur={e => onPane(pane.id, { note: e.target.value }, false)} /></label></>}
    <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={whole ? w.panes.every(p => p.measured) : pane.measured} onChange={e => onPane(pane.id, { measured: e.target.checked }, whole)} className="accent-gold-400" />Measurements checked</label>
    <label className="gb-label">Film · whole window<select className={field} value={w.film} onChange={e => onPatch({ film: e.target.value })}>{films.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
    <p className="text-xs text-white/40">{paneArea(pane).toFixed(2)} sqft for this pane · {measurementIssues(pane).join(', ') || 'Checked'}</p>
    <details className="gb-details"><summary>Window options</summary><div className="space-y-3 pt-3"><label className="gb-label">Name<input key={`${w.id}-label-${w.label}`} className={field} defaultValue={w.label} onBlur={e => onPatch({ label: e.target.value.trim() || 'Window' })} /></label><label className="gb-label">Type<select value={w.kind} className={field} onChange={e => onPatch({ kind: e.target.value as BuildingWindow['kind'], panes: w.panes.map(p => ({ ...p, shape: e.target.value === 'custom' ? 'custom' : 'rect', measured: false, verifiedArea: undefined, photoReference: undefined })) })}><option value="window">Window</option><option value="sliding">Sliding door</option><option value="custom">Custom glass</option></select></label><label className="gb-label">Wall<select className={field} value={w.wall} onChange={e => onPatch({ wall: e.target.value as BuildingWall })}>{walls.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {w.span ? <><div className="grid grid-cols-2 gap-2"><label className="gb-label">Rows<input className={field} type="number" min="1" max="4" value={rows} onChange={e => setRows(Number(e.target.value))} /></label><label className="gb-label">Columns<input className={field} type="number" min="1" max="4" value={cols} onChange={e => setCols(Number(e.target.value))} /></label></div><label className="gb-label">Top floor<select className={field} value={w.span.toFloorId} onChange={e => onPatch({ span: { ...w.span!, toFloorId: e.target.value } })}>{project.floors.filter((_, index) => index > project.floors.findIndex(f => f.id === project.rooms.find(r => r.id === w.roomId)?.floorId)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label></> : <label className="gb-label">Panels<input className={field} type="number" min="1" max="24" value={count} onChange={e => setCount(Number(e.target.value))} /></label>}
      <button type="button" className="gb-secondary" onClick={() => { const removing = w.span ? w.panes.some(p => (p.row ?? 0) >= rows || (p.col ?? 0) >= cols) : count < w.panes.length; if (removing && !confirm('Remove the extra panes and their glass area?')) return; onCount(w.span ? { rows, cols } : count, pane.width, pane.height); }}>Apply panel count</button>
      <div className="border-t border-white/10 pt-3"><label className="gb-label">Copy to room<select className={field} value={target} onChange={e => setTarget(e.target.value)}>{project.rooms.filter(r => !w.span || r.floorId === project.rooms.find(x => x.id === w.roomId)?.floorId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="gb-label mt-3">Copy to wall<select className={field} value={wall} onChange={e => setWall(e.target.value as BuildingWall)}>{walls.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><button type="button" className="gb-secondary mt-3" onClick={() => onDuplicate(target, wall)}><Copy size={14} />Duplicate window</button></div><button type="button" className="gb-danger" onClick={onDelete}><Trash2 size={14} />Delete window</button>
    </div></details>
    {pane.measured && <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={12} />Size checked on site</span>}
  </div>;
}
